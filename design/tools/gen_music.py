#!/usr/bin/env python3
"""
乖寶任務：程式算繪全部原創音樂與音效（SPEC-v8 線 M）。

  uv run --with numpy python design/tools/gen_music.py            # 全部（BGM + SFX）
  uv run --with numpy python design/tools/gen_music.py title map  # 只算指定場景
  uv run --with numpy python design/tools/gen_music.py --sfx      # 只算音效（全部）
  uv run --with numpy python design/tools/gen_music.py --sfx boing munch   # 只算指定的音效
  uv run --with numpy python design/tools/gen_music.py --report   # 只量測現有檔案

加新東西時只算新的（給名稱）：既有檔案重算後位元組只要有一點不同，manifest 的 v 就會變，所有使用者都要重新下載。
名稱打錯會直接報錯，不會退回「全部重算」。

輸出：public/audio/music-<scene>.m4a、sfx-<name>.m4a、manifest.json
全部是原創：旋律與和弦在本檔手寫，音色用加法／模態／FM 合成，沒有任何取樣或第三方素材。

取樣率 48 kHz（iPad／iPhone 的輸出就是 48 kHz，瀏覽器不必重取樣，循環長度也是整數樣本）。

循環設計：
- 整首以「循環長度 L」為週期渲染：音符尾巴取模折回開頭、殘響用 FFT 圓周捲積，所以首尾振幅連續、
  殘響尾巴自然落在下一圈的開頭。
- 檔案內容 = [最後 PRE 個樣本][L 個樣本][開頭 POST 個樣本]（整段週期訊號向兩邊延伸）。
  AAC 編碼延遲不論被解碼器裁掉或沒裁掉（最多約 2112 樣本），loopStart=PRE、loopEnd=PRE+L
  這一段都是正確的週期內容，引擎用 AudioBuffer loopStart/loopEnd 就不會有空隙。
  loopStart / loopEnd / duration 寫在 manifest.json。
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

SR = 48000
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "audio"

BGM_LUFS = -24.0
SFX_LUFS = -18.0
PRE = 16384  # 檔案開頭的前導（循環尾巴），約 0.37 秒
POST = 16384

# ---------------------------------------------------------------------------
# 基本工具
# ---------------------------------------------------------------------------


def mtof(m: float) -> float:
    return 440.0 * 2.0 ** ((m - 69.0) / 12.0)


NOTE_BASE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def name_to_midi(n: str) -> int:
    m = re.fullmatch(r"([A-G])([#b]?)(-?\d)", n)
    if not m:
        raise ValueError(f"bad note {n}")
    v = NOTE_BASE[m.group(1)] + {"#": 1, "b": -1, "": 0}[m.group(2)]
    return v + 12 * (int(m.group(3)) + 1)


def tarr(n: int) -> np.ndarray:
    return np.arange(n, dtype=np.float64) / SR


def exp_env(n: int, tau: float) -> np.ndarray:
    return np.exp(-np.arange(n, dtype=np.float64) / (max(tau, 1e-4) * SR))


def fade_in(n: int, sec: float) -> np.ndarray:
    k = max(1, int(sec * SR))
    e = np.ones(n)
    k = min(k, n)
    e[:k] = np.sin(np.linspace(0, np.pi / 2, k)) ** 2
    return e


def fade_out(n: int, sec: float) -> np.ndarray:
    k = max(1, int(sec * SR))
    e = np.ones(n)
    k = min(k, n)
    e[n - k :] = np.cos(np.linspace(0, np.pi / 2, k)) ** 2
    return e


def fft_filter(x: np.ndarray, hp: float | None = None, lp: float | None = None, order: int = 2) -> np.ndarray:
    """零相位的 Butterworth 形狀濾波（FFT 乘上幅度響應），用在短的雜訊與整首收尾。"""
    n = len(x)
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1.0 / SR)
    h = np.ones_like(f)
    if hp:
        h *= 1.0 / np.sqrt(1.0 + (hp / np.maximum(f, 1e-9)) ** (2 * order))
    if lp:
        h *= 1.0 / np.sqrt(1.0 + (f / lp) ** (2 * order))
    return np.fft.irfft(X * h, n)


def noise(n: int, rng: np.random.Generator) -> np.ndarray:
    return rng.standard_normal(n)


def add_at(buf: np.ndarray, sig: np.ndarray, start: int, wrap: bool) -> None:
    """把 sig 疊進 buf（最後一維是時間）。wrap=True：超出尾端的部分折回開頭（循環）。"""
    L = buf.shape[-1]
    n = sig.shape[-1]
    if wrap:
        start %= L
        pos = 0
        while pos < n:
            k = min(L - start, n - pos)
            buf[..., start : start + k] += sig[..., pos : pos + k]
            pos += k
            start = 0
    else:
        if start >= L:
            return
        k = min(n, L - start)
        buf[..., start : start + k] += sig[..., :k]


# ---------------------------------------------------------------------------
# 樂器（全部回傳單聲道 float64，峰值大約在 0.3–0.6，音量由呼叫端的 vel 控制）
# ---------------------------------------------------------------------------


def inst_marimba(f: float, dur: float, vel: float, rng) -> np.ndarray:
    """木琴／馬林巴：模態合成，泛音 1 : 4 : 10，低音衰減慢。"""
    tau1 = float(np.clip(0.62 * (440.0 / f) ** 0.55, 0.14, 1.5)) * (0.85 + 0.3 * vel)
    n = int(min(tau1 * 6.0, 3.5) * SR)
    t = tarr(n)
    out = np.zeros(n)
    for ratio, amp, tm in ((1.0, 1.0, 1.0), (4.0, 0.30 * (0.45 + vel), 0.28), (10.0, 0.07 * vel, 0.09)):
        if f * ratio > 9000:
            continue
        out += amp * np.sin(2 * np.pi * f * ratio * t + rng.uniform(0, 0.4)) * np.exp(-t / (tau1 * tm))
    # 槌子敲擊的悶響
    k = int(0.007 * SR)
    th = fft_filter(noise(k, rng), lp=min(f * 3.0, 3500.0)) * np.hanning(k) * 0.12 * vel
    out[:k] += th
    out *= fade_in(n, 0.0015)
    return out * 0.55


def inst_musicbox(f: float, dur: float, vel: float, rng) -> np.ndarray:
    """音樂盒：金屬音簧，泛音偏非整數但很快衰減；加一點微失諧造成閃爍。"""
    tau1 = float(np.clip(1.5 * (1046.0 / f) ** 0.35, 0.5, 2.3))
    n = int(min(tau1 * 5.5, 4.0) * SR)
    t = tarr(n)
    out = np.zeros(n)
    for ratio, amp, tm in ((1.0, 1.0, 1.0), (2.76, 0.20, 0.30), (5.40, 0.07, 0.12), (8.93, 0.025, 0.06)):
        if f * ratio > 11000:
            continue
        out += amp * np.sin(2 * np.pi * f * ratio * t + rng.uniform(0, 1)) * np.exp(-t / (tau1 * tm))
    out += 0.32 * np.sin(2 * np.pi * (f + 0.45) * t) * np.exp(-t / (tau1 * 0.9))
    out *= fade_in(n, 0.0008)
    return out * 0.42 * (0.6 + 0.4 * vel)


def inst_glock(f: float, dur: float, vel: float, rng) -> np.ndarray:
    """鐘琴／鐵琴：明亮的金屬條。"""
    tau1 = float(np.clip(1.3 * (1046.0 / f) ** 0.3, 0.45, 2.0))
    n = int(min(tau1 * 5.0, 3.5) * SR)
    t = tarr(n)
    out = np.zeros(n)
    for ratio, amp, tm in ((1.0, 1.0, 1.0), (2.756, 0.45, 0.45), (5.404, 0.22, 0.25), (8.933, 0.08, 0.15)):
        if f * ratio > 12000:
            continue
        out += amp * np.sin(2 * np.pi * f * ratio * t + rng.uniform(0, 1)) * np.exp(-t / (tau1 * tm))
    out *= fade_in(n, 0.0006)
    return out * 0.34 * (0.55 + 0.45 * vel)


def inst_pluck(f: float, dur: float, vel: float, rng, bright: float = 1.0, tau1: float = 1.25, pos: float = 0.17) -> np.ndarray:
    """撥弦（豎琴／烏克麗麗）：諧波各自衰減，高次諧波衰減快。"""
    tau = tau1 * float(np.clip((261.0 / f) ** 0.25, 0.6, 1.5))
    n = int(min(tau * 4.5, 3.2) * SR)
    t = tarr(n)
    out = np.zeros(n)
    kmax = int(min(14, 9000 // f))
    for k in range(1, kmax + 1):
        a = (1.0 / k**1.15) * abs(math.sin(math.pi * k * pos)) * (bright ** (k - 1) if k > 1 else 1.0)
        if a < 1e-3:
            continue
        out += a * np.sin(2 * np.pi * f * k * t + rng.uniform(0, 0.3)) * np.exp(-t / (tau / (1 + 0.55 * (k - 1))))
    kk = int(0.004 * SR)
    out[:kk] += fft_filter(noise(kk, rng), lp=2500) * np.hanning(kk) * 0.04 * vel
    out *= fade_in(n, 0.001)
    return out * 0.55


def inst_pad(f: float, dur: float, vel: float, rng, side: int = 0, attack: float = 0.45, release: float = 0.9) -> np.ndarray:
    """柔和長音襯底：兩組略失諧的類三角波疊合，緩起緩收，左右聲道用不同失諧。"""
    n = int((dur + release) * SR)
    t = tarr(n)
    dets = (-9.0, 2.0) if side == 0 else (-2.0, 9.0)
    out = np.zeros(n)
    for d in dets:
        ff = f * 2.0 ** (d / 1200.0)
        ph = rng.uniform(0, 6.28)
        for k, a in ((1, 1.0), (2, 0.34), (3, 0.14), (4, 0.05)):
            if ff * k > 7000:
                continue
            out += a * np.sin(2 * np.pi * ff * k * t + ph * k)
    trem = 1.0 + 0.06 * np.sin(2 * np.pi * (0.17 + 0.05 * side) * t + rng.uniform(0, 6.28))
    env = fade_in(n, attack) * np.concatenate([np.ones(int(dur * SR)), np.cos(np.linspace(0, np.pi / 2, n - int(dur * SR))) ** 2])
    return out * env * trem * 0.18


def inst_bass(f: float, dur: float, vel: float, rng, tau: float = 0.5) -> np.ndarray:
    """溫暖的撥弦低音：基音 + 少量 2、3 倍頻，有一點指尖的啪。"""
    n = int((min(dur, 1.6) + 0.12) * SR)
    t = tarr(n)
    out = np.sin(2 * np.pi * f * t) + 0.38 * np.sin(2 * np.pi * 2 * f * t + 0.3) * np.exp(-t / (tau * 0.5)) + 0.12 * np.sin(2 * np.pi * 3 * f * t) * np.exp(-t / (tau * 0.25))
    env = np.exp(-t / tau) * fade_in(n, 0.004)
    gate = np.ones(n)
    kd = int(min(dur, 1.6) * SR)
    gate[kd:] = np.cos(np.linspace(0, np.pi / 2, n - kd)) ** 2
    return out * env * gate * 0.55


def inst_flute(f: float, dur: float, vel: float, rng, vib: float = 0.0045) -> np.ndarray:
    """柔和的直笛／笛子：有延遲的顫音與一點氣息聲。"""
    rel = 0.16
    n = int((dur + rel) * SR)
    t = tarr(n)
    ramp = np.clip((t - 0.18) / 0.35, 0, 1)
    inst_f = f * (1.0 + vib * ramp * np.sin(2 * np.pi * 5.0 * t + rng.uniform(0, 6)))
    ph = 2 * np.pi * np.cumsum(inst_f) / SR
    out = np.sin(ph) + 0.20 * np.sin(2 * ph) + 0.07 * np.sin(3 * ph) + 0.025 * np.sin(4 * ph)
    kd = int(dur * SR)
    env = fade_in(n, 0.06) * np.concatenate([np.ones(kd), np.cos(np.linspace(0, np.pi / 2, n - kd)) ** 2])
    breath = fft_filter(noise(n, rng), hp=max(f * 1.5, 1200.0), lp=max(f * 5.0, 4500.0)) * 0.045
    sw = 1.0 + 0.08 * np.sin(2 * np.pi * 0.9 * t)
    return (out + breath) * env * sw * 0.42


def inst_ep(f: float, dur: float, vel: float, rng) -> np.ndarray:
    """電鋼琴（FM 音簧）：調變指數隨時間下降，音頭亮、尾巴圓。"""
    rel = 0.22
    n = int((min(dur, 3.0) + rel) * SR)
    t = tarr(n)
    idx = (0.9 + 1.1 * vel) * np.exp(-t / 0.28) + 0.12
    mod = np.sin(2 * np.pi * f * t)
    car = np.sin(2 * np.pi * f * t + idx * mod)
    ping = 0.07 * vel * np.sin(2 * np.pi * f * 14.0 * t + 0.5) * np.exp(-t / 0.045) if f * 14 < 12000 else 0
    tau = 1.7 * float(np.clip((262.0 / f) ** 0.25, 0.7, 1.4))
    kd = int(min(dur, 3.0) * SR)
    gate = np.concatenate([np.ones(kd), np.cos(np.linspace(0, np.pi / 2, n - kd)) ** 2])
    out = (car + ping) * np.exp(-t / tau) * gate * fade_in(n, 0.002)
    return out * 0.42


def inst_xylo(f: float, dur: float, vel: float, rng) -> np.ndarray:
    """木琴（xylophone，v8.5）：比馬林巴短、乾一點，泛音 1 : 3 : 6。短短的音聽起來像在跳。"""
    tau1 = float(np.clip(0.30 * (523.0 / f) ** 0.5, 0.09, 0.5)) * (0.85 + 0.3 * vel)
    n = int(min(tau1 * 6.0, 2.0) * SR)
    t = tarr(n)
    out = np.zeros(n)
    for ratio, amp, tm in ((1.0, 1.0, 1.0), (3.0, 0.26 * (0.5 + vel), 0.30), (6.0, 0.06 * vel, 0.10)):
        if f * ratio > 8000:
            continue
        out += amp * np.sin(2 * np.pi * f * ratio * t + rng.uniform(0, 0.4)) * np.exp(-t / (tau1 * tm))
    k = int(0.006 * SR)
    out[:k] += fft_filter(noise(k, rng), lp=min(f * 3.0, 4000.0)) * np.hanning(k) * 0.14 * vel
    out *= fade_in(n, 0.0012)
    return out * 0.55


def inst_clarinet(f: float, dur: float, vel: float, rng, vib: float = 0.003) -> np.ndarray:
    """單簧管（v8.5）：只有奇數泛音，中音域溫暖、不尖。緩起、尾巴有一點顫音和很輕的氣息聲。"""
    rel = 0.13
    n = int((dur + rel) * SR)
    t = tarr(n)
    ramp = np.clip((t - 0.22) / 0.4, 0, 1)
    inst_f = f * (1.0 + vib * ramp * np.sin(2 * np.pi * 4.6 * t + rng.uniform(0, 6)))
    ph = 2 * np.pi * np.cumsum(inst_f) / SR
    # 音越高泛音越少（真的單簧管高音區也比較純），高音才不會變尖
    b = float(np.clip((466.0 / f) ** 0.7, 0.35, 1.0))
    out = np.sin(ph)
    for k, a in ((3, 0.34 * b), (5, 0.11 * b**2), (7, 0.035 * b**3), (2, 0.05)):
        if f * k < 6500:
            out += a * np.sin(k * ph)
    kd = int(dur * SR)
    env = fade_in(n, 0.045) * np.concatenate([np.ones(kd), np.cos(np.linspace(0, np.pi / 2, n - kd)) ** 2])
    breath = fft_filter(noise(n, rng), hp=max(f * 2.0, 1500.0), lp=5000.0) * 0.022
    sw = 1.0 + 0.06 * np.sin(2 * np.pi * 0.8 * t)
    return (out + breath) * env * sw * 0.36


def inst_brass(f: float, dur: float, vel: float, rng) -> np.ndarray:
    """玩具小號（v8.5，音效用）：諧波隨音頭打開（先圓後亮），最高到 6 kHz，不刺耳。"""
    rel = 0.09
    n = int((dur + rel) * SR)
    t = tarr(n)
    scoop = 1.0 - 0.012 * np.exp(-t / 0.02)
    vibr = 1.0 + 0.004 * np.clip((t - 0.18) / 0.2, 0, 1) * np.sin(2 * np.pi * 5.5 * t)
    ph = 2 * np.pi * np.cumsum(f * scoop * vibr) / SR
    bright = (0.42 + 0.34 * vel * (1 - np.exp(-t / 0.035))) * (0.82 + 0.18 * np.exp(-t / 0.4))
    out = np.zeros(n)
    for k in range(1, int(min(12, 6000 // f)) + 1):
        out += (k**-0.6) * bright ** (k - 1) * np.sin(k * ph + rng.uniform(0, 0.2))
    kd = int(dur * SR)
    env = fade_in(n, 0.016) * np.concatenate([np.ones(kd), np.cos(np.linspace(0, np.pi / 2, n - kd)) ** 2])
    return out * env * 0.3


# ----- 打擊 -----


def perc_shaker(vel: float, rng, dur: float = 0.1) -> np.ndarray:
    n = int(dur * SR)
    t = tarr(n)
    x = fft_filter(noise(n, rng), hp=5200, lp=11000)
    return x * (1 - np.exp(-t / 0.005)) * np.exp(-t / 0.026) * 0.20


def perc_wood(vel: float, rng, f: float = 1150.0, tau: float = 0.02) -> np.ndarray:
    n = int(0.16 * SR)
    t = tarr(n)
    out = np.sin(2 * np.pi * f * t) * np.exp(-t / tau) + 0.45 * np.sin(2 * np.pi * f * 1.58 * t) * np.exp(-t / (tau * 0.5))
    k = int(0.003 * SR)
    out[:k] += fft_filter(noise(k, rng), lp=5000) * 0.25
    return out * 0.45 * fade_in(n, 0.0005)


def perc_kick(vel: float, rng) -> np.ndarray:
    n = int(0.32 * SR)
    t = tarr(n)
    fr = 50.0 + 85.0 * np.exp(-t / 0.024)
    ph = 2 * np.pi * np.cumsum(fr) / SR
    return np.sin(ph) * np.exp(-t / 0.1) * fade_in(n, 0.002) * 0.7


def perc_brush(vel: float, rng) -> np.ndarray:
    n = int(0.28 * SR)
    t = tarr(n)
    x = fft_filter(noise(n, rng), hp=1500, lp=6500)
    return x * (1 - np.exp(-t / 0.012)) * np.exp(-t / 0.065) * 0.28


def perc_triangle(vel: float, rng, f0: float = 3300.0) -> np.ndarray:
    n = int(1.4 * SR)
    t = tarr(n)
    out = np.zeros(n)
    for r, a, tau in ((1.0, 1.0, 0.9), (2.41, 0.5, 0.6), (3.97, 0.28, 0.4), (5.7, 0.12, 0.25)):
        out += a * np.sin(2 * np.pi * f0 * r * t + rng.uniform(0, 6)) * np.exp(-t / tau)
    return out * fade_in(n, 0.001) * 0.14


def perc_tambourine(vel: float, rng) -> np.ndarray:
    n = int(0.3 * SR)
    t = tarr(n)
    x = fft_filter(noise(n, rng), hp=5500, lp=13000)
    env = np.zeros(n)
    for i, off in enumerate((0.0, 0.021, 0.043)):
        k = int(off * SR)
        env[k:] += (0.6 ** i) * np.exp(-(t[: n - k]) / 0.03)
    return x * env * (1 - np.exp(-t / 0.002)) * 0.22


def perc_clap(vel: float, rng) -> np.ndarray:
    n = int(0.16 * SR)
    t = tarr(n)
    x = fft_filter(noise(n, rng), hp=900, lp=3200)
    env = np.zeros(n)
    for i, off in enumerate((0.0, 0.011, 0.023)):
        k = int(off * SR)
        env[k:] += np.exp(-(t[: n - k]) / (0.006 if i < 2 else 0.05))
    return x * env * 0.3


INSTR = {
    "marimba": (inst_marimba, 0.34),
    "musicbox": (inst_musicbox, 0.55),
    "glock": (inst_glock, 0.55),
    "pluck": (inst_pluck, 0.32),
    "bass": (inst_bass, 0.05),
    "flute": (inst_flute, 0.45),
    "ep": (inst_ep, 0.38),
    "xylo": (inst_xylo, 0.30),
    "clarinet": (inst_clarinet, 0.40),
}
PERC = {
    "shaker": (perc_shaker, 0.08),
    "wood": (perc_wood, 0.10),
    "kick": (perc_kick, 0.0),
    "brush": (perc_brush, 0.12),
    "triangle": (perc_triangle, 0.35),
    "tambourine": (perc_tambourine, 0.12),
    "clap": (perc_clap, 0.15),
}

# ---------------------------------------------------------------------------
# 和弦
# ---------------------------------------------------------------------------

QUAL = {
    "": [0, 4, 7],
    "m": [0, 3, 7],
    "7": [0, 4, 7, 10],
    "maj7": [0, 4, 7, 11],
    "m7": [0, 3, 7, 10],
    "6": [0, 4, 7, 9],
    "m6": [0, 3, 7, 9],
    "add9": [0, 4, 7, 14],
    "sus4": [0, 5, 7],
    "sus2": [0, 2, 7],
    "7sus": [0, 5, 7, 10],
    "maj9": [0, 4, 7, 11, 14],
    "m9": [0, 3, 7, 10, 14],
    "9": [0, 4, 7, 10, 14],
}


def parse_chord(sym: str) -> tuple[int, list[int], int | None]:
    """'Dm7' → (root_pc, intervals, slash_bass_pc)"""
    m = re.fullmatch(r"([A-G][#b]?)([^/]*)(?:/([A-G][#b]?))?", sym)
    if not m:
        raise ValueError(f"bad chord {sym}")

    def pc(s: str) -> int:
        return (NOTE_BASE[s[0]] + {"#": 1, "b": -1, "": 0}[s[1:]]) % 12

    q = m.group(2)
    if q not in QUAL:
        raise ValueError(f"unknown chord quality {q!r} in {sym}")
    return pc(m.group(1)), QUAL[q], (pc(m.group(3)) if m.group(3) else None)


def chord_pitches(sym: str, low: int) -> list[int]:
    """和弦音（由低到高），最低音落在 [low, low+12) 內（以和弦根音為準，slash 低音另算）"""
    root, ivs, _ = parse_chord(sym)
    base = low + ((root - low) % 12)
    return [base + i for i in ivs]


def bass_root(sym: str, octave_low: int = 36) -> int:
    root, _, slash = parse_chord(sym)
    pc = slash if slash is not None else root
    return octave_low + ((pc - octave_low) % 12)


def voice_lead(chords: list[str], center: int = 60, count: int = 4) -> list[list[int]]:
    """為每個和弦挑與前一個和弦動最少的轉位，聲部集中在 center 附近。"""
    out: list[list[int]] = []
    prev: list[int] | None = None
    for c in chords:
        root, ivs, _ = parse_chord(c)
        pcs = [(root + i) % 12 for i in ivs]
        # 只留 count 個聲部（優先保留 3、7、9 等性格音，其次根音、五音）
        if len(pcs) > count:
            pcs = pcs[:1] + pcs[1:2] + pcs[3:] + pcs[2:3]
            pcs = pcs[:count]
        cands: list[list[int]] = []
        for shift in range(len(pcs)):
            rot = pcs[shift:] + pcs[:shift]
            for oct0 in (center - 12, center - 7, center - 2, center + 3):
                v = [oct0 + ((rot[0] - oct0) % 12)]
                for p in rot[1:]:
                    v.append(v[-1] + ((p - v[-1]) % 12 or 12))
                cands.append(v)

        def cost(v: list[int]) -> float:
            mid = sum(v) / len(v)
            c0 = abs(mid - center) * 0.6
            if prev:
                a, b = sorted(v), sorted(prev)
                c0 += sum(abs(x - y) for x, y in zip(a, b))
            return c0

        best = min(cands, key=cost)
        out.append(sorted(best))
        prev = best
    return out


# ---------------------------------------------------------------------------
# 殘響
# ---------------------------------------------------------------------------


def make_ir(rt60: float, seed: int, n_extra: float = 1.15, damp: float = 1.0) -> np.ndarray:
    """合成殘響脈衝響應：三個頻帶各自衰減（高頻衰減較快，聽起來溫暖），開頭幾個稀疏的早期反射。"""
    rng = np.random.default_rng(seed)
    n = int(rt60 * n_extra * SR)
    t = tarr(n)
    bands = ((None, 400.0, 1.25), (400.0, 3200.0, 1.0), (3200.0, 9000.0, 0.5 / damp))
    ir = np.zeros(n)
    for lo, hi, mult in bands:
        x = fft_filter(rng.standard_normal(n), hp=lo, lp=hi)
        x /= np.sqrt(np.mean(x**2)) + 1e-9
        ir += x * np.exp(-6.9078 * t / (rt60 * mult))
    # 預延遲
    pre = int(0.014 * SR)
    ir = np.concatenate([np.zeros(pre), ir])[:n]
    # 早期反射
    for d, g in ((0.019, 0.5), (0.031, 0.38), (0.047, 0.3), (0.063, 0.22)):
        k = int(d * SR)
        if k < n:
            ir[k] += g * rng.choice([-1, 1]) * 2.0
    ir *= fade_in(n, 0.004)
    ir /= np.sqrt(np.sum(ir**2))
    return ir


def circ_conv(x: np.ndarray, ir: np.ndarray) -> np.ndarray:
    """圓周捲積：殘響尾巴折回開頭。ir 必須比 x 短。"""
    L = len(x)
    if len(ir) >= L:
        ir = ir[: L - 1]
    return np.fft.irfft(np.fft.rfft(x) * np.fft.rfft(ir, L), L)


# ---------------------------------------------------------------------------
# 歌曲渲染
# ---------------------------------------------------------------------------


def parse_bars(s: str, beats: float) -> list[list[tuple[list[str], float]]]:
    """'E5:1 G5:0.5 r:0.5 C5+E5:2 | ...' → 每小節 [(音名們, 拍數)]，並檢查每小節總拍數。"""
    bars = []
    for bi, bar in enumerate(b.strip() for b in s.split("|")):
        evs = []
        tot = 0.0
        for tok in bar.split():
            nm, d = tok.split(":")
            dur = float(d)
            tot += dur
            evs.append(([] if nm == "r" else nm.split("+"), dur))
        if abs(tot - beats) > 1e-6:
            raise ValueError(f"小節 {bi + 1} 拍數 {tot} != {beats}：{bar}")
        bars.append(evs)
    return bars


class Song:
    def __init__(self, name: str, bpm: float, beats: int, bars: int, seed: int, rt60: float, wet: float, swing: float = 0.0, damp: float = 1.0):
        self.name, self.bpm, self.beats, self.bars = name, bpm, beats, bars
        self.rng = np.random.default_rng(seed)
        self.spb = 60.0 / bpm
        self.L = int(round(bars * beats * self.spb * SR))
        self.dry = np.zeros((2, self.L))
        self.send = np.zeros((2, self.L))
        self.rt60, self.wet, self.swing, self.damp = rt60, wet, swing, damp
        self.seed = seed
        self.events = 0
        self.energy: dict[str, float] = {}

    # -- 位置 --
    def at(self, bar: int, beat: float) -> int:
        return int(round((bar * self.beats + beat) * self.spb * SR))

    def put(self, sig: np.ndarray, bar: int, beat: float, vel: float, pan: float, send: float, jit: float, level: float = 1.0, label: str = '?') -> None:
        """swing 與人性化時間抖動（秒）後疊進混音；pan -1..1，等功率。"""
        b = beat
        frac = (b % 1.0)
        if self.swing and abs(frac - 0.5) < 1e-6:
            b += self.swing
        start = self.at(bar, b) + int(self.rng.normal(0, jit) * SR)
        th = (pan + 1.0) * math.pi / 4.0
        gl, gr = math.cos(th), math.sin(th)
        if sig.ndim == 1:
            st = np.stack([sig * gl, sig * gr])
        else:  # 已經是立體聲（pad）
            st = sig
        st = st * level
        self.energy[label] = self.energy.get(label, 0.0) + float(np.sum(st**2))
        add_at(self.dry, st, start, True)
        if send > 0:
            add_at(self.send, st * send, start, True)
        self.events += 1

    def vj(self, vel: float, amt: float = 0.07) -> float:
        return float(np.clip(vel * (1 + self.rng.normal(0, amt)), 0.05, 1.2))

    # -- 發音 --
    def note(self, inst: str, midi: float, bar: int, beat: float, dur: float, vel: float = 0.8, pan: float = 0.0, send: float | None = None, jit: float = 0.007, level: float = 1.0, **kw) -> None:
        fn, dsend = INSTR[inst]
        v = self.vj(vel)
        f = mtof(midi)
        sig = fn(f, dur * self.spb, v, self.rng, **kw)
        self.put(sig, bar, beat, v, pan, dsend if send is None else send, jit, level * v, inst)

    def hit(self, kind: str, bar: int, beat: float, vel: float = 0.8, pan: float = 0.0, send: float | None = None, jit: float = 0.003, level: float = 1.0, **kw) -> None:
        fn, dsend = PERC[kind]
        v = self.vj(vel, 0.12)
        sig = fn(v, self.rng, **kw)
        self.put(sig, bar, beat, v, pan, dsend if send is None else send, jit, level * v, kind)

    def pad_chord(self, midis: list[int], bar: int, beat: float, dur_beats: float, vel: float = 0.8, level: float = 1.0, send: float = 0.5, attack: float = 0.5, release: float = 1.0) -> None:
        for m in midis:
            f = mtof(m)
            d = dur_beats * self.spb
            lsig = inst_pad(f, d, vel, self.rng, 0, attack, release)
            rsig = inst_pad(f, d, vel, self.rng, 1, attack, release)
            n = min(len(lsig), len(rsig))
            self.put(np.stack([lsig[:n], rsig[:n]]), bar, beat, vel, 0.0, send, 0.01, level * vel, 'pad')

    # -- 高階 --
    def melody(self, inst: str, text: str, start_bar: int = 0, vel: float = 0.8, pan: float = 0.0, octave: int = 0, level: float = 1.0, send: float | None = None, jit: float = 0.009, accent: float = 0.1, **kw) -> None:
        for bi, evs in enumerate(parse_bars(text, self.beats)):
            beat = 0.0
            for names, dur in evs:
                for nm in names:
                    m = name_to_midi(nm) + 12 * octave
                    # 強拍稍強、其餘稍弱（旋律的呼吸）
                    v = vel * (1 + accent * (1 if beat == 0 else 0.0))
                    self.note(inst, m, (start_bar + bi) % self.bars, beat, dur, v, pan, send, jit, level, **kw)
                beat += dur

    def arp(self, inst: str, chords: list[str], pattern: list[tuple[float, int, float]], low: int, vel: float = 0.6, pan: float = 0.0, bars: range | None = None, level: float = 1.0, send: float | None = None, jit: float = 0.006, **kw) -> None:
        """pattern: [(beat, 和弦音索引, 拍數)]；和弦音向上延伸兩個八度。"""
        for b in bars if bars is not None else range(self.bars):
            tones = chord_pitches(chords[b % len(chords)], low)
            ext = tones + [x + 12 for x in tones] + [x + 24 for x in tones]
            for k, (beat, idx, dur) in enumerate(pattern):
                self.note(inst, ext[idx % len(ext)], b, beat, dur, vel * (1.0 if k == 0 else 0.86), pan, send, jit, level, **kw)

    def bassline(self, chords: list[str], pattern: list[tuple[float, str, float]], bars: range | None = None, octave_low: int = 38, vel: float = 0.8, level: float = 1.0, tau: float = 0.5) -> None:
        """pattern: [(beat, 'r'|'5'|'8'|'3', 拍數)]"""
        for b in bars if bars is not None else range(self.bars):
            sym = chords[b % len(chords)]
            r = bass_root(sym, octave_low)
            _, ivs, _ = parse_chord(sym)
            for beat, which, dur in pattern:
                m = {"r": r, "5": r + 7, "8": r + 12, "3": r + ivs[1], "7": r + (ivs[3] if len(ivs) > 3 else 7)}[which]
                self.note("bass", m, b, beat, dur * 0.92, vel, 0.0, None, 0.004, level, tau=tau)

    def pad(self, chords: list[str], per: int = 1, bars: range | None = None, center: int = 60, vel: float = 0.8, level: float = 1.0, send: float = 0.5, attack: float = 0.5, release: float = 1.0, count: int = 4, overlap: float = 0.0) -> None:
        voicings = voice_lead(chords, center, count)
        for b in bars if bars is not None else range(self.bars):
            if b % per:
                continue
            self.pad_chord(voicings[b % len(voicings)], b, 0.0, per * self.beats + overlap, vel, level, send, attack, release)

    def strum(self, chords: list[str], pattern: list[tuple[float, str, float]], low: int = 55, vel: float = 0.6, pan: float = 0.0, bars: range | None = None, level: float = 1.0, send: float | None = None, **kw) -> None:
        """烏克麗麗式刷弦：pattern [(beat, 'd'|'u', 力度倍率)]，每根弦錯開約 12ms。"""
        for b in bars if bars is not None else range(self.bars):
            tones = chord_pitches(chords[b % len(chords)], low)
            tones = tones[:4] if len(tones) > 4 else tones
            ext = sorted(tones + [tones[0] + 12])[:4]
            for beat, d, vm in pattern:
                order = ext if d == "d" else ext[::-1]
                for i, m in enumerate(order):
                    fn, dsend = INSTR["pluck"]
                    v = self.vj(vel * vm * (0.75 if d == "u" else 1.0))
                    sig = fn(mtof(m), 0.4, v, self.rng, **kw)
                    self.put(sig, b, beat + i * 0.014 / self.spb, v, pan + (i - 1.5) * 0.06, dsend if send is None else send, 0.004, level * v, 'strum')

    def drums(self, kind: str, pattern: str, bars: range | None = None, vel: float = 0.8, pan: float = 0.0, level: float = 1.0, subdiv: int = 4, send: float | None = None, **kw) -> None:
        """pattern：每個字元一格（subdiv 格 = 1 拍），x 普通、o 重音、. 休止。"""
        steps = int(self.beats * subdiv)
        pat = pattern.replace(" ", "")
        assert len(pat) == steps, f"{self.name}: 打擊樣式長度 {len(pat)} != {steps}"
        for b in bars if bars is not None else range(self.bars):
            for i, ch in enumerate(pat):
                if ch == ".":
                    continue
                self.hit(kind, b, i / subdiv, vel * (1.25 if ch == "o" else 0.8 if ch == "x" else 0.55), pan, send, 0.003, level, **kw)

    # -- 混音 --
    def render(self, wet_pre_gain: float | None = None) -> np.ndarray:
        wet = float(self.wet if wet_pre_gain is None else wet_pre_gain)
        out = self.dry.copy()
        for ch in range(2):
            ir = make_ir(self.rt60, self.seed * 31 + ch * 7 + 1, damp=self.damp)
            out[ch] += circ_conv(self.send[ch], ir) * wet
        # 去直流與次低頻
        for ch in range(2):
            out[ch] = fft_filter(out[ch], hp=28.0, order=2)
        return out


# ---------------------------------------------------------------------------
# 檔案、量測
# ---------------------------------------------------------------------------


def write_wav_f32(path: Path, x: np.ndarray) -> None:
    """x: (ch, n) float → 32-bit float WAV"""
    ch, n = x.shape
    data = np.ascontiguousarray(x.T.astype("<f4")).tobytes()
    with open(path, "wb") as f:
        f.write(b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVE")
        f.write(b"fmt " + struct.pack("<IHHIIHH", 16, 3, ch, SR, SR * ch * 4, ch * 4, 32))
        f.write(b"data" + struct.pack("<I", len(data)) + data)


def read_f32(path: Path, ch: int) -> np.ndarray:
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", str(ch), "-ar", str(SR), "-"], capture_output=True, check=True)
    return np.frombuffer(r.stdout, dtype="<f4").reshape(-1, ch).T.astype(np.float64)


def measure(path: Path, pad_to: float | None = None) -> dict:
    af = "ebur128=peak=true"
    if pad_to:
        af = f"apad=whole_dur={pad_to}," + af
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", af, "-f", "null", "-"], capture_output=True, text=True)
    s = r.stderr
    s = s[s.rfind("Summary:") :] if "Summary:" in s else s
    m_i = re.search(r"Integrated loudness:\s+I:\s+(-?[\d.]+|-inf) LUFS", s)
    m_p = re.search(r"True peak:\s+Peak:\s+(-?[\d.]+|-inf) dBFS", s)
    m_lra = re.search(r"LRA:\s+([\d.]+) LU", s)
    return {
        "lufs": float(m_i.group(1)) if m_i and m_i.group(1) != "-inf" else -99.0,
        "tp": float(m_p.group(1)) if m_p and m_p.group(1) != "-inf" else -99.0,
        "lra": float(m_lra.group(1)) if m_lra else 0.0,
    }


def volumedetect(path: Path) -> dict:
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", "volumedetect", "-f", "null", "-"], capture_output=True, text=True)
    mm = re.search(r"mean_volume:\s+(-?[\d.]+) dB", r.stderr)
    mx = re.search(r"max_volume:\s+(-?[\d.]+) dB", r.stderr)
    return {"mean": float(mm.group(1)) if mm else None, "max": float(mx.group(1)) if mx else None}


def encoder_args(bitrate: str) -> list[str]:
    have = subprocess.run(["ffmpeg", "-hide_banner", "-encoders"], capture_output=True, text=True).stdout
    if " aac_at " in have:
        return ["-c:a", "aac_at", "-b:a", bitrate]
    return ["-c:a", "aac", "-b:a", bitrate]


def encode_m4a(wav: Path, out: Path, bitrate: str, channels: int) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["ffmpeg", "-y", "-v", "error", "-i", str(wav), "-ac", str(channels), *encoder_args(bitrate), "-movflags", "+faststart", str(out)]
    subprocess.run(cmd, check=True)


def normalize_to(x: np.ndarray, tmp: Path, target: float, pad_to: float | None, peak_cap_db: float) -> tuple[np.ndarray, dict]:
    """依 ebur128 積分響度把 x 調到 target LUFS，但取樣峰值不超過 peak_cap_db。"""
    write_wav_f32(tmp, x)
    m = measure(tmp, pad_to)
    g_db = target - m["lufs"]
    pk = float(np.max(np.abs(x))) + 1e-12
    pk_db = 20 * math.log10(pk)
    limited = False
    if pk_db + g_db > peak_cap_db:
        g_db = peak_cap_db - pk_db
        limited = True
    y = x * (10 ** (g_db / 20))
    return y, {"gain_db": g_db, "peak_limited": limited}


# ---------------------------------------------------------------------------
# 八首 BGM
# 每個場景一個函式，回傳 Song。旋律用「小節字串」手寫：音名:拍數，| 分小節，r 休止，+ 同時發聲。
# parse_bars 會檢查每小節的拍數剛好等於拍號，抄錯會直接報錯。
# ---------------------------------------------------------------------------


def song_title() -> Song:
    """開場：音樂盒的小星空。C 大調 92 BPM，16 小節。A 段靜靜說故事，B 段加入木琴、低音與輕搖沙。"""
    s = Song("title", 92, 4, 16, seed=11, rt60=2.3, wet=0.30)
    ch = ["Cmaj7", "Am7", "Fmaj7", "G6", "Cmaj7", "Em7", "Fmaj7", "G7sus",
          "Am7", "Em7", "Fmaj7", "Cadd9", "Dm7", "G7", "Fmaj7", "G7sus"]
    mel = (
        "r:0.5 E5:0.5 G5:1 B5:1 A5:1 | G5:1.5 E5:0.5 C5:2 | r:0.5 F5:0.5 A5:1 C6:1 B5:1 | A5:1.5 G5:0.5 D5:2 |"
        " r:0.5 E5:0.5 G5:1 B5:1 C6:1 | D6:1.5 B5:0.5 G5:2 | A5:1 G5:0.5 F5:0.5 E5:1 F5:1 | E5:1 D5:1 r:2 |"
        " C6:1 B5:0.5 A5:0.5 G5:1 A5:1 | B5:1.5 G5:0.5 E5:2 | A5:1 C6:1 A5:0.5 G5:0.5 F5:1 | G5:1 E5:1 D5:2 |"
        " D5:0.5 F5:0.5 A5:1 C6:1 A5:1 | B5:1.5 A5:0.5 G5:1 B5:1 | A5:1 C6:1 E6:2 | D6:1.5 B5:0.5 G5:1 r:1"
    )
    # 旋律：A 段音樂盒，B 段音樂盒 + 高八度鐘琴輕輕疊
    s.melody("musicbox", mel, vel=0.78, pan=0.0, level=1.0)
    s.melody("glock", mel, start_bar=0, vel=0.34, pan=0.18, octave=1, level=0.45, jit=0.012)
    # 開頭兩小節像音樂盒上發條：只有分解和弦
    s.arp("musicbox", ch, [(0, 0, 1), (0.5, 2, 1), (1, 4, 1), (1.5, 5, 1), (2, 4, 1), (2.5, 2, 1), (3, 1, 1), (3.5, 2, 1)], low=48, vel=0.34, pan=-0.25, bars=range(0, 2), level=0.75)
    # 木琴分解和弦：第 3 小節起進來
    s.arp("marimba", ch, [(0, 0, 1), (1, 2, 1), (1.5, 1, 1), (2, 3, 1), (3, 2, 1), (3.5, 1, 1)], low=48, vel=0.45, pan=-0.3, bars=range(2, 16), level=0.8)
    s.pad(ch, per=1, vel=0.55, level=0.62, center=57, send=0.55, attack=0.6, release=1.2)
    s.bassline(ch, [(0, "r", 1.4), (2, "5", 1.4)], bars=range(4, 16), octave_low=36, vel=0.6, level=0.9)
    s.bassline(ch, [(0, "r", 3.5)], bars=range(0, 4), octave_low=36, vel=0.45, level=0.8)
    s.drums("shaker", "x.x.x.x.x.x.x.x.", bars=range(8, 16), subdiv=4, vel=0.5, pan=0.3, level=0.8)
    return s


def song_home_day() -> Song:
    """白天的家：G 大調 100 BPM、輕輕搖擺。烏克麗麗刷弦、木琴旋律、撥弦低音、木魚與沙錘。"""
    s = Song("home-day", 100, 4, 16, seed=23, rt60=1.5, wet=0.22, swing=0.07)
    ch = ["G", "Em7", "C", "D7", "G", "Bm7", "Cmaj7", "D7",
          "Em", "Bm", "C", "G/B", "Am7", "D7", "G", "D7"]
    mel = (
        "B4:0.5 D5:0.5 G5:1 F#5:0.5 E5:0.5 D5:1 | E5:1.5 G5:0.5 B5:1 G5:1 | C5:0.5 E5:0.5 G5:1 E5:0.5 D5:0.5 C5:1 | D5:1 F#5:0.5 A5:0.5 F#5:1 r:1 |"
        " B4:0.5 D5:0.5 G5:1 A5:0.5 B5:0.5 A5:1 | B5:1.5 A5:0.5 F#5:1 D5:1 | E5:1 G5:0.5 E5:0.5 D5:1 B4:1 | A4:1 C5:1 D5:2 |"
        " G5:1 B5:1 E6:2 | D6:1 B5:1 F#5:2 | E5:0.5 G5:0.5 C6:1 B5:0.5 A5:0.5 G5:1 | D5:1 G5:1 B5:2 |"
        " C6:1 B5:0.5 A5:0.5 G5:1 E5:1 | F#5:1 A5:1 D6:1.5 C6:0.5 | B5:1.5 G5:0.5 D5:1 G5:1 | A4:1 C5:0.5 D5:0.5 F#5:1 r:1"
    )
    s.melody("marimba", mel, vel=0.82, pan=0.08, level=1.0)
    # 後半段音樂盒疊高八度，像小鳥回應
    s.melody("musicbox", mel, start_bar=0, vel=0.3, pan=0.3, octave=1, level=0.4, jit=0.012)
    s.strum(ch, [(0, "d", 0.9), (1.5, "u", 0.6), (2, "d", 0.75), (3.5, "u", 0.55)], low=55, vel=0.55, pan=-0.2, level=0.9)
    s.bassline(ch, [(0, "r", 1.5), (1.5, "5", 0.5), (2, "r", 1.5), (3.5, "5", 0.5)], octave_low=36, vel=0.7, level=0.9, tau=0.4)
    s.pad(ch, per=2, vel=0.4, level=0.6, center=62, send=0.5, attack=0.7)
    s.drums("shaker", "x.xxx.xxx.xxx.xx", subdiv=4, vel=0.45, pan=0.35, level=0.75)
    s.drums("wood", "....o.......o...", bars=range(4, 16), subdiv=4, vel=0.4, pan=-0.35, level=0.7)
    return s


def song_home_night() -> Song:
    """夜晚的家：搖籃曲。F 大調 3/4、64 BPM。音樂盒旋律、豎琴分解和弦、很輕的長音，沒有打擊。"""
    s = Song("home-night", 64, 3, 16, seed=37, rt60=2.9, wet=0.34, damp=1.3)
    ch = ["F", "Dm", "Bbmaj7", "C", "F", "Am", "Bbmaj7", "C7",
          "Dm", "Gm7", "C7", "Fmaj7", "Bb", "F/A", "Gm7", "C7sus"]
    mel = (
        "A4:1 C5:1.5 A4:0.5 | D5:1 C5:1 A4:1 | Bb4:1 D5:1.5 C5:0.5 | G4:2 r:1 |"
        " A4:1 C5:1.5 F5:0.5 | E5:1 D5:1 C5:1 | D5:1.5 C5:0.5 Bb4:1 | A4:1 G4:2 |"
        " F5:1.5 E5:0.5 D5:1 | D5:1 Bb4:1 G4:1 | E5:1.5 D5:0.5 C5:1 | A4:2 r:1 |"
        " D5:1 F5:1.5 D5:0.5 | C5:1 A4:1 F4:1 | Bb4:1 A4:1 G4:1 | G4:2 r:1"
    )
    s.melody("musicbox", mel, vel=0.72, pan=0.05, level=1.0, jit=0.012, accent=0.05)
    s.arp("pluck", ch, [(0, 0, 1), (0.5, 2, 1), (1, 4, 1), (1.5, 2, 1), (2, 3, 1), (2.5, 2, 1)], low=41, vel=0.34, pan=-0.3, level=0.8, bright=0.6, tau1=1.6, jit=0.008)
    s.pad(ch, per=1, vel=0.5, level=0.55, center=55, send=0.6, attack=0.9, release=1.6, count=3, overlap=0.5)
    s.bassline(ch, [(0, "r", 2.6)], octave_low=34, vel=0.42, level=0.8, tau=0.9)
    return s


def song_map() -> Song:
    """冒險地圖：D 大調 108 BPM。撥弦低音走路、木琴八分音符脈動、笛子唱旋律、刷子與木魚輕輕打拍。"""
    s = Song("map", 108, 4, 16, seed=41, rt60=1.8, wet=0.24)
    ch = ["D", "A/C#", "G", "A", "D", "Bm", "G", "A",
          "Bm", "F#m", "G", "D/F#", "Em7", "A7", "D", "A7"]
    mel = (
        "D5:1 F#5:0.5 A5:0.5 B5:1 A5:1 | C#6:1.5 B5:0.5 A5:2 | B5:1 A5:0.5 G5:0.5 F#5:1 G5:1 | E5:2 C#5:1 r:1 |"
        " D5:1 F#5:0.5 A5:0.5 D6:1.5 B5:0.5 | D6:1 B5:1 A5:0.5 B5:0.5 F#5:1 | G5:1 B5:1 A5:1 G5:1 | F#5:1.5 E5:0.5 C#5:1 r:1 |"
        " B4:0.5 D5:0.5 F#5:1 B5:2 | A5:1 C#6:1 E6:2 | D6:1 B5:0.5 D6:0.5 G6:1 F#6:1 | E6:1.5 D6:0.5 A5:2 |"
        " G5:1 B5:1 E6:1 D6:1 | C#6:1.5 B5:0.5 A5:1 G5:1 | F#5:1 A5:1 D6:2 | C#6:1 B5:0.5 A5:0.5 E5:1 r:1"
    )
    s.melody("flute", mel, vel=0.7, pan=0.1, level=1.0)
    s.melody("marimba", mel, start_bar=8, vel=0.4, pan=0.25, level=0.55, octave=0, jit=0.012)
    s.arp("marimba", ch, [(0, 0, 0.5), (0.5, 2, 0.5), (1, 1, 0.5), (1.5, 2, 0.5), (2, 0, 0.5), (2.5, 2, 0.5), (3, 1, 0.5), (3.5, 2, 0.5)], low=50, vel=0.36, pan=-0.35, level=0.75)
    s.bassline(ch, [(0, "r", 0.9), (1, "5", 0.9), (2, "r", 0.9), (3, "8", 0.9)], octave_low=38, vel=0.7, level=0.85, tau=0.3)
    s.pad(ch, per=2, vel=0.38, level=0.55, center=60, send=0.5, attack=0.6)
    s.drums("brush", "....o.......o...", subdiv=4, vel=0.45, pan=0.25, level=0.8)
    s.drums("shaker", "x.x.x.x.x.x.x.x.", subdiv=4, vel=0.4, pan=0.4, level=0.7)
    s.drums("wood", "x...............", bars=range(0, 16), subdiv=4, vel=0.35, pan=-0.4, level=0.55)
    return s


def song_stage() -> Song:
    """關卡：低調、不搶注意力。F 利底亞色彩、72 BPM。長音襯底、很輕的木琴分解和弦、稀疏的音樂盒單音。"""
    s = Song("stage", 72, 4, 16, seed=53, rt60=2.6, wet=0.32, damp=1.2)
    ch = ["Fmaj7", "Fmaj7", "G6", "G6", "Am7", "Am7", "Dm9", "Dm9",
          "Bbmaj7", "Bbmaj7", "Cadd9", "Cadd9", "Dm7", "Dm7", "Gm7", "C7sus"]
    mel = (
        "r:1 C6:1.5 A5:1.5 | G5:3 r:1 | r:1 D6:1.5 B5:1.5 | A5:3 r:1 |"
        " r:1 E6:1.5 C6:1.5 | B5:2 A5:2 | r:1 F6:1.5 D6:1.5 | C6:3 r:1 |"
        " r:1 D6:1.5 Bb5:1.5 | A5:3 r:1 | r:1 E6:1.5 C6:1.5 | D6:3 r:1 |"
        " r:1 F6:1.5 A5:1.5 | D6:3 r:1 | Bb5:1.5 G5:1.5 r:1 | r:4"
    )
    s.melody("musicbox", mel, vel=0.6, pan=0.15, level=1.2, jit=0.018, accent=0.03)
    s.pad(ch, per=2, vel=0.55, level=0.7, center=57, send=0.6, attack=1.1, release=1.6, overlap=0.8)
    s.arp("marimba", ch, [(0, 0, 1), (1, 2, 1), (2, 1, 1), (3, 2, 1)], low=48, vel=0.26, pan=-0.2, level=0.7, jit=0.012)
    s.bassline(ch, [(0, "r", 3.5)], bars=range(0, 16, 2), octave_low=34, vel=0.45, level=0.7, tau=0.9)
    return s


def song_boss() -> Song:
    """頭目站：A 小調、120 BPM。像小隊伍踏步：撥弦低音、木魚、輕大鼓、木琴旋律；後半段笛子加入。稍有精神但不緊張。"""
    s = Song("boss", 120, 4, 16, seed=67, rt60=1.25, wet=0.18)
    ch = ["Am", "Am", "F", "G", "Am", "Em", "F", "E7",
          "C", "G", "Am", "F", "Dm", "G", "F", "E7"]
    mel = (
        "A4:0.5 C5:0.5 E5:0.5 A5:0.5 G5:1 E5:1 | A5:0.5 G5:0.5 E5:0.5 C5:0.5 D5:1 r:1 | F5:0.5 A5:0.5 C6:0.5 A5:0.5 G5:1 F5:1 | G5:0.5 B5:0.5 D6:0.5 B5:0.5 A5:1 G5:1 |"
        " A4:0.5 C5:0.5 E5:0.5 A5:0.5 C6:1 B5:1 | B5:0.5 A5:0.5 G5:0.5 E5:0.5 G5:1 B5:1 | A5:1 F5:0.5 A5:0.5 C6:1 A5:1 | G#5:0.5 B5:0.5 E6:1 D6:1 B5:1 |"
        " E5:1 G5:1 C6:2 | B5:1 D6:1 G6:2 | E6:1 C6:1 A5:2 | F5:0.5 A5:0.5 C6:1 A5:1 F5:1 |"
        " D5:0.5 F5:0.5 A5:1 D6:1 C6:1 | B5:1 G5:1 D5:2 | C6:1 A5:1 F5:1 A5:1 | G#5:0.5 B5:0.5 D6:0.5 B5:0.5 G#5:1 r:1"
    )
    s.melody("marimba", mel, vel=0.85, pan=0.05, level=1.0, jit=0.006)
    s.melody("flute", mel, start_bar=8, vel=0.48, pan=0.2, level=0.55, jit=0.01)
    s.bassline(ch, [(0, "r", 0.45), (0.5, "r", 0.45), (1, "5", 0.45), (1.5, "r", 0.45), (2, "r", 0.45), (2.5, "r", 0.45), (3, "5", 0.45), (3.5, "8", 0.45)], octave_low=33, vel=0.62, level=0.9, tau=0.22)
    s.pad(ch, per=1, vel=0.42, level=0.55, center=57, send=0.45, attack=0.15, release=0.6)
    s.drums("kick", "o...x...o...x...", subdiv=4, vel=0.55, level=0.85)
    s.drums("wood", "..x...o...x...o.", subdiv=4, vel=0.5, pan=-0.3, level=0.8)
    s.drums("shaker", "xxxxxxxxxxxxxxxx", subdiv=4, vel=0.42, pan=0.35, level=0.65)
    s.arp("pluck", ch, [(0.5, 2, 0.5), (1.5, 3, 0.5), (2.5, 2, 0.5), (3.5, 1, 0.5)], low=57, vel=0.3, pan=-0.35, level=0.7, bars=range(4, 16), jit=0.006)
    return s


def song_ceremony() -> Song:
    """章末儀式：F 大調 112 BPM，12 小節。鐘琴與木琴唱出上行的號角感旋律，三角鐵、鈴鼓、小拍手，歡慶。"""
    s = Song("ceremony", 112, 4, 12, seed=79, rt60=2.1, wet=0.28)
    ch = ["F", "Bb", "C", "F", "Dm", "Bb", "C", "C7sus", "F", "Gm7", "C7", "C7sus"]
    mel = (
        "C5:0.5 F5:0.5 A5:1 C6:1.5 A5:0.5 | D6:1 C6:0.5 Bb5:0.5 D6:2 | C6:1 E6:1 G6:2 | A6:1.5 G6:0.5 F6:2 |"
        " D6:1 F6:1 A5:1 D6:1 | D6:0.5 F6:0.5 Bb6:1 A6:1 F6:1 | G5:0.5 C6:0.5 E6:1 G6:1 E6:1 | Bb5:1 G5:1 E5:2 |"
        " F5:0.5 A5:0.5 C6:0.5 F6:0.5 A6:2 | G6:1 F6:0.5 D6:0.5 Bb5:1 D6:1 | E6:1 G6:1 Bb6:1 A6:1 | G6:2 E6:1 C6:1"
    )
    s.melody("glock", mel, vel=0.78, pan=0.1, level=0.85, jit=0.006, accent=0.15)
    s.melody("marimba", mel, vel=0.6, pan=-0.12, level=0.8, octave=-1, jit=0.008)
    s.melody("flute", mel, start_bar=0, vel=0.4, pan=0.22, level=0.35, octave=0, jit=0.012)
    s.pad(ch, per=1, vel=0.52, level=0.5, center=58, send=0.55, attack=0.25, release=0.9)
    s.bassline(ch, [(0, "r", 0.9), (1, "5", 0.9), (2, "r", 0.9), (3, "5", 0.45), (3.5, "8", 0.45)], octave_low=36, vel=0.7, level=0.9, tau=0.3)
    s.strum(ch, [(0.5, "u", 0.5), (1.5, "u", 0.5), (2.5, "u", 0.5), (3.5, "u", 0.5)], low=55, vel=0.4, pan=-0.25, level=0.7)
    s.drums("kick", "o...x...o...x...", subdiv=4, vel=0.5, level=0.8)
    s.drums("clap", "....x.......x...", subdiv=4, vel=0.5, pan=0.1, level=0.7)
    s.drums("tambourine", "..x...x...x...x.", subdiv=4, vel=0.5, pan=0.4, level=0.75)
    s.drums("shaker", "xxxxxxxxxxxxxxxx", subdiv=4, vel=0.38, pan=-0.4, level=0.6)
    s.hit("triangle", 0, 0.0, 0.7, 0.35, level=0.8)
    s.hit("triangle", 4, 0.0, 0.6, 0.35, level=0.7)
    s.hit("triangle", 8, 0.0, 0.7, 0.35, level=0.8)
    return s


def song_paint() -> Song:
    """著色與連連看：降 E 大調、88 BPM、輕輕搖擺。電鋼琴和弦、笛子旋律、豎琴點綴、刷子與撥弦低音，悠閒有創作感。"""
    s = Song("paint", 88, 4, 16, seed=83, rt60=2.0, wet=0.26, swing=0.09)
    ch = ["Ebmaj7", "Cm7", "Abmaj7", "Bb7sus", "Ebmaj9", "Gm7", "Abmaj7", "Bb7",
          "Cm7", "Fm7", "Bb7", "Ebmaj7", "Abmaj7", "Gm7", "Fm7", "Bb7sus"]
    mel = (
        "r:1 G5:1 Bb5:1.5 G5:0.5 | Eb6:1.5 D6:0.5 C6:2 | C6:1 Eb6:1 G6:2 | F6:1 Eb6:1 Bb5:1 r:1 |"
        " r:1 G5:1 Bb5:1 F6:1 | D6:1.5 Bb5:0.5 G5:2 | Ab5:1 C6:1 Eb6:1.5 C6:0.5 | D6:1 Ab5:1 F5:2 |"
        " G5:1.5 Bb5:0.5 C6:2 | Ab5:1 C6:1 Eb6:1 C6:1 | D6:1 F6:1 Ab5:2 | G5:1 Bb5:1 Eb6:2 |"
        " C6:1.5 Eb6:0.5 G6:2 | F6:1 D6:1 Bb5:2 | Ab5:1 C6:1 F6:2 | Eb6:1 D6:0.5 Bb5:0.5 F5:2"
    )
    s.melody("flute", mel, vel=0.62, pan=0.12, level=0.9, jit=0.012, accent=0.05)
    s.melody("musicbox", mel, start_bar=8, vel=0.3, pan=0.3, octave=1, level=0.35, jit=0.014)
    # 電鋼琴和弦：每小節第 1 拍與「3 的後半拍」各彈一次（切分）
    voic = voice_lead(ch, 60, 4)
    for b in range(16):
        for k, (beat, dur, v) in enumerate(((0.0, 2.4, 0.7), (2.5, 1.2, 0.55))):
            for m in voic[b]:
                s.note("ep", m, b, beat + 0.0, dur, v, pan=-0.12, send=0.35, jit=0.012, level=0.8)
    s.bassline(ch, [(0, "r", 1.4), (2.5, "5", 1.0)], octave_low=35, vel=0.65, level=0.85, tau=0.45)
    s.drums("brush", "....o.......o...", subdiv=4, vel=0.45, pan=0.25, level=0.7)
    s.drums("shaker", "x.x.x.x.x.x.x.x.", subdiv=4, vel=0.33, pan=-0.35, level=0.55)
    s.arp("pluck", ch, [(1.5, 5, 0.5), (3.5, 6, 0.5)], low=55, vel=0.26, pan=0.35, level=0.6, bars=range(0, 16, 2), bright=0.7, jit=0.012)
    return s


def song_story() -> Song:
    """有聲繪本（線 P）：說故事的背景。D 大調 66 BPM。音都在人聲之上或之下、旋律很疏：豎琴分解和弦、音樂盒長音、很輕的長音墊底，沒有打擊。"""
    s = Song("story", 66, 4, 16, seed=97, rt60=2.8, wet=0.34, damp=1.2)
    ch = ["Dmaj7", "Bm7", "Gmaj7", "A7sus", "Dmaj7", "F#m7", "Gmaj7", "A7",
          "Bm7", "F#m7", "Gmaj7", "Dadd9", "Em7", "A7", "Gmaj7", "A7sus"]
    mel = (
        "F#5:2 A5:2 | B5:3 r:1 | D6:1.5 B5:0.5 A5:2 | E5:3 r:1 |"
        " F#5:2 A5:2 | C#6:3 r:1 | D6:1 B5:1 G5:2 | A5:3 r:1 |"
        " B5:2 D6:2 | C#6:1.5 A5:0.5 F#5:2 | G5:1 B5:1 D6:2 | A5:3 r:1 |"
        " G5:1.5 B5:0.5 E6:2 | C#6:2 A5:2 | B5:1 G5:1 D5:2 | E5:2 A5:1 r:1"
    )
    s.melody("musicbox", mel, vel=0.62, pan=0.08, level=0.85, jit=0.012, accent=0.05)
    s.melody("glock", mel, start_bar=8, vel=0.24, pan=-0.2, octave=1, level=0.32, jit=0.014)
    s.arp("pluck", ch, [(0, 0, 1.5), (1, 2, 1.5), (2, 3, 1.5), (3, 2, 1.5)], low=43, vel=0.32, pan=-0.28, level=0.75, bright=0.55, tau1=1.7, jit=0.01)
    s.pad(ch, per=1, vel=0.46, level=0.5, center=54, send=0.6, attack=0.9, release=1.6, count=3, overlap=0.5)
    s.bassline(ch, [(0, "r", 3.4)], octave_low=34, vel=0.4, level=0.75, tau=0.9)
    return s


def song_playground() -> Song:
    """遊樂場（v8.5 線 AF）：A 大調 118 BPM、明顯的搖擺。木琴唱旋律（三個八分音符加一個休止，跳一下停一下），
    低音在根音、高八度、五音之間彈來彈去，烏克麗麗只刷反拍，音樂盒在空拍回應兩個音；木魚、沙錘、很輕的大鼓。"""
    sw = 0.12
    s = Song("playground", 118, 4, 16, seed=101, rt60=1.4, wet=0.20, swing=sw)
    ch = ["A", "A", "D", "E7", "A", "F#m", "D", "E7",
          "D", "A", "Bm7", "E7", "A", "F#m", "Bm7", "E7"]
    mel = (
        "A4:0.5 C#5:0.5 E5:0.5 r:0.5 A5:0.5 E5:0.5 C#5:1 | E5:0.5 F#5:0.5 E5:0.5 r:0.5 C#5:1 r:1 | D5:0.5 F#5:0.5 A5:0.5 r:0.5 B5:0.5 A5:0.5 F#5:1 | G#5:0.5 B5:0.5 G#5:0.5 r:0.5 E5:1 r:1 |"
        " A4:0.5 C#5:0.5 E5:0.5 r:0.5 A5:0.5 C#6:0.5 A5:1 | C#6:0.5 B5:0.5 A5:0.5 r:0.5 F#5:1 A5:1 | F#5:0.5 A5:0.5 D6:1 C#6:0.5 B5:0.5 A5:1 | B5:1 G#5:0.5 E5:0.5 B4:1 r:1 |"
        " F#5:1 r:0.5 A5:0.5 D6:1 A5:1 | E5:1 r:0.5 A5:0.5 C#6:1 A5:1 | D5:0.5 F#5:0.5 B5:1 A5:0.5 F#5:0.5 D5:1 | E5:0.5 G#5:0.5 B5:0.5 D6:0.5 E6:1 r:1 |"
        " A4:0.5 C#5:0.5 E5:0.5 r:0.5 A5:0.5 E5:0.5 C#6:1 | C#6:0.5 A5:0.5 F#5:0.5 r:0.5 A5:1 F#5:1 | B5:0.5 A5:0.5 F#5:0.5 D5:0.5 F#5:1 B5:1 | A5:0.5 G#5:0.5 E5:0.5 r:0.5 B4:0.5 D5:0.5 E5:1"
    )
    # 旋律休息的那一拍，音樂盒回兩個音（像朋友在旁邊跟著跳）
    ans = (
        "r:4 | r:3 C#6:0.5 E6:0.5 | r:4 | r:3 B5:0.5 E6:0.5 |"
        " r:4 | r:4 | r:4 | r:3 D6:0.5 E6:0.5 |"
        " r:4 | r:4 | r:4 | r:3 B5:0.5 G#5:0.5 |"
        " r:4 | r:4 | r:4 | r:4"
    )
    s.melody("xylo", mel, vel=0.85, pan=0.06, level=1.0, jit=0.006)
    s.melody("marimba", mel, vel=0.5, pan=-0.1, octave=-1, level=0.6, jit=0.008)
    s.melody("musicbox", ans, vel=0.5, pan=0.3, level=0.5, jit=0.01, accent=0.0)
    # 反拍刷弦：拍點直接寫成搖擺後的位置（自動搖擺只會移動第一根弦，四根弦會散掉）
    s.strum(ch, [(0.5 + sw, "u", 0.8), (1.5 + sw, "u", 0.65), (2.5 + sw, "u", 0.8), (3.5 + sw, "u", 0.65)], low=54, vel=0.5, pan=-0.22, level=0.85)
    s.bassline(ch, [(0, "r", 0.5), (1, "8", 0.35), (2, "5", 0.5), (3, "8", 0.35)], octave_low=40, vel=0.7, level=0.9, tau=0.22)
    s.pad(ch, per=1, vel=0.36, level=0.5, center=61, send=0.5, attack=0.3, release=0.7)
    s.drums("kick", "x.......x.......", bars=range(4, 16), subdiv=4, vel=0.45, level=0.75)
    s.drums("wood", "....x.......o...", subdiv=4, vel=0.45, pan=-0.35, level=0.75)
    s.drums("shaker", "x.x.x.x.x.x.x.x.", subdiv=4, vel=0.42, pan=0.35, level=0.7)
    s.drums("tambourine", "....x.......x...", bars=range(8, 16), subdiv=4, vel=0.4, pan=0.4, level=0.6)
    return s


def song_town() -> Song:
    """快樂小街（v8.5 線 AF）：降 B 大調 96 BPM、輕輕搖擺，像散步。和弦一級一級往上走再走回來。
    單簧管唱旋律（後半段木琴疊上來），木魚一低一高當腳步聲，低音前半段兩拍一步、後半段一拍一步，
    烏克麗麗輕輕刷第 2、4 拍，音樂盒偶爾叮兩下（像店門口的鈴）。"""
    sw = 0.10
    s = Song("town", 96, 4, 16, seed=103, rt60=1.7, wet=0.24, swing=sw)
    ch = ["Bb6", "Cm7", "Dm7", "Ebmaj7", "Dm7", "Gm7", "Cm7", "F7",
          "Ebmaj7", "Dm7", "Cm7", "Bb6", "Gm7", "Cm7", "F7sus", "F7"]
    mel_a = (
        "D5:1.5 F5:0.5 G5:1 F5:1 | Eb5:1.5 G5:0.5 Bb5:2 | A5:1 F5:0.5 D5:0.5 F5:1 A5:1 | G5:2 r:0.5 Bb4:0.5 D5:0.5 Eb5:0.5 |"
        " F5:1.5 D5:0.5 A5:1 F5:1 | G5:1 Bb5:0.5 D6:0.5 Bb5:2 | C6:1 Bb5:0.5 G5:0.5 Eb5:1 G5:1 | F5:1.5 Eb5:0.5 C5:1 r:1"
    )
    mel_b = (
        "Bb5:1 G5:1 Eb5:0.5 G5:0.5 Bb5:1 | A5:1 F5:1 D5:2 | G5:1 Eb5:1 C5:0.5 Eb5:0.5 G5:1 | F5:1.5 G5:0.5 D5:1 r:1 |"
        " D5:0.5 G5:0.5 Bb5:1 D6:1.5 Bb5:0.5 | C6:1 G5:1 Eb5:1 G5:1 | Bb5:1.5 C6:0.5 Bb5:1 F5:1 | A5:1 G5:0.5 Eb5:0.5 C5:1 r:1"
    )
    s.melody("clarinet", mel_a + " | " + mel_b, vel=0.7, pan=0.08, level=1.0, jit=0.01, accent=0.06)
    # 後半段木琴疊同一段旋律（只給後半段的音，start_bar=8 才不會整首錯開 8 小節）
    s.melody("marimba", mel_b, start_bar=8, vel=0.42, pan=0.25, level=0.7, jit=0.012)
    s.strum(ch, [(1, "d", 0.7), (2.5 + sw, "u", 0.45), (3, "d", 0.6)], low=53, vel=0.45, pan=-0.22, level=0.8)
    s.bassline(ch, [(0, "r", 1.7), (2, "5", 1.7)], bars=range(0, 8), octave_low=38, vel=0.62, level=0.9, tau=0.5)
    s.bassline(ch, [(0, "r", 0.9), (1, "3", 0.9), (2, "5", 0.9), (3, "3", 0.9)], bars=range(8, 16), octave_low=38, vel=0.62, level=0.85, tau=0.34)
    s.pad(ch, per=1, vel=0.42, level=0.45, center=60, send=0.5, attack=0.5, release=0.9)
    # 腳步聲：左腳低、右腳高
    s.drums("wood", "x.......x.......", subdiv=4, vel=0.4, pan=-0.3, level=0.7, f=820.0, tau=0.022)
    s.drums("wood", "....x.......x...", subdiv=4, vel=0.36, pan=0.3, level=0.65, f=1040.0, tau=0.02)
    s.drums("brush", "....x.......o...", bars=range(4, 16), subdiv=4, vel=0.4, pan=0.2, level=0.65)
    s.drums("shaker", "..x...x...x...x.", subdiv=4, vel=0.3, pan=0.4, level=0.5)
    s.arp("musicbox", ch, [(2.5, 5, 0.5), (3.5, 6, 0.5)], low=58, vel=0.3, pan=0.32, level=0.55, bars=range(1, 16, 2), jit=0.012)
    return s


SONGS = {
    "story": song_story,
    "title": song_title,
    "home-day": song_home_day,
    "home-night": song_home_night,
    "map": song_map,
    "stage": song_stage,
    "boss": song_boss,
    "ceremony": song_ceremony,
    "paint": song_paint,
    "playground": song_playground,
    "town": song_town,
}

# 場景 → 目標響度修正（LU）。stage 要低調，其餘維持 −24 LUFS
SCENE_LUFS_OFFSET = {"stage": -1.0}

# ---------------------------------------------------------------------------
# 音效
# ---------------------------------------------------------------------------


class Sfx:
    """單聲道音效的疊層工具（非循環，尾端不折回）。"""

    def __init__(self, seed: int, length: float):
        self.rng = np.random.default_rng(seed)
        self.n = int(length * SR)
        self.buf = np.zeros(self.n)
        self.send = np.zeros(self.n)

    def add(self, sig: np.ndarray, t: float, gain: float = 1.0, send: float = 0.0) -> None:
        add_at(self.buf, sig * gain, int(t * SR), False)
        if send:
            add_at(self.send, sig * gain * send, int(t * SR), False)

    def note(self, inst: str, midi: float, t: float, vel: float = 0.8, gain: float = 1.0, send: float = 0.0, **kw) -> None:
        fn, _ = INSTR[inst]
        self.add(fn(mtof(midi), 0.3, vel, self.rng, **kw), t, gain * vel, send)

    def finish(self, rt60: float = 0.0, wet: float = 0.0, tail_fade: float = 0.04, max_len: float | None = None) -> np.ndarray:
        x = self.buf
        if rt60 > 0 and wet > 0:
            ir = make_ir(rt60, 5, n_extra=1.0)
            r = np.fft.irfft(np.fft.rfft(self.send, self.n + len(ir)) * np.fft.rfft(ir, self.n + len(ir)), self.n + len(ir))
            x = np.concatenate([x, np.zeros(len(r) - len(x))]) + r * wet
        # 去掉尾端靜音（< −66 dB）並淡出，避免尾巴被剪出喀聲
        thr = max(np.max(np.abs(x)) * 10 ** (-66 / 20), 1e-6)
        idx = np.nonzero(np.abs(x) > thr)[0]
        end = int(idx[-1]) + 1 if len(idx) else len(x)
        x = x[:end]
        if max_len:
            x = x[: int(max_len * SR)]
        x = x * fade_out(len(x), tail_fade) * fade_in(len(x), 0.0004)
        return fft_filter(x, hp=60.0, order=2)


def sfx_tap() -> np.ndarray:
    s = Sfx(1, 0.3)
    s.add(perc_wood(0.8, s.rng, f=980.0, tau=0.016), 0.0, 1.0)
    t = tarr(int(0.06 * SR))
    s.add(np.sin(2 * np.pi * 360 * t) * np.exp(-t / 0.014) * 0.5, 0.0)
    return s.finish(0.35, 0.0, 0.015, 0.12)


def sfx_pop() -> np.ndarray:
    s = Sfx(2, 0.5)
    n = int(0.16 * SR)
    t = tarr(n)
    fr = 260 + 700 * (1 - np.exp(-t / 0.022))
    ph = 2 * np.pi * np.cumsum(fr) / SR
    body = np.sin(ph) * np.exp(-t / 0.045) * fade_in(n, 0.001)
    body += 0.25 * np.sin(2 * ph) * np.exp(-t / 0.02)
    s.add(body, 0.0, 0.8)
    k = int(0.018 * SR)
    s.add(fft_filter(noise(k, s.rng), hp=1500, lp=5000) * np.hanning(k) * 0.35, 0.0)
    return s.finish(0.35, 0.0, 0.03, 0.2)


def sfx_correct() -> np.ndarray:
    s = Sfx(3, 1.8)
    s.note("marimba", name_to_midi("G5"), 0.0, 0.8, 0.9, 0.35)
    s.note("marimba", name_to_midi("C6"), 0.11, 0.95, 1.0, 0.4)
    s.note("musicbox", name_to_midi("C7"), 0.11, 0.7, 0.34, 0.5)
    s.note("glock", name_to_midi("E6"), 0.18, 0.55, 0.28, 0.5)
    return s.finish(0.8, 0.45, 0.2, 1.05)


def sfx_wrong() -> np.ndarray:
    """溫柔的「嗯？」：木質小二度下行（F4→D4），圓潤、沒有刺耳的高頻，不是失敗的喇叭聲。"""
    s = Sfx(4, 1.5)
    s.note("marimba", name_to_midi("F4"), 0.0, 0.7, 1.0, 0.3)
    s.note("marimba", name_to_midi("D4"), 0.17, 0.62, 1.0, 0.3)
    t = tarr(int(0.5 * SR))
    s.add(np.sin(2 * np.pi * mtof(name_to_midi("D3")) * t) * np.exp(-t / 0.2) * fade_in(len(t), 0.01) * 0.25, 0.17)
    return fft_filter(s.finish(0.6, 0.3, 0.2, 0.95), lp=3800)


def sfx_reward() -> np.ndarray:
    s = Sfx(5, 2.4)
    notes = ["C5", "E5", "G5", "C6", "E6"]
    for i, nm in enumerate(notes):
        s.note("marimba", name_to_midi(nm), i * 0.075, 0.8, 0.8, 0.35)
        s.note("glock", name_to_midi(nm) + 12, i * 0.075 + 0.01, 0.5, 0.25, 0.5)
    t0 = len(notes) * 0.075
    for nm, g in (("C6", 0.8), ("E6", 0.7), ("G6", 0.7)):
        s.note("musicbox", name_to_midi(nm), t0, 0.75, g * 0.45, 0.55)
    s.note("glock", name_to_midi("C7"), t0 + 0.04, 0.6, 0.3, 0.6)
    return s.finish(1.0, 0.5, 0.35, 1.8)


def sfx_coin() -> np.ndarray:
    s = Sfx(6, 1.4)
    s.note("glock", name_to_midi("B5"), 0.0, 0.8, 0.6, 0.4)
    s.note("glock", name_to_midi("E6"), 0.075, 1.0, 0.8, 0.5)
    s.note("musicbox", name_to_midi("E7"), 0.08, 0.6, 0.3, 0.4)
    k = int(0.004 * SR)
    s.add(fft_filter(noise(k, s.rng), hp=2500) * np.hanning(k) * 0.3, 0.0)
    return s.finish(0.6, 0.35, 0.2, 0.9)


def sfx_whoosh() -> np.ndarray:
    s = Sfx(7, 0.8)
    n = int(0.55 * SR)
    t = tarr(n)
    base = noise(n, s.rng)
    out = np.zeros(n)
    centers = np.geomspace(350, 3200, 9)
    for i, c in enumerate(centers):
        band = fft_filter(base, hp=c * 0.72, lp=c * 1.4, order=2)
        pos = (i + 0.5) / len(centers)
        w = np.exp(-0.5 * ((t / t[-1] - pos) / 0.14) ** 2)
        out += band * w
    env = np.sin(np.pi * np.clip(t / t[-1], 0, 1)) ** 1.6
    s.add(out * env * 0.55, 0.0)
    return s.finish(0.0, 0.0, 0.1, 0.6)


def sfx_page() -> np.ndarray:
    s = Sfx(8, 0.5)
    for off, g, hp in ((0.0, 0.8, 1800), (0.055, 0.45, 2600)):
        n = int(0.11 * SR)
        t = tarr(n)
        x = fft_filter(noise(n, s.rng), hp=hp, lp=9000)
        s.add(x * (1 - np.exp(-t / 0.008)) * np.exp(-t / 0.032), off, g * 0.5)
    t = tarr(int(0.08 * SR))
    s.add(np.sin(2 * np.pi * 220 * t) * np.exp(-t / 0.02) * 0.15, 0.0)
    return s.finish(0.3, 0.0, 0.04, 0.2)


def sfx_unlock() -> np.ndarray:
    s = Sfx(9, 2.4)
    run = ["C5", "D5", "E5", "G5", "A5", "C6", "D6"]
    for i, nm in enumerate(run):
        s.note("pluck", name_to_midi(nm), i * 0.06, 0.75, 0.9, 0.4, bright=0.8, tau1=1.0)
    t0 = len(run) * 0.06 + 0.02
    for nm, g in (("E6", 0.8), ("G6", 0.7), ("C7", 0.6)):
        s.note("glock", name_to_midi(nm), t0, 0.8, g * 0.35, 0.6)
    s.note("musicbox", name_to_midi("G6"), t0 + 0.05, 0.7, 0.35, 0.6)
    return s.finish(1.0, 0.5, 0.35, 1.9)


def sfx_hatch() -> np.ndarray:
    s = Sfx(10, 3.0)
    for i, (off, f) in enumerate(((0.0, 920), (0.13, 1020), (0.25, 1130))):
        s.add(perc_wood(0.9, s.rng, f=f, tau=0.012), off, 0.9 - 0.1 * i)
    # 啵
    n = int(0.14 * SR)
    t = tarr(n)
    fr = 300 + 800 * (1 - np.exp(-t / 0.02))
    s.add(np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-t / 0.05) * 0.8, 0.42)
    # 小小的上行旋律 + 雛鳥啾啾
    for i, nm in enumerate(["E5", "G5", "C6", "E6"]):
        s.note("musicbox", name_to_midi(nm), 0.58 + i * 0.1, 0.8, 0.5, 0.5)
        s.note("marimba", name_to_midi(nm) - 12, 0.58 + i * 0.1, 0.6, 0.6, 0.3)
    nn = int(0.28 * SR)
    tt = tarr(nn)
    fr = 1500 + 500 * np.sin(2 * np.pi * 7.0 * tt) * np.exp(-tt / 0.2) + 420 * np.sin(np.pi * tt / tt[-1])
    chirp = np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.sin(np.pi * tt / tt[-1]) ** 1.2
    s.add(chirp * 0.25, 1.05, 1.0, 0.3)
    for nm in ("C6", "E6", "G6"):
        s.note("glock", name_to_midi(nm), 1.12, 0.7, 0.25, 0.6)
    return s.finish(1.0, 0.45, 0.4, 2.6)


def sfx_drop() -> np.ndarray:
    s = Sfx(11, 0.7)
    n = int(0.3 * SR)
    t = tarr(n)
    fr = 62 + 120 * np.exp(-t / 0.03)
    s.add(np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-t / 0.075) * 0.8, 0.0)
    k = int(0.03 * SR)
    s.add(fft_filter(noise(k, s.rng), lp=700) * np.hanning(k) * 0.5, 0.0)
    s.note("marimba", name_to_midi("F3"), 0.0, 0.6, 0.5, 0.25)
    return s.finish(0.4, 0.15, 0.1, 0.5)


def sfx_sparkle() -> np.ndarray:
    s = Sfx(12, 2.2)
    seq = ["E7", "C7", "D7", "A6", "G6", "E6", "C6"]
    for i, nm in enumerate(seq):
        s.note("glock", name_to_midi(nm), i * 0.058, 0.55 - 0.04 * i, 0.55, 0.6)
    for i, nm in enumerate(["G6", "E7"]):
        s.note("musicbox", name_to_midi(nm), 0.1 + i * 0.12, 0.5, 0.3, 0.6)
    return s.finish(0.9, 0.45, 0.3, 1.5)


# ----- v8.5 線 AF：六個新音效 -----


def soft_peak(x: np.ndarray, drive: float = 1.6) -> np.ndarray:
    """把零星的尖峰壓圓（tanh），峰值不變、整體比較飽滿。雜訊類的短音效峰值很高，不壓的話正規化之後會太小聲。"""
    pk = float(np.max(np.abs(x))) + 1e-12
    return np.tanh(drive * x / pk) / math.tanh(drive) * pk


def sfx_boing() -> np.ndarray:
    """彈跳：音高從低往上滑（跳起來），前面帶一圈一圈變小的抖動（彈簧），一點點木頭的起跳聲。"""
    s = Sfx(13, 0.8)
    n = int(0.5 * SR)
    t = tarr(n)
    glide = 210 + 300 * (1 - np.exp(-t / 0.12))
    wob = 1 + 0.17 * np.exp(-t / 0.17) * np.sin(2 * np.pi * 12.5 * t)
    ph = 2 * np.pi * np.cumsum(glide * wob) / SR
    body = np.sin(ph) + 0.42 * np.sin(2 * ph) * np.exp(-t / 0.14) + 0.16 * np.sin(3 * ph) * np.exp(-t / 0.08)
    s.add(body * np.exp(-t / 0.16) * fade_in(n, 0.004), 0.0, 0.8)
    s.add(perc_wood(0.6, s.rng, f=520.0, tau=0.012), 0.0, 0.3)
    return s.finish(0.3, 0.0, 0.06, 0.45)


def sfx_splash() -> np.ndarray:
    """水花：兩層帶通雜訊（高的那層收得快，不嘶）、一個往上滑的「撲通」、幾顆濺起來的小水珠。"""
    s = Sfx(14, 1.0)
    n = int(0.5 * SR)
    t = tarr(n)
    lo = fft_filter(noise(n, s.rng), hp=350, lp=2200)
    hi = fft_filter(noise(n, s.rng), hp=1800, lp=6000)
    s.add(lo * (1 - np.exp(-t / 0.012)) * np.exp(-t / 0.11) * 0.5 + hi * (1 - np.exp(-t / 0.006)) * np.exp(-t / 0.055) * 0.32, 0.0, 1.0, 0.25)
    k = int(0.12 * SR)
    u = tarr(k) / (k / SR)
    s.add(np.sin(2 * np.pi * np.cumsum(210 + 520 * u**1.6) / SR) * np.sin(np.pi * u) ** 0.8, 0.015, 0.22)
    for off, f0, g in ((0.13, 1250, 0.16), (0.19, 1700, 0.13), (0.26, 1050, 0.10), (0.33, 1500, 0.08), (0.41, 1900, 0.05)):
        k = int(0.045 * SR)
        u = tarr(k) / (k / SR)
        s.add(np.sin(2 * np.pi * np.cumsum(f0 * (1 + 0.55 * u**1.5)) / SR) * np.sin(np.pi * u) ** 1.2, off, g, 0.4)
    return soft_peak(s.finish(0.5, 0.3, 0.1, 0.7))


def sfx_munch() -> np.ndarray:
    """吃東西咬三口：每一口是脆脆的顆粒雜訊（咬下去）加一個音高往下掉的「嗯」（嘴巴合起來），三口音高略有不同。"""
    s = Sfx(15, 1.0)
    for off, pm, g in ((0.0, 1.0, 1.0), (0.19, 1.14, 0.9), (0.37, 0.92, 0.85)):
        k = int(0.075 * SR)
        tk = tarr(k)
        grain = np.repeat(s.rng.uniform(0.25, 1.0, k // 96 + 1), 96)[:k]  # 2 ms 一粒
        s.add(fft_filter(noise(k, s.rng), hp=650, lp=3600) * grain * (1 - np.exp(-tk / 0.002)) * np.exp(-tk / 0.022), off, 0.9 * g)
        m = int(0.13 * SR)
        tm = tarr(m)
        ph = 2 * np.pi * np.cumsum(pm * (185 + 150 * np.exp(-tm / 0.035))) / SR
        om = (np.sin(ph) + 0.35 * np.sin(2 * ph) * np.exp(-tm / 0.03)) * (1 - np.exp(-tm / 0.008)) * np.exp(-tm / 0.05)
        s.add(om, off + 0.012, 0.4 * g)
    # 顆粒的邊緣和 tanh 會多出很高的頻率，最後再收掉
    return fft_filter(soft_peak(s.finish(0.3, 0.0, 0.05, 0.6)), lp=4500)


def sfx_cheer() -> np.ndarray:
    """短短的「耶」（不是人聲）：兩支笛子一樣的聲音一起往上滑再停住（A5→D6、F#5→A5），落地時木琴與鐘琴的 D 大三和弦、鈴鼓、兩下拍手。"""
    s = Sfx(16, 1.6)
    n = int(0.5 * SR)
    t = tarr(n)
    up = np.clip(t / 0.13, 0, 1) ** 0.8
    vib = 1 + 0.012 * np.clip((t - 0.2) / 0.15, 0, 1) * np.sin(2 * np.pi * 6.5 * t)
    env = fade_in(n, 0.03) * fade_out(n, 0.22)
    for a, b, g in (("A5", "D6", 0.4), ("F#5", "A5", 0.26)):
        f0, f1 = mtof(name_to_midi(a)), mtof(name_to_midi(b))
        ph = 2 * np.pi * np.cumsum(f0 * (f1 / f0) ** up * vib) / SR
        s.add((np.sin(ph) + 0.24 * np.sin(2 * ph) + 0.08 * np.sin(3 * ph)) * env, 0.0, g, 0.4)
    t1 = 0.13
    for nm, g in (("D5", 0.8), ("F#5", 0.6), ("A5", 0.6)):
        s.note("marimba", name_to_midi(nm), t1, 0.85, g, 0.35)
    for nm, g in (("D6", 0.30), ("F#6", 0.26), ("A6", 0.22)):
        s.note("glock", name_to_midi(nm), t1 + 0.01, 0.6, g, 0.5)
    s.add(perc_tambourine(0.8, s.rng), t1, 0.5, 0.2)
    s.add(perc_clap(0.8, s.rng), t1, 0.5, 0.15)
    s.add(perc_clap(0.8, s.rng), t1 + 0.17, 0.4, 0.15)
    return s.finish(0.7, 0.4, 0.2, 0.95)


