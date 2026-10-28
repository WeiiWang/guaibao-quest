"""用 Voicebox 內建的 Whisper 辨識每個預錄音檔，和原文比對，找出唸錯、漏唸、多唸的句子。

usage: uv run --with opencc-python-reimplemented python -I design/tools/verify_voice.py [--model turbo] [--limit N]
輸出：design/tools/voice-verify.json（每個檔案的辨識結果與字錯誤率，可續跑）、
      design/tools/voice-verify-report.md（字錯誤率高的句子，需要人工確認或重生成）。
注意：同一個 Voicebox server 先做過 TTS 再做辨識會出現 GPU stream 錯誤，跑之前先 design/tools/vb_restart.sh。
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request
import uuid

import opencc

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
VOICE = os.path.join(ROOT, 'public', 'voice')
OUT = os.path.join(ROOT, 'design', 'tools', 'voice-verify.json')
REPORT = os.path.join(ROOT, 'design', 'tools', 'voice-verify-report.md')
API = 'http://127.0.0.1:17493/transcribe'
t2s = opencc.OpenCC('t2s')
DIGITS = dict(zip('0123456789', '零一二三四五六七八九'))


def norm(s):
    s = t2s.convert(s)
    s = ''.join(DIGITS.get(c, c) for c in s)
    return re.sub(r'[^\w]', '', s).lower()


def cer(ref, hyp):
    r, h = norm(ref), norm(hyp)
    if not r:
        return 0.0
    prev = list(range(len(h) + 1))
    for i, rc in enumerate(r, 1):
        cur = [i] + [0] * len(h)
        for j, hc in enumerate(h, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (rc != hc))
        prev = cur
    return prev[-1] / len(r)


def transcribe(path, lang, model):
    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, 'a.wav')
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', path, '-ar', '16000', '-ac', '1', wav], check=True)
        data = open(wav, 'rb').read()
    b = uuid.uuid4().hex
    parts = []
    for k, v in (('language', lang), ('model', model)):
        parts.append(f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    parts.append(f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="a.wav"\r\nContent-Type: audio/wav\r\n\r\n'.encode() + data + b'\r\n')
    parts.append(f'--{b}--\r\n'.encode())
    req = urllib.request.Request(API, data=b''.join(parts), headers={'Content-Type': f'multipart/form-data; boundary={b}'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)['text']


def main():
    args = sys.argv[1:]
    model = args[args.index('--model') + 1] if '--model' in args else 'turbo'
    limit = int(args[args.index('--limit') + 1]) if '--limit' in args else None
    manifest = json.load(open(os.path.join(VOICE, 'manifest.json'), encoding='utf-8'))
    files = {}
    for k, v in manifest.items():
        files.setdefault(v['file'], {'text': v['text'], 'voice': v['voice'].split('|')[0], 'keys': []})['keys'].append(k)
    done = json.load(open(OUT, encoding='utf-8')) if os.path.exists(OUT) else {}
    todo = [f for f in files if f not in done or done[f].get('text') != files[f]['text']]
    if limit:
        todo = todo[:limit]
    print(f'{len(files)} 個音檔，需辨識 {len(todo)}', flush=True)
    for i, f in enumerate(todo, 1):
        info = files[f]
        lang = 'en' if info['voice'] == 'english' else 'zh'
        try:
            hyp = transcribe(os.path.join(VOICE, f), lang, model)
        except Exception as e:  # 單一失敗不中斷
            print(f'FAIL {f}: {e}', flush=True)
            if 'Stream(gpu' in str(e) or 'HTTP Error 500' in str(e):
                raise SystemExit('Voicebox GPU stream 錯誤：先跑 design/tools/vb_restart.sh 再續跑')
            continue
        done[f] = {'text': info['text'], 'hyp': hyp, 'cer': round(cer(info['text'], hyp), 3), 'voice': info['voice'], 'key': info['keys'][0]}
        if i % 20 == 0 or i == len(todo):
            json.dump(done, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
            print(f'[{i}/{len(todo)}] {info["text"][:16]} → {hyp[:16]} ({done[f]["cer"]})', flush=True)
    json.dump(done, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    rows = sorted((v for v in done.values() if v['cer'] >= 0.3), key=lambda v: -v['cer'])
    with open(REPORT, 'w', encoding='utf-8') as fp:
        fp.write(f'# 語音辨識比對報告\n\n共 {len(done)} 個音檔；字錯誤率 ≥ 0.3 的有 {len(rows)} 個。\n\n| CER | 聲音 | key | 原文 | 辨識 |\n|---|---|---|---|---|\n')
        for v in rows:
            fp.write(f"| {v['cer']} | {v['voice']} | {v['key']} | {v['text']} | {v['hyp']} |\n")
    print(f'完成；CER≥0.3：{len(rows)} 個 → {REPORT}', flush=True)


if __name__ == '__main__':
    main()
