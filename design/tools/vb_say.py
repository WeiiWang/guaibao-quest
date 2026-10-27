"""用本機 Voicebox 生成一句語音並存成檔案。

usage: python3 -I vb_say.py <profile_id> <out.wav> <text> [instruct] [language] [engine]
Voicebox 需在執行中（http://127.0.0.1:17493）。生成是非同步：送出 → 輪詢狀態 → 匯出音檔。
"""
import json
import sys
import time
import urllib.request

API = 'http://127.0.0.1:17493'


def call(method, path, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        ctype = r.headers.get('Content-Type', '')
    return json.loads(raw) if 'json' in ctype else raw


def say(profile_id, out, text, instruct=None, language='zh', engine=None, seed=None):
    body = {'profile_id': profile_id, 'text': text, 'language': language}
    if seed is not None:
        body['seed'] = seed
    if instruct:
        body['instruct'] = instruct
    if engine:
        body['engine'] = engine
    gen = call('POST', '/generate', body, timeout=600)
    gid = gen.get('id') or gen.get('generation_id')
    status = gen.get('status')
    deadline = time.time() + 600
    while status not in ('completed', 'complete', 'done', 'success') and time.time() < deadline:
        if status in ('failed', 'error', 'cancelled'):
            raise SystemExit(f'generation {gid} {status}: {gen}')
        time.sleep(1.5)
        gen = call('GET', f'/history/{gid}')
        status = gen.get('status')
    audio = call('GET', f'/history/{gid}/export-audio', timeout=120)
    with open(out, 'wb') as f:
        f.write(audio)
    return gid


if __name__ == '__main__':
    a = sys.argv[1:]
    gid = say(a[0], a[1], a[2], a[3] if len(a) > 3 and a[3] else None, a[4] if len(a) > 4 else 'zh', a[5] if len(a) > 5 else None)
    print('ok', gid, a[1])