def sfx_fanfare() -> np.ndarray:
    """得到新玩具的小號角：玩具小號「答、答答、答、答、答——」（C5 C5 C5 F5 A5 → C6 長音），長音下面疊 F 大三和弦，
    落地時有鐘琴、鈴鼓和一下很輕的鼓。比 reward 隆重，但還是圓圓的、不大聲。"""
    s = Sfx(17, 2.4)
    for nm, t0, d, v in (("C5", 0.0, 0.13, 0.8), ("C5", 0.16, 0.06, 0.65), ("C5", 0.24, 0.06, 0.7), ("F5", 0.32, 0.13, 0.85), ("A5", 0.48, 0.13, 0.9)):
        s.add(inst_brass(mtof(name_to_midi(nm)), d, v, s.rng), t0, v, 0.35)
    t1 = 0.64
    for nm, g in (("C6", 1.0), ("A5", 0.6), ("F5", 0.55), ("F4", 0.4)):
        s.add(inst_brass(mtof(name_to_midi(nm)), 0.5, 0.9, s.rng), t1, g, 0.4)
    for nm, g in (("F6", 0.30), ("A6", 0.24), ("C7", 0.20)):
        s.note("glock", name_to_midi(nm), t1 + 0.01, 0.6, g, 0.55)
    s.add(perc_kick(0.8, s.rng), t1, 0.5)
    s.add(perc_tambourine(0.8, s.rng), t1, 0.3, 0.2)
    return s.finish(0.9, 0.45, 0.3, 1.3)


