"""批次把 App 會唸的句子用本機 Voicebox 生成成音檔。

輸入：句子清單 JSON（{ key: 文字 }），由 scripts/export-speech-lines.mjs 產生。
輸出：public/voice/<key>.m4a（AAC 單聲道，iPad Safari 可直接播放）與 public/voice/manifest.json
      （{ key: { file, text, voice } }）。文字或聲音設定沒變的句子會跳過，所以可以反覆執行、中斷後續跑。

usage: python3 -I design/tools/gen_voice.py <lines.json> [--limit N]

聲音：Voicebox 內建 Serena（qwen_custom_voice）+ 台灣口音風格指令（2026-10-27 使用者試聽選定）。
需要 Voicebox.app 執行中（http://127.0.0.1:17493）。
"""
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

VOICE_NAME = '乖寶-Serena'
PRESET = {'preset_engine': 'qwen_custom_voice', 'preset_voice_id': 'Serena'}
ENGINE = 'qwen_custom_voice'
INSTRUCT = '用台灣國語口音，溫柔親切、慢慢地對四歲小朋友說話，不要捲舌、不要兒化音'
VOICE_TAG = f'serena|{INSTRUCT}'


def ensure_profile():
    """找到（或建立）乖寶-Serena 這個 preset 聲音設定，回傳 profile id。"""
    profiles = call('GET', '/profiles')
    for p in profiles:
        if p.get('name') == VOICE_NAME:
            return p['id']
    p = call('POST', '/profiles', {'name': VOICE_NAME, 'language': 'zh', 'voice_type': 'preset', 'default_engine': ENGINE, **PRESET})
    return p['id']


def safe_name(key):
    return re.sub(r'[^A-Za-z0-9._-]', '_', key)


def to_m4a(wav, m4a):
    subprocess.run(['afconvert', '-f', 'm4af', '-d', 'aac', '-b', '48000', '-c', '1', wav, m4a], check=True)


def main():
    args = sys.argv[1:]
    if not args:
        raise SystemExit(__doc__)
    lines = json.load(open(args[0], encoding='utf-8'))
    limit = int(args[args.index('--limit') + 1]) if '--limit' in args else None
    os.makedirs(OUT_DIR, exist_ok=True)
    manifest = json.load(open(MANIFEST, encoding='utf-8')) if os.path.exists(MANIFEST) else {}
    profile = ensure_profile()

    todo = [(k, t) for k, t in lines.items() if not (k in manifest and manifest[k].get('text') == t and manifest[k].get('voice') == VOICE_TAG and os.path.exists(os.path.join(OUT_DIR, manifest[k]['file'])))]
    if limit:
        todo = todo[:limit]
    print(f'{len(lines)} 句，需生成 {len(todo)} 句', flush=True)
    for i, (key, text) in enumerate(todo, 1):
        file = safe_name(key) + '.m4a'
        with tempfile.TemporaryDirectory() as tmp:
            wav = os.path.join(tmp, 'a.wav')
            try:
                say(profile, wav, text, INSTRUCT, 'zh', ENGINE)
                to_m4a(wav, os.path.join(OUT_DIR, file))
            except Exception as e:  # 單句失敗不中斷整批，下次重跑會補
                print(f'FAIL {key}: {e}', flush=True)
                continue
        manifest[key] = {'file': file, 'text': text, 'voice': VOICE_TAG}
        with open(MANIFEST, 'w', encoding='utf-8') as f:
            json.dump(manifest, f, ensure_ascii=False, indent=1, sort_keys=True)
        print(f'[{i}/{len(todo)}] {key}', flush=True)
    # 清單裡已不存在的句子：從 manifest 移除（音檔保留，避免誤刪）
    stale = [k for k in manifest if k not in lines]
    for k in stale:
        del manifest[k]
    with open(MANIFEST, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1, sort_keys=True)
    print(f'完成；manifest {len(manifest)} 句，移除過期 {len(stale)} 句', flush=True)


if __name__ == '__main__':
    main()
