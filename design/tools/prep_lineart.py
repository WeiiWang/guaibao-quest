#!/usr/bin/env python3
"""著色本線稿前處理（v7 線 A）。

用法：uv run --with pillow python -I design/tools/prep_lineart.py [--raw DIR] [--out DIR]

- 讀 design/tools/lineart.txt 的頁面名單（第一欄 = 頁面 id，例 line-awu-banana），
  到 raw 目錄找同名 PNG（design/raw/ 被 gitignore，worktree 裡沒有時會往上找主目錄的 design/raw）。
- 處理：疊在白底上（來源可能是透明背景）→ 灰階 → 等比縮進 1024×1024 並置中補白邊
  → 以 160 為界（小於 160 視為線）：alpha 在 160 附近做約 ±45 的線性過渡（保留反鋸齒，放大 2–3 倍也平滑），
    執行時區塊表用 alpha ≥ 128 判定線條，和「灰階 < 160」的二值化等價
  → 對 alpha 做 3×3 最大值濾鏡（線條外擴 1px，把 1px 的小縫補上，區塊才不會漏色）。
- 輸出格式（選了其中一種）：黑線 + 透明背景的 PNG（RGB 全黑、只有 alpha 通道帶線稿）。
  填色層在它下面，畫面上用一般的 normal 疊合即可，不需要 multiply。
- 整體是黑底（大面積黑色連到邊框）的圖會報錯、跳過、不產出（並清掉舊輸出），結束時以非 0 離開。
- 可重跑：已存在的 raw 才處理，沒有的略過；最後依「輸出資料夾裡實際存在的 PNG」重寫
  src/art/coloring/lineart-manifest.json，網站只會顯示 manifest 裡有的頁面。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter

SIZE = 1024
THRESHOLD = 160
RAMP = 45
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent


def arg(name: str, default: str | None = None) -> str | None:
    if name in sys.argv:
        i = sys.argv.index(name)
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return default


def find_raw() -> Path:
    cands = [arg("--raw"), str(ROOT / "design" / "raw"), str(ROOT.parent / "guaibao-quest" / "design" / "raw")]
    for c in cands:
        if c and Path(c).is_dir():
            return Path(c)
    return ROOT / "design" / "raw"


def page_ids() -> list[str]:
    ids = []
    for raw in (HERE / "lineart.txt").read_text(encoding="utf-8").splitlines():
        raw = raw.strip()
        if raw and not raw.startswith("#"):
            ids.append(raw.split("|", 1)[0].strip())
    return ids


class BadArt(ValueError):
    """線稿不合格（例如整體黑底），不產出"""


def _dark_share(alpha: Image.Image, box: tuple[int, int, int, int]) -> float:
    h = alpha.crop(box).histogram()
    return sum(h[128:]) / max(1, sum(h))


def check_not_black_bg(alpha: Image.Image) -> None:
    """整體是黑底（大面積黑色連到邊框）的圖不能用：外圍一圈有一半以上是「線」，或整張超過 45% 是「線」。"""
    b = 16
    strips = [(0, 0, SIZE, b), (0, SIZE - b, SIZE, SIZE), (0, 0, b, SIZE), (SIZE - b, 0, SIZE, SIZE)]
    ring = sum(_dark_share(alpha, s) for s in strips) / len(strips)
    total = _dark_share(alpha, (0, 0, SIZE, SIZE))
    if ring > 0.5 or total > 0.45:
        raise BadArt(f"整體是黑底（外圍 {ring:.0%} 是黑、全圖 {total:.0%} 是黑）")


def to_line_png(src: Path) -> Image.Image:
    im = Image.open(src).convert("RGBA")
    bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
    gray = Image.alpha_composite(bg, im).convert("L")
    # 等比縮進 1024，置中補白邊
    w, h = gray.size
    s = min(SIZE / w, SIZE / h)
    nw, nh = max(1, round(w * s)), max(1, round(h * s))
    gray = gray.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("L", (SIZE, SIZE), 255)
    canvas.paste(gray, ((SIZE - nw) // 2, (SIZE - nh) // 2))
    # 灰階 → alpha：THRESHOLD 時 128（線 / 非線的分界），±RAMP 內線性過渡
    lo, hi = THRESHOLD - RAMP, THRESHOLD + RAMP
    alpha = canvas.point(lambda v: 255 if v <= lo else (0 if v >= hi else int(255 * (hi - v) / (hi - lo))))
    check_not_black_bg(alpha)
    alpha = alpha.filter(ImageFilter.MaxFilter(3))  # 外擴 1px，補小縫
    out = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    out.putalpha(alpha)
    return out


def main() -> None:
    raw = find_raw()
    out_dir = Path(arg("--out", str(ROOT / "public" / "art" / "coloring")))
    out_dir.mkdir(parents=True, exist_ok=True)
    ids = page_ids()
    done, skipped, bad = [], [], []
    for pid in ids:
        src = raw / f"{pid}.png"
        if not src.exists():
            skipped.append(pid)
            continue
        try:
            img = to_line_png(src)
        except BadArt as e:
            # 不合格：不產出，也清掉先前留下的舊輸出（不然 manifest 會把它當成可用）
            (out_dir / f"{pid}.png").unlink(missing_ok=True)
            print(f"錯誤：{pid} 不合格，已跳過：{e}", file=sys.stderr)
            bad.append(pid)
            continue
        img.save(out_dir / f"{pid}.png", optimize=True)
        done.append(pid)
    have = [pid for pid in ids if (out_dir / f"{pid}.png").exists()]
    manifest = ROOT / "src" / "art" / "coloring" / "lineart-manifest.json"
    manifest.write_text(json.dumps({"ids": have}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"raw: {raw}")
    print(f"處理 {len(done)} 張：{', '.join(done) or '-'}")
    print(f"還沒有素材 {len(skipped)} 張：{', '.join(skipped) or '-'}")
    print(f"manifest：{len(have)} 張 → {manifest}")
    if bad:
        print(f"不合格 {len(bad)} 張（需要重生成）：{', '.join(bad)}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