def sfx_squeak() -> np.ndarray:
    """橡皮玩具吱一聲：音高很快上去再下來（最高約 1.5 kHz，不尖），帶一點細細的抖動；後面一個比較低、比較小聲的「放開」。"""
    s = Sfx(18, 0.6)
    n = int(0.16 * SR)
    t = tarr(n)
    u = t / (n / SR)
    ph = 2 * np.pi * np.cumsum((900 + 560 * np.sin(np.pi * u) ** 0.8 + 120 * u) * (1 + 0.045 * np.sin(2 * np.pi * 42 * t))) / SR
    s.add((np.sin(ph) + 0.22 * np.sin(2 * ph) + 0.06 * np.sin(3 * ph)) * np.sin(np.pi * u) ** 0.6, 0.0, 0.6)
    k = int(0.08 * SR)
    uk = tarr(k) / (k / SR)
    ph2 = 2 * np.pi * np.cumsum(900 - 240 * uk) / SR
    s.add((np.sin(ph2) + 0.2 * np.sin(2 * ph2)) * np.sin(np.pi * uk) ** 0.8, 0.185, 0.2)
    return s.finish(0.25, 0.0, 0.03, 0.3)


SFX = {
    "tap": sfx_tap,
    "pop": sfx_pop,
    "correct": sfx_correct,
    "wrong": sfx_wrong,
    "reward": sfx_reward,
    "coin": sfx_coin,
    "whoosh": sfx_whoosh,
    "page": sfx_page,
    "unlock": sfx_unlock,
    "hatch": sfx_hatch,
    "drop": sfx_drop,
    "sparkle": sfx_sparkle,
    "boing": sfx_boing,
    "splash": sfx_splash,
    "munch": sfx_munch,
    "cheer": sfx_cheer,
    "fanfare": sfx_fanfare,
    "squeak": sfx_squeak,
}

