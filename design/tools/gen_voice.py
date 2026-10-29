"""批次把 App 會唸的句子用本機 Voicebox 生成成音檔。

輸入：句子清單 JSON（{ key: 文字 }），由 scripts/export-speech-lines.mjs 產生。
輸出：public/voice/<雜湊>.m4a（AAC 單聲道，iPad Safari 可直接播放）與 public/voice/manifest.json
      （{ key: { file, text, voice } }）。相同文字只生成一次，多個 key 共用同一個檔案。
      文字與聲音沒變的句子會跳過，所以可以反覆執行、中斷後續跑。

usage: uv run --with opencc-python-reimplemented --with pypinyin python -I design/tools/gen_voice.py <lines.json> [--voice mama|awu|awu-rabbit|awu-tiger|english] [--limit N] [--redo texts.txt]

v7.2 起：
- 送去 TTS 的文字先轉簡體（畫面文字不變）：模型主要用簡體訓練，繁體罕用字會唸錯（實測「乾淨」唸成「前進」、「水簾洞」的簾、「鯨魚」唸成「鯊魚」）。
- 有開 whisper-server（見 verify_voice.py）就邊生成邊驗證：辨識結果和原文的拼音錯誤率太高就換種子重生成，最多 3 次、留最好的。
- --redo：檔案裡列的句子（一行一句）重新生成，並換新檔名（記在 voice-v2.txt），避免 iPad 快取繼續播舊的錯音。

聲音（2026-10-27 使用者選定）：
- mama：遊戲內容旁白，使用者太太的克隆聲音（Voicebox 設定「乖寶-媽媽聲」）
- serena：Voicebox 內建 Serena + 台灣口音指令（備用）
阿悟本人的台詞（companion.*、lock.sleepy）不在這裡生成，之後另做寵物聲音。
需要 Voicebox.app 執行中（http://127.0.0.1:17493）。
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request
import uuid

import opencc
from pypinyin import lazy_pinyin

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vb_say import call, say  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT_DIR = os.path.join(ROOT, 'public', 'voice')
MANIFEST = os.path.join(OUT_DIR, 'manifest.json')

SERENA_INSTRUCT = '用台灣國語口音，溫柔親切、慢慢地對四歲小朋友說話，不要捲舌、不要兒化音'
VOICES = {
    'mama': {'profile': '乖寶-媽媽聲', 'engine': None, 'instruct': None, 'lang': 'zh'},
    'serena': {'profile': '乖寶-Serena', 'engine': 'qwen_custom_voice', 'instruct': SERENA_INSTRUCT, 'lang': 'zh'},
    # 英文單字（en.<word>）：Kokoro 內建英文女聲；清單由 export-speech-lines.mjs --out 一併產生的 *.en.json
    # 阿悟本人（2026-10-27 使用者選 B）：內建男聲 Dylan + 調皮語氣，再升調成卡通小猴子
    'awu': {'profile': '乖寶-阿悟底-Dylan', 'engine': 'qwen_custom_voice', 'instruct': '用活潑調皮、超有元氣的小朋友語氣說，很開心，台灣國語口音', 'lang': 'zh',
            'preset': ('qwen_custom_voice', 'Dylan'), 'pitch': 1.45, 'tempo': 1.08},
    # v7.5 兔兔、虎虎（使用者決定：同一位底音改音高，台詞沿用阿悟那批句子）：只生成 key 以 @rabbit / @tiger 結尾的寵物台詞
    'awu-rabbit': {'profile': '乖寶-阿悟底-Dylan', 'engine': 'qwen_custom_voice', 'instruct': '用活潑調皮、超有元氣的小朋友語氣說，很開心，台灣國語口音', 'lang': 'zh',
                   'preset': ('qwen_custom_voice', 'Dylan'), 'pitch': 1.6, 'tempo': 1.08, 'species': 'rabbit'},
    'awu-tiger': {'profile': '乖寶-阿悟底-Dylan', 'engine': 'qwen_custom_voice', 'instruct': '用活潑調皮、超有元氣的小朋友語氣說，很開心，台灣國語口音', 'lang': 'zh',
                  'preset': ('qwen_custom_voice', 'Dylan'), 'pitch': 1.25, 'tempo': 1.0, 'species': 'tiger'},
    'english': {'profile': '乖寶-English', 'engine': 'kokoro', 'instruct': None, 'lang': 'en', 'preset': ('kokoro', 'af_heart')},
}
# 阿悟本人說的話：用阿悟聲（--voice awu）；其他中文旁白用媽媽聲
# 要跟 src/learning/speciesLines.ts 的 PET_VOICE_PREFIXES 一致（speciesLines.test.ts 會檢查）
PET_KEYS = ('companion.', 'lock.sleepy', 'pet.', 'ui.gift.', 'ui.timewarn')


def species_of(key):
    """v7.5：key 的物種後綴（praise.gentle.3@rabbit → rabbit；沒有後綴 = 猴子 None）"""
    return key.split('@', 1)[1] if '@' in key else None


def voice_owns(voice, key):
    """這個 key 由哪個聲音生成：寵物台詞依物種分給 awu / awu-rabbit / awu-tiger；其餘（含名字句 @rabbit、@tiger）是媽媽聲"""
    pet = key.startswith(PET_KEYS)
    sp = VOICES[voice].get('species')
    if voice == 'awu' or sp:
        return pet and species_of(key) == sp
    return not pet
# 生成順序：最常聽到的先做，中斷時 App 也已經有大部分常用語音
PRIORITY = ('q.', 'num.', 'word.', 'count.', 'praise.', 'give.', 'gentle.', 'bins.', 'tutorial.', 'station.', 'ceremony.', 'chapter.', 'leave.', 'hint.', 'audio.')


def find_profile(name, preset=None, lang='zh'):
    for p in call('GET', '/profiles'):
        if p.get('name') == name:
            return p['id']
    if preset:  # 內建聲音：第一次自動建立設定
        engine, voice_id = preset
        p = call('POST', '/profiles', {'name': name, 'language': lang, 'voice_type': 'preset', 'preset_engine': engine, 'preset_voice_id': voice_id, 'default_engine': engine})
        return p['id']
    raise SystemExit(f'Voicebox 裡找不到聲音設定「{name}」')


V2_LIST = os.path.join(ROOT, 'design', 'tools', 'voice-v2.txt')
V2 = set(open(V2_LIST, encoding='utf-8').read().splitlines()) if os.path.exists(V2_LIST) else set()
T2S = opencc.OpenCC('t2s')
WHISPER = 'http://127.0.0.1:18080/inference'


def file_for(text, tag):
    # 重新生成過的句子（voice-v2.txt）換新檔名，瀏覽器快取的舊錯音不會再被播到
    if text in V2:
        tag = f'{tag}|v2'
    return hashlib.sha1(f'{tag}\n{text}'.encode()).hexdigest()[:16] + '.m4a'


def tts_text(text):
    """送去 TTS 的文字：「～」「…」會讓模型停不下來（實測生成到 5 分鐘），換成一般標點；畫面文字不變"""
    t = text.replace('～', '').replace('~', '').replace('…', '。').strip() or text
    return T2S.convert(t)


def pinyin_err(ref, hyp):
    """拼音（不含聲調）編輯距離 / 原文長度：同音字不算錯"""
    clean = lambda s: lazy_pinyin(re.sub(r'[^\w]', '', T2S.convert(s)).lower())
    r, h = clean(ref), clean(hyp)
    if not r:
        return 0.0
    prev = list(range(len(h) + 1))
    for i, rc in enumerate(r, 1):
        cur = [i] + [0] * len(h)
        for j, hc in enumerate(h, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (rc != hc))
        prev = cur
    return prev[-1] / len(r)


def whisper_text(wav, lang):
    """whisper-server 辨識；沒開就回 None（不驗證）"""
    with tempfile.TemporaryDirectory() as tmp:
        w16 = os.path.join(tmp, 'w.wav')
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-ar', '16000', '-ac', '1', w16], check=True)
        data = open(w16, 'rb').read()
    b = uuid.uuid4().hex
    body = b''.join([f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode() for k, v in (('language', lang), ('response_format', 'json'), ('temperature', '0'))])
    body += f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="a.wav"\r\nContent-Type: audio/wav\r\n\r\n'.encode() + data + f'\r\n--{b}--\r\n'.encode()
    try:
        req = urllib.request.Request(WHISPER, data=body, headers={'Content-Type': f'multipart/form-data; boundary={b}'})
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)['text'].strip()
    except OSError:
        return None


def pitch_shift(wav, out, pitch, tempo):
    af = f'asetrate=24000*{pitch},aresample=24000,atempo={1 / pitch * tempo:.4f}'
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-af', af, out], check=True)


def duration(path):
    out = subprocess.run(['afinfo', path], capture_output=True, text=True).stdout
    m = re.search(r'estimated duration: ([\d.]+)', out)
    return float(m.group(1)) if m else 0.0


def max_len(text):
    """合理長度上限（秒）：中文約每字 0.3 秒，短句至少 3 秒"""
    return max(3.0, len(text) * 0.45 + 1.5)


# 驗證門檻：拼音錯誤率超過就重生成。只有 1–2 個字的詞辨識本身就不準（缺上下文），不驗證
VERIFY_MAX = 0.34
VERIFY_MIN_LEN = 3


def generate(profile, wav, text, cfg):
    """生成並防失控：太長或唸錯（whisper 驗證）就換種子重試，最多 3 次、留最好的；仍太長就截斷加淡出"""
    limit = max_len(text)
    check = cfg['lang'] == 'zh' and not cfg.get('pitch') and len(re.sub(r'[^\w]', '', text)) >= VERIFY_MIN_LEN
    best = None  # (錯誤率, 暫存檔)
    for attempt in range(3):
        say(profile, wav, tts_text(text), cfg['instruct'], cfg['lang'], cfg['engine'], seed=None if attempt == 0 else 1000 + attempt)
        if duration(wav) > limit:
            continue
        if not check:
            return
        hyp = whisper_text(wav, 'zh')
        if hyp is None:  # 沒開 whisper-server：不驗證
            return
        err = pinyin_err(text, hyp)
        if err <= VERIFY_MAX:
            return
        print(f'RETRY-ASR {text[:20]} → {hyp[:20]} ({err:.2f})', flush=True)
        if best is None or err < best[0]:
            keep = f'{wav}.best{attempt}.wav'
            subprocess.run(['cp', wav, keep], check=True)
            best = (err, keep)
    if best is not None:
        os.replace(best[1], wav)
        print(f'ASR-BEST {text[:20]} ({best[0]:.2f})', flush=True)
        if duration(wav) <= limit:
            return
    trimmed = wav + '.trim.wav'
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-t', f'{limit:.2f}', '-af', f'afade=t=out:st={max(0, limit - 0.4):.2f}:d=0.4', trimmed], check=True)
    os.replace(trimmed, wav)
    print(f'TRIM {text[:20]} → {limit:.1f}s', flush=True)


def to_m4a(wav, m4a):
    subprocess.run(['afconvert', '-f', 'm4af', '-d', 'aac', '-b', '32000', '-c', '1', wav, m4a], check=True)


def rank(key):
    sub = 0 if key.endswith('.prompt') else 1 if key.endswith('.hint') else 2
    for i, p in enumerate(PRIORITY):
        if key.startswith(p):
            return (i, sub, key)
    return (len(PRIORITY), sub, key)


def save(manifest):
    with open(MANIFEST, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1, sort_keys=True)


def main():
    args = sys.argv[1:]
    if not args:
        raise SystemExit(__doc__)
    lines = json.load(open(args[0], encoding='utf-8'))
    voice = args[args.index('--voice') + 1] if '--voice' in args else 'mama'
    limit = int(args[args.index('--limit') + 1]) if '--limit' in args else None
    if '--redo' in args:  # 這些句子重新生成、換新檔名
        redo = {t for t in open(args[args.index('--redo') + 1], encoding='utf-8').read().splitlines() if t}
        V2.update(redo)
        with open(V2_LIST, 'w', encoding='utf-8') as fp:
            fp.write('\n'.join(sorted(V2)) + '\n')
    cfg = VOICES[voice]
    tag = f"{voice}|{cfg['instruct'] or ''}"
    os.makedirs(OUT_DIR, exist_ok=True)
    manifest = json.load(open(MANIFEST, encoding='utf-8')) if os.path.exists(MANIFEST) else {}
    profile = find_profile(cfg['profile'], cfg.get('preset'), cfg['lang'])

    mine = lambda k: voice_owns(voice, k)  # noqa: E731
    keys = sorted((k for k in lines if mine(k)), key=rank)
    # 先把已經有檔案的 key 直接寫進 manifest（共用相同文字的檔案）
    for k in keys:
        f = file_for(lines[k], tag)
        if os.path.exists(os.path.join(OUT_DIR, f)):
            manifest[k] = {'file': f, 'text': lines[k], 'voice': tag}
    todo_texts = []
    seen = set()
    for k in keys:
        t = lines[k]
        f = file_for(t, tag)
        if f in seen or os.path.exists(os.path.join(OUT_DIR, f)):
            continue
        seen.add(f)
        todo_texts.append((k, t, f))
    if limit:
        todo_texts = todo_texts[:limit]
    print(f'{len(keys)} 句，需生成 {len(todo_texts)} 段不重複的文字，聲音 {voice}', flush=True)
    for i, (key, text, f) in enumerate(todo_texts, 1):
        with tempfile.TemporaryDirectory() as tmp:
            wav = os.path.join(tmp, 'a.wav')
            try:
                generate(profile, wav, text, cfg)
                if cfg.get('pitch'):
                    shifted = os.path.join(tmp, 'b.wav')
                    pitch_shift(wav, shifted, cfg['pitch'], cfg.get('tempo', 1.0))
                    wav = shifted
                to_m4a(wav, os.path.join(OUT_DIR, f))
            except Exception as e:  # 單句失敗不中斷整批，下次重跑會補
                print(f'FAIL {key}: {e}', flush=True)
                continue
        for k in keys:
            if lines[k] == text:
                manifest[k] = {'file': f, 'text': text, 'voice': tag}
        save(manifest)
        print(f'[{i}/{len(todo_texts)}] {key} {text[:20]}', flush=True)
    same_lang = (lambda k: k.startswith('en.')) if cfg['lang'] == 'en' else (lambda k: not k.startswith('en.') and mine(k))
    stale = [k for k in manifest if same_lang(k) and k not in lines]
    for k in stale:
        del manifest[k]
    save(manifest)
    print(f'完成；manifest {len(manifest)} 句，移除過期 {len(stale)} 句', flush=True)


if __name__ == '__main__':
    main()
