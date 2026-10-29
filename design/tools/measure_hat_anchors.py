"""量寵物圖的「帽子頭頂錨點」，輸出可以直接貼進 src/art/hats.ts 的程式碼（v7.5 線 L）。

用法：
  uv run --with pillow python -I design/tools/measure_hat_anchors.py public/art/pet-rabbit-baby-*.png
  uv run --with pillow python -I design/tools/measure_hat_anchors.py --compare public/art/pet-baby-*.png public/art/pet-adult-*.png
      --compare：跟 hats.ts 裡現有的表比對（列出 x、y 的差距），用來驗證這支工具量得準不準。
  uv run --with pillow python -I design/tools/measure_hat_anchors.py --selftest
      畫一隻假兔子（長耳朵）確認帽子量在頭頂、不是耳尖。
  其他選項：--w-baby 48 --w-adult 46（帽子寬度，佔圖片寬的百分比；不給就沿用猴子的寬度）

做法（只看不透明像素，alpha > 128）：
  1. 每一列找「最長的一段連續不透明像素」的寬度 L(y)。
  2. 頭頂 = 由上往下第一個 L(y) ≥ 頭寬門檻的列（門檻 = 身體外框寬 × HEAD_FRAC）。
     兔子的長耳朵、猴子的頭髮尖都是窄窄的幾段，寬度不到門檻，所以會被跳過，帽子戴在耳朵之間的頭頂，不是耳尖。
  3. x = 頭頂往下 X_ROWS 列內，最長那段的中心（取平均）。
  4. y = 頭頂列再往下 Y_OFFSET（佔圖高的百分比；帽子底邊要壓在頭上一點，不是貼著最上緣）。
  5. rotate = 頭頂往下 TILT_DEPTH 內，每列「包含頭頂中心那一段」的中心擬合成直線的傾斜角（頭歪向哪邊，帽子跟著歪）。
     只是估計（猴子的表是逐張目視微調的），請用 #hatpreview/<帽子>/<物種> 目視確認。
  6. ar = 圖片寬 / 高（疊圖容器要跟圖片一樣大）。
  睡覺（sleep）姿勢一律輸出 hidden(...)（躺著，帽子放旁邊）。
  HEAD_FRAC、Y_OFFSET 是用現有 24 張猴子圖校正過的（--compare 列出差距）。
"""
import math
import os
import re
import sys

from PIL import Image

HEAD_FRAC = 0.36
Y_OFFSET = 4.2  # 佔圖高的百分比
X_ROWS = 0.06  # 佔圖高的比例
TILT_DEPTH = 0.1  # 佔圖高的比例
MAX_ROT = 12  # 估計的傾斜角上限（度）；超過的多半是手臂、頭髮造成的誤判
ALPHA = 128
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
HATS_TS = os.path.join(ROOT, 'src', 'art', 'hats.ts')
NAME_RE = re.compile(r'^pet-(?:(rabbit|tiger)-)?(baby|adult)-([a-z]+)$')
DEFAULT_W = {'baby': 48, 'adult': 46}


def longest_run(row):
    """一列裡最長的一段連續不透明像素：(長度, 起點, 終點)"""
    best = (0, 0, 0)
    start = None
    for x, on in enumerate(row + [False]):
        if on and start is None:
            start = x
        elif not on and start is not None:
            if x - start > best[0]:
                best = (x - start, start, x - 1)
            start = None
    return best


def run_at(row, x):
    """一列裡包含第 x 個像素的那一段連續不透明像素：(起點, 終點)；x 是透明的回 None"""
    if x < 0 or x >= len(row) or not row[x]:
        return None
    l = x
    while l > 0 and row[l - 1]:
        l -= 1
    r = x
    while r < len(row) - 1 and row[r + 1]:
        r += 1
    return (l, r)


def measure(path):
    im = Image.open(path).convert('RGBA')
    w, h = im.size
    a = im.getchannel('A').load()
    rows = [[a[x, y] > ALPHA for x in range(w)] for y in range(h)]
    cols = [x for x in range(w) if any(rows[y][x] for y in range(h))]
    if not cols:
        raise ValueError('整張圖都是透明的')
    body_w = cols[-1] - cols[0] + 1
    runs = [longest_run(r) for r in rows]
    top = next((y for y in range(h) if runs[y][0] >= body_w * HEAD_FRAC), None)
    if top is None:
        raise ValueError('找不到頭頂')
    n = max(1, int(h * X_ROWS))
    centers = [(runs[y][1] + runs[y][2]) / 2 for y in range(top, min(h, top + n))]
    cx = sum(centers) / len(centers)
    # 傾斜：頭頂往下 TILT_DEPTH 內每一列「包含頭頂中心的那一段」的中心，擬合一條直線（舉起的手臂是另一段，不算進來）
    pts = []
    for y in range(top, min(h, top + int(h * TILT_DEPTH))):
        seg = run_at(rows[y], int(round(cx)))
        if seg and seg[1] - seg[0] + 1 <= body_w * 0.9:
            pts.append((y, (seg[0] + seg[1]) / 2))
    rot = 0.0
    if len(pts) >= 3:
        my = sum(p[0] for p in pts) / len(pts)
        mx = sum(p[1] for p in pts) / len(pts)
        sxx = sum((p[0] - my) ** 2 for p in pts)
        slope = sum((p[0] - my) * (p[1] - mx) for p in pts) / sxx if sxx else 0.0
        rot = max(-MAX_ROT, min(MAX_ROT, -math.degrees(math.atan(slope))))
    return {
        'x': round(cx / w * 100, 1),
        'y': round(top / h * 100 + Y_OFFSET, 1),
        'rotate': int(round(rot)),
        'top_px': top,
        'px': (w, h),
    }