# 取樣峰值上限（dBFS）。預設 −2；雜訊多的音效經過 AAC 之後真峰值會比取樣峰值高約 1 dB，所以另外壓低一點
SFX_PEAK_CAP = {"splash": -3.2, "munch": -3.2}

# ---------------------------------------------------------------------------
# 分析（我聽不到，所以算頻譜與包絡）
# ---------------------------------------------------------------------------


def analyze(x: np.ndarray, spb_bar: float | None = None) -> dict:
    """x: (ch, n)。回傳頻帶能量、頻譜重心、每小節 RMS 範圍。"""
    mono = x.mean(axis=0)
    spec = np.abs(np.fft.rfft(mono * np.hanning(len(mono)))) ** 2
    f = np.fft.rfftfreq(len(mono), 1.0 / SR)
    tot = spec.sum() + 1e-18

    def band(lo: float, hi: float) -> float:
        return float(10 * math.log10(spec[(f >= lo) & (f < hi)].sum() / tot + 1e-12))

    out = {
        "centroid_hz": float((spec * f).sum() / tot),
        "bands_db": {"<200": band(0, 200), "200-1k": band(200, 1000), "1-4k": band(1000, 4000), "4-8k": band(4000, 8000), ">8k": band(8000, 30000)},
        "crest_db": float(20 * math.log10(np.max(np.abs(x)) / (np.sqrt(np.mean(x**2)) + 1e-12))),
        "side_ratio_db": float(10 * math.log10((np.mean((x[0] - x[1]) ** 2) + 1e-18) / (np.mean((x[0] + x[1]) ** 2) + 1e-18))),
    }
    if spb_bar:
        k = int(spb_bar * SR)
        nb = len(mono) // k
        rms = [float(20 * math.log10(np.sqrt(np.mean(mono[i * k : (i + 1) * k] ** 2)) + 1e-9)) for i in range(nb)]
        out["bar_rms_db_range"] = (round(min(rms), 1), round(max(rms), 1))
        out["bar_rms_db_first_last"] = (round(rms[0], 1), round(rms[-1], 1))
    return out


