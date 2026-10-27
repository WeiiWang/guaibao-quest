"""批次把 App 會唸的句子用本機 Voicebox 生成成音檔。

輸入：句子清單 JSON（{ key: 文字 }），由 scripts/export-speech-lines.mjs 產生。
輸出：public/voice/<雜湊>.m4a（AAC 單聲道，iPad Safari 可直接播放）與 public/voice/manifest.json
      （{ key: { file, text, voice } }）。相同文字只生成一次，多個 key 共用同一個檔案。
      文字與聲音沒變的句子會跳過，所以可以反覆執行、中斷後續跑。

usage: python3 -I design/tools/gen_voice.py <lines.json> [--voice mama|serena] [--limit N]

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
    'english': {'profile': '乖寶-English', 'engine': 'kokoro', 'instruct': None, 'lang': 'en', 'preset': ('kokoro', 'af_heart')},
}
# 阿悟本人說的話：用阿悟聲（--voice awu）；其他中文旁白用媽媽聲
PET_KEYS = ('companion.', 'lock.sleepy', 'pet.', 'ui.gift.', 'ui.timewarn')
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


def file_for(text, tag):
    return hashlib.sha1(f'{tag}\n{text}'.encode()).hexdigest()[:16] + '.m4a'


def tts_text(text):
    """送去 TTS 的文字：「～」「…」會讓模型停不下來（實測生成到 5 分鐘），換成一般標點；畫面文字不變"""
    return text.replace('～', '').replace('~', '').replace('…', '。').strip() or text


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


def generate(profile, wav, text, cfg):
    """生成並防失控：太長就換種子重試，最多 3 次；仍太長就截斷加淡出"""
    limit = max_len(text)
    for attempt in range(3):
        say(profile, wav, tts_text(text), cfg['instruct'], cfg['lang'], cfg['engine'], seed=None if attempt == 0 else 1000 + attempt)
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
    cfg = VOICES[voice]
    tag = f"{voice}|{cfg['instruct'] or ''}"
    os.makedirs(OUT_DIR, exist_ok=True)
    manifest = json.load(open(MANIFEST, encoding='utf-8')) if os.path.exists(MANIFEST) else {}
    profile = find_profile(cfg['profile'], cfg.get('preset'), cfg['lang'])

    mine = (lambda k: k.startswith(PET_KEYS)) if voice == 'awu' else (lambda k: not k.startswith(PET_KEYS))
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
