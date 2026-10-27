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
    'mama': {'profile': '乖寶-媽媽聲', 'engine': None, 'instruct': None},
    'serena': {'profile': '乖寶-Serena', 'engine': 'qwen_custom_voice', 'instruct': SERENA_INSTRUCT},
}
# 阿悟本人說的話：之後用寵物專屬聲音
PET_KEYS = ('companion.', 'lock.sleepy')
# 生成順序：最常聽到的先做，中斷時 App 也已經有大部分常用語音
PRIORITY = ('q.', 'num.', 'word.', 'count.', 'praise.', 'give.', 'gentle.', 'bins.', 'tutorial.', 'station.', 'ceremony.', 'chapter.', 'leave.', 'hint.', 'audio.')


def find_profile(name):
    for p in call('GET', '/profiles'):
        if p.get('name') == name:
            return p['id']
    raise SystemExit(f'Voicebox 裡找不到聲音設定「{name}」')


def file_for(text, tag):
    return hashlib.sha1(f'{tag}\n{text}'.encode()).hexdigest()[:16] + '.m4a'


def to_m4a(wav, m4a):
    subprocess.run(['afconvert', '-f', 'm4af', '-d', 'aac', '-b', '48000', '-c', '1', wav, m4a], check=True)


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
    profile = find_profile(cfg['profile'])

    keys = sorted((k for k in lines if not k.startswith(PET_KEYS)), key=rank)
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
    print(f'{len(keys)} 句（不含阿悟台詞），需生成 {len(todo_texts)} 段不重複的文字，聲音 {voice}', flush=True)
    for i, (key, text, f) in enumerate(todo_texts, 1):
        with tempfile.TemporaryDirectory() as tmp:
            wav = os.path.join(tmp, 'a.wav')
            try:
                say(profile, wav, text, cfg['instruct'], 'zh', cfg['engine'])
                to_m4a(wav, os.path.join(OUT_DIR, f))
            except Exception as e:  # 單句失敗不中斷整批，下次重跑會補
                print(f'FAIL {key}: {e}', flush=True)
                continue
        for k in keys:
            if lines[k] == text:
                manifest[k] = {'file': f, 'text': text, 'voice': tag}
        save(manifest)
        print(f'[{i}/{len(todo_texts)}] {key} {text[:20]}', flush=True)
    stale = [k for k in manifest if k not in lines or k.startswith(PET_KEYS)]
    for k in stale:
        del manifest[k]
    save(manifest)
    print(f'完成；manifest {len(manifest)} 句，移除過期 {len(stale)} 句', flush=True)


if __name__ == '__main__':
    main()