def verify_loop(m4a: Path, L: int, src: np.ndarray) -> dict:
    """解碼 m4a，估編碼延遲，檢查 loopStart/loopEnd 接縫的不連續程度（和一般相鄰樣本差距比）。"""
    dec = read_f32(m4a, src.shape[0])
    # 估延遲：用開頭 1 秒的互相關
    n = SR
    a = src[0, PRE : PRE + n]
    best, best_lag = -1.0, 0
    for lag in range(0, 4400, 1):
        seg = dec[0, PRE + lag : PRE + lag + n]
        if len(seg) < n:
            break
        c = float(np.dot(a, seg))
        if c > best:
            best, best_lag = c, lag
    # 接縫：loopEnd-1 → loopStart 的步階 vs 該處相鄰樣本步階的典型值（解碼檔、扣掉延遲）
    d = best_lag
    ls = PRE + d
    le = PRE + L + d
    seam = float(np.max(np.abs(dec[:, le - 1] - dec[:, ls])))
    # 對照：迴圈內部同樣寬度的相鄰步階 99 百分位
    steps = np.abs(np.diff(dec[:, ls : le], axis=1))
    p99 = float(np.percentile(steps, 99.5)) + 1e-9
    # 另一個檢查：迴圈兩側 0.5 秒的包絡差（尾巴折回有沒有銜接）
    k = int(0.25 * SR)
    tail = float(np.sqrt(np.mean(dec[:, le - k : le] ** 2)))
    head = float(np.sqrt(np.mean(dec[:, ls : ls + k] ** 2)))
    return {
        "decoder_delay_samples": d,
        "decoded_len": dec.shape[1],
        "expected_len": PRE + L + POST,
        "seam_step": seam,
        "p99.5_step": p99,
        "seam_over_p99": seam / p99,
        "tail_rms_db": 20 * math.log10(tail + 1e-9),
        "head_rms_db": 20 * math.log10(head + 1e-9),
    }