def existing_table():
    """hats.ts 裡現有的錨點：{檔名: (x, y, w, rotate)}"""
    out = {}
    if not os.path.exists(HATS_TS):
        return out
    for m in re.finditer(r"'(pet-[a-z-]+)': a\(([-\d.]+), ([-\d.]+), ([-\d.]+), ([-\d.]+),", open(HATS_TS, encoding='utf-8').read()):
        out[m.group(1)] = tuple(float(v) for v in m.groups()[1:])
    return out


def selftest():
    """畫一隻假兔子（圓頭 + 兩根長耳朵 + 身體）確認頭頂量在耳朵下面、不是耳尖"""
    import tempfile

    from PIL import ImageDraw

    w, h = 420, 512
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse((150, 10, 190, 190), fill=(255, 255, 255, 255))  # 左耳（細長，頂端 y=10）
    d.ellipse((230, 10, 270, 190), fill=(255, 255, 255, 255))  # 右耳
    d.ellipse((90, 150, 330, 360), fill=(255, 255, 255, 255))  # 頭（頂端 y=150）
    d.ellipse((110, 320, 310, 505), fill=(255, 255, 255, 255))  # 身體
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, 'pet-rabbit-baby-idle.png')
        im.save(path)
        r = measure(path)
    ear_top = 10 / h * 100
    head_top = 150 / h * 100
    ok = r['top_px'] >= 150 and abs(r['x'] - 50) < 1.5 and r['rotate'] == 0
    print(f'假兔子：耳尖 y={ear_top:.1f}%、頭頂 y={head_top:.1f}% → 量到頭頂 {r["top_px"] / h * 100:.1f}%、錨點 x={r["x"]} y={r["y"]} rotate={r["rotate"]}：{"OK" if ok else "失敗"}')
    if not ok:
        raise SystemExit(1)


def main():
    args = sys.argv[1:]
    if not args:
        raise SystemExit(__doc__)
    if args == ['--selftest']:
        return selftest()
    compare = '--compare' in args
    widths = dict(DEFAULT_W)
    for k in ('baby', 'adult'):
        flag = f'--w-{k}'
        if flag in args:
            widths[k] = float(args[args.index(flag) + 1])
    files = [p for i, p in enumerate(args) if p.endswith('.png') and not (i > 0 and args[i - 1].startswith('--w-'))]
    table = existing_table()
    diffs = []
    lines = []
    for path in sorted(files):
        name = os.path.splitext(os.path.basename(path))[0]
        m = NAME_RE.match(name)
        if not m:
            print(f'// 略過 {name}（不是幼體 / 成體的寵物圖）', file=sys.stderr)
            continue
        stage, pose = m.group(2), m.group(3)
        try:
            r = measure(path)
        except ValueError as e:
            print(f'// {name}: {e}', file=sys.stderr)
            continue
        w, h = r['px']
        if pose == 'sleep':
            lines.append(f"  '{name}': hidden([{w}, {h}]),")
            continue
        ww = widths[stage]
        lines.append(f"  '{name}': a({r['x']}, {r['y']}, {ww:g}, {r['rotate']}, [{w}, {h}]),")
        if compare and name in table:
            x0, y0, _w0, rot0 = table[name]
            diffs.append((name, r['x'] - x0, r['y'] - y0, r['rotate'] - rot0, (x0, y0, rot0), r))
    print('\n'.join(lines))
    if compare and diffs:
        print('\n// 跟 hats.ts 現有的表比對（量到 − 現有）：', file=sys.stderr)
        for name, dx, dy, drot, old, r in diffs:
            print(f'//   {name:22s} x {r["x"]:5.1f} vs {old[0]:5.1f} ({dx:+.1f})   y {r["y"]:5.1f} vs {old[1]:5.1f} ({dy:+.1f})   rotate {r["rotate"]:+d} vs {old[2]:+.0f} ({drot:+.0f})', file=sys.stderr)
        n = len(diffs)
        mx = sum(abs(d[1]) for d in diffs) / n
        my = sum(abs(d[2]) for d in diffs) / n
        mr = sum(abs(d[3]) for d in diffs) / n
        print(f'// 平均差距：|x| {mx:.2f}、|y| {my:.2f}（百分點，n={n}）；最大 |x| {max(abs(d[1]) for d in diffs):.1f}、|y| {max(abs(d[2]) for d in diffs):.1f}', file=sys.stderr)
        print(f'// 傾斜角平均差 {mr:.1f} 度、最大 {max(abs(d[3]) for d in diffs):.0f} 度（只是估計，要目視確認）', file=sys.stderr)


if __name__ == '__main__':
    main()
