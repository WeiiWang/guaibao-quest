"""用 whisper.cpp（Whisper large-v3-turbo）辨識每個預錄音檔，和原文比對，找出唸錯、漏唸、多唸的句子。

先啟動辨識伺服器（Homebrew 的 whisper-cpp；模型 ggml-large-v3-turbo-q5_0.bin 來自 huggingface ggerganov/whisper.cpp）：
  whisper-server -m ~/.cache/whisper-cpp/ggml-large-v3-turbo-q5_0.bin -l zh --host 127.0.0.1 --port 18080
usage: uv run --with opencc-python-reimplemented --with pypinyin python -I design/tools/verify_voice.py [--limit N]
輸出：design/tools/voice-verify.json（每個檔案的辨識結果與字錯誤率，可續跑）、
      design/tools/voice-verify-report.md（字錯誤率高的句子，需要人工確認或重生成）。
（Voicebox 0.5.0 內建的 /transcribe 在 Apple Silicon 會出現「no Stream(gpu) in current thread」，上游 2026-08 已修但未發版，所以不用它）
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
from pypinyin import lazy_pinyin

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
VOICE = os.path.join(ROOT, 'public', 'voice')
OUT = os.path.join(ROOT, 'design', 'tools', 'voice-verify.json')
REPORT = os.path.join(ROOT, 'design', 'tools', 'voice-verify-report.md')
API = 'http://127.0.0.1:18080/inference'
t2s = opencc.OpenCC('t2s')
DIGITS = dict(zip('0123456789', '零一二三四五六七八九'))


def norm(s):
    s = t2s.convert(s)
    s = ''.join(DIGITS.get(c, c) for c in s)
    return re.sub(r'[^\w]', '', s).lower()


def pinyin_seq(s):
    """同音字不算錯：比對拼音（不含聲調）。Whisper 常把「籃」寫成「栏」、「擊」寫成「机」，那是辨識的問題不是唸錯"""
    return lazy_pinyin(norm(s))


def cer(ref, hyp, by_pinyin=False):
    r, h = (pinyin_seq(ref), pinyin_seq(hyp)) if by_pinyin else (norm(ref), norm(hyp))
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
    for k, v in (('language', lang), ('response_format', 'json'), ('temperature', '0')):
        parts.append(f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    parts.append(f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="a.wav"\r\nContent-Type: audio/wav\r\n\r\n'.encode() + data + b'\r\n')
    parts.append(f'--{b}--\r\n'.encode())
    req = urllib.request.Request(API, data=b''.join(parts), headers={'Content-Type': f'multipart/form-data; boundary={b}'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)['text'].strip()


def main():
    args = sys.argv[1:]
    model = None
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
            if 'Connection refused' in str(e):
                raise SystemExit('連不到 whisper-server（見檔頭的啟動指令）')
            continue
        done[f] = {'text': info['text'], 'hyp': hyp, 'cer': round(cer(info['text'], hyp), 3), 'voice': info['voice'], 'key': info['keys'][0]}
        done[f]['per'] = round(cer(info['text'], hyp, by_pinyin=True), 3)
        if i % 20 == 0 or i == len(todo):
            json.dump(done, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
            print(f'[{i}/{len(todo)}] {info["text"][:16]} → {hyp[:16]} ({done[f]["cer"]})', flush=True)
    json.dump(done, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    for v in done.values():  # 舊結果補算拼音錯誤率
        v.setdefault('per', round(cer(v['text'], v['hyp'], by_pinyin=True), 3))
    json.dump(done, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    rows = sorted((v for v in done.values() if v['per'] >= 0.3), key=lambda v: -v['per'])
    with open(REPORT, 'w', encoding='utf-8') as fp:
        fp.write(f'# 語音辨識比對報告\n\n共 {len(done)} 個音檔；拼音錯誤率（同音字不算錯）≥ 0.3 的有 {len(rows)} 個。\n\n| 拼音錯誤率 | 聲音 | key | 原文 | 辨識 |\n|---|---|---|---|---|\n')
        for v in rows:
            fp.write(f"| {v['per']} | {v['voice']} | {v['key']} | {v['text']} | {v['hyp']} |\n")
    print(f'完成；拼音錯誤率≥0.3：{len(rows)} 個 → {REPORT}', flush=True)


if __name__ == '__main__':
    main()