# ---------------------------------------------------------------------------
# 主程式
# ---------------------------------------------------------------------------


def build_music(scene: str, tmpdir: Path, manifest: dict) -> None:
    song = SONGS[scene]()
    dur = song.L / SR
    x = song.render()
    target = BGM_LUFS + SCENE_LUFS_OFFSET.get(scene, 0.0)
    y, info = normalize_to(x, tmpdir / f"{scene}-n.wav", target, None, -3.0)
    spb_bar = song.beats * song.spb
    an = analyze(y, spb_bar)
    # 組檔：[尾巴 PRE][整圈][開頭 POST]（週期延伸）
    ext = np.concatenate([y[:, -PRE:], y, y[:, :POST]], axis=1)
    wav = tmpdir / f"{scene}.wav"
    write_wav_f32(wav, ext)
    out = OUT / f"music-{scene}.m4a"
    encode_m4a(wav, out, "88k", 2)
    size = out.stat().st_size
    mm = measure(out)
    lp = verify_loop(out, song.L, ext)
    tot_e = sum(song.energy.values()) + 1e-18
    mix = ' '.join(f"{k}:{10 * math.log10(v / tot_e + 1e-12):.0f}" for k, v in sorted(song.energy.items(), key=lambda kv: -kv[1]))
    manifest["music"][scene] = {
        "file": out.name,
        "v": hashlib.sha1(out.read_bytes()).hexdigest()[:8],
        "loopStart": round(PRE / SR, 6),
        "loopEnd": round((PRE + song.L) / SR, 6),
        "loopSeconds": round(song.L / SR, 6),
        "bpm": song.bpm,
        "bars": song.bars,
    }
    print(f"[music] {scene:<11} {dur:5.1f}s {song.bpm:>5.0f}bpm {song.bars:>2}小節  {size / 1024:6.1f}KB  I={mm['lufs']:6.1f} LUFS  TP={mm['tp']:5.1f} dBTP  LRA={mm['lra']:.1f}  events={song.events}")
    print(
        f"        頻譜重心 {an['centroid_hz']:.0f}Hz  頻帶(dB) "
        + " ".join(f"{k}:{v:.0f}" for k, v in an["bands_db"].items())
        + f"  crest {an['crest_db']:.1f}dB  側聲道比 {an['side_ratio_db']:.1f}dB  每小節RMS {an['bar_rms_db_range']}"
    )
    print(f"        各層能量占比(dB,乾聲): {mix}")
    print(
        f"        循環檢查：解碼延遲 {lp['decoder_delay_samples']} 樣本、解碼長度 {lp['decoded_len']} (預期 {lp['expected_len']})；"
        f"接縫步階/典型步階(99.5%) = {lp['seam_over_p99']:.2f}；尾 0.25s {lp['tail_rms_db']:.1f}dB / 頭 0.25s {lp['head_rms_db']:.1f}dB"
    )


def build_sfx(name: str, tmpdir: Path, manifest: dict) -> None:
    x = SFX[name]()
    y, info = normalize_to(x[None, :], tmpdir / f"sfx-{name}-n.wav", SFX_LUFS, 2.0, SFX_PEAK_CAP.get(name, -2.0))
    wav = tmpdir / f"sfx-{name}.wav"
    write_wav_f32(wav, y)
    out = OUT / f"sfx-{name}.m4a"
    encode_m4a(wav, out, "56k", 1)
    size = out.stat().st_size
    mm = measure(out, 2.0)
    vd = volumedetect(out)
    manifest["sfx"][name] = {"file": out.name, "v": hashlib.sha1(out.read_bytes()).hexdigest()[:8], "duration": round(len(x) / SR, 4)}
    spec = analyze(np.stack([y[0], y[0]]))
    print(
        f"[sfx]   {name:<8} {len(x) / SR:5.2f}s {size / 1024:5.1f}KB  I={mm['lufs']:6.1f} LUFS  TP={mm['tp']:5.1f} dBTP  max={vd['max']} dB"
        + ("  (取樣峰值限制)" if info["peak_limited"] else "")
        + f"  重心 {spec['centroid_hz']:.0f}Hz"
    )
    if size > 40 * 1024:
        print(f"        警告：{name} 超過 40KB")


def report_only() -> None:
    print("--- 現有檔案量測 ---")
    for p in sorted(OUT.glob("music-*.m4a")):
        m = measure(p)
        print(f"{p.name:<26} {p.stat().st_size / 1024:6.1f}KB  I={m['lufs']:6.1f} LUFS  TP={m['tp']:5.1f}")
    for p in sorted(OUT.glob("sfx-*.m4a")):
        m = measure(p, 2.0)
        print(f"{p.name:<26} {p.stat().st_size / 1024:6.1f}KB  I={m['lufs']:6.1f} LUFS  TP={m['tp']:5.1f}")


def main() -> None:
    args = sys.argv[1:]
    if "--report" in args:
        report_only()
        return
    only_sfx = "--sfx" in args
    scenes = [a for a in args if a in SONGS]
    sfx_names = [a for a in args if a in SFX]
    unknown = [a for a in args if a != "--sfx" and a not in SONGS and a not in SFX]
    if unknown:
        # 打錯名字時不要退回「全部重算」：既有檔案重算後內容一變，所有使用者都要重新下載
        sys.exit(f"不認得的名稱：{' '.join(unknown)}\n場景：{' '.join(SONGS)}\n音效：{' '.join(SFX)}")
    build_all = not only_sfx and not scenes and not sfx_names
    music_list = list(SONGS) if build_all else ([] if only_sfx else scenes)
    sfx_list = list(SFX) if build_all or (only_sfx and not sfx_names) else sfx_names
    OUT.mkdir(parents=True, exist_ok=True)
    mf_path = OUT / "manifest.json"
    manifest = {"version": 1, "sampleRate": SR, "music": {}, "sfx": {}}
    if mf_path.exists():
        try:
            old = json.loads(mf_path.read_text())
            manifest["music"].update(old.get("music", {}))
            manifest["sfx"].update(old.get("sfx", {}))
        except Exception:
            pass
    with tempfile.TemporaryDirectory(prefix="gq-music-") as td:
        tmp = Path(td)
        for sc in music_list:
            build_music(sc, tmp, manifest)
        for nm in sfx_list:
            build_sfx(nm, tmp, manifest)
    mf_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    total = sum(p.stat().st_size for p in OUT.glob("*"))
    print(f"完成：{OUT}（共 {total / 1024:.0f}KB）")


if __name__ == "__main__":
    main()
