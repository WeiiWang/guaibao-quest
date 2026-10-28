"""連連看（點點連線）的點位產生器（v7.2 E1）。

讀 public/art/<name>.png 的 alpha，取最大外輪廓，依弧長重新取樣，轉角處優先放點，
從最上方開始順時針編號，輸出 src/art/dots/dots.json（座標統一 0–400）。

用法（Python 一律走 uv，不要 pip）：
  uv run --with pillow python -I design/tools/gen_dots.py
  uv run --with pillow python -I design/tools/gen_dots.py obj-star obj-fish     # 只重做指定的圖（其餘沿用 dots.json）

輸出格式：
  items[name] = {
    img:     [x, y, w, h]   # 3D 圖放在 0–400 座標空間的位置與大小（和輪廓對齊）
    outline: [[x, y], ...]  # 稠密外輪廓（約 160 點，順時針、從最上方開始），剪影用
    levels:  { e: 10 點, m: 20 點, h: 30 點, a: 26 點 }   # 每一關的點位（都落在輪廓上）
  }
"""
import json
import math
import sys
from collections import deque
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
ART = ROOT / "public" / "art"
OUT = ROOT / "src" / "art" / "dots" / "dots.json"

# 做哪些圖（順序 = 列表順序；前 3 張每關免費）
NAMES = [
    "obj-star",
    "obj-fish",
    "food-banana",
    "obj-apple",
    "obj-rabbit",
    "obj-chick",
    "obj-bear",
    "obj-octopus",
    "food-watermelon",
    "obj-flower",
    "food-cake",
    "pet-adult-happy",
]
LEVELS = {"e": 10, "m": 20, "h": 30, "a": 26}
BOX = 400.0
MARGIN = 38.0  # 圖離邊界的留白（0–400 空間）
DENSE = 160  # 稠密輪廓點數


# ---------- 影像：遮罩、最大連通塊、補洞 ----------
def largest_component(mask, w, h):
    seen = bytearray(w * h)
    best = []
    for s in range(w * h):
        if not mask[s] or seen[s]:
            continue
        comp = []
        dq = deque([s])
        seen[s] = 1
        while dq:
            p = dq.popleft()
            comp.append(p)
            x, y = p % w, p // w
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < w and 0 <= ny < h:
                    q = ny * w + nx
                    if mask[q] and not seen[q]:
                        seen[q] = 1
                        dq.append(q)
        if len(comp) > len(best):
            best = comp
    out = bytearray(w * h)
    for p in best:
        out[p] = 1
    return out


def fill_holes(mask, w, h):
    """從邊界往內淹水，淹不到的背景就是洞，補成前景"""
    reach = bytearray(w * h)
    dq = deque()
    for x in range(w):
        for y in (0, h - 1):
            if not mask[y * w + x] and not reach[y * w + x]:
                reach[y * w + x] = 1
                dq.append(y * w + x)
    for y in range(h):
        for x in (0, w - 1):
            if not mask[y * w + x] and not reach[y * w + x]:
                reach[y * w + x] = 1
                dq.append(y * w + x)
    while dq:
        p = dq.popleft()
        x, y = p % w, p // w
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h:
                q = ny * w + nx
                if not mask[q] and not reach[q]:
                    reach[q] = 1
                    dq.append(q)
    return bytearray(0 if reach[i] else 1 for i in range(w * h))


# ---------- 輪廓追蹤（Moore neighbour，Jacob 停止條件） ----------
MOORE = [(-1, 0), (-1, -1), (0, -1), (1, -1), (1, 0), (1, 1), (0, 1), (-1, 1)]


def trace(mask, w, h):
    def at(x, y):
        return 0 <= x < w and 0 <= y < h and mask[y * w + x]

    start = None
    for y in range(h):
        for x in range(w):
            if mask[y * w + x]:
                start = (x, y)
                break
        if start:
            break
    if not start:
        return []
    pts = [start]
    cur = start
    back = 0  # 從左邊進來
    first_back = None
    limit = w * h * 2
    while limit > 0:
        limit -= 1
        found = False
        for i in range(8):
            d = (back + 1 + i) % 8
            nx, ny = cur[0] + MOORE[d][0], cur[1] + MOORE[d][1]
            if at(nx, ny):
                # 新的 back = 上一個被檢查過（背景）的方向
                prev = (back + i) % 8
                pb = (cur[0] + MOORE[prev][0], cur[1] + MOORE[prev][1])
                cur = (nx, ny)
                back = (MOORE.index((pb[0] - cur[0], pb[1] - cur[1])) if (pb[0] - cur[0], pb[1] - cur[1]) in MOORE else (d + 4) % 8)
                found = True
                break
        if not found:
            break
        if cur == start and first_back is None:
            first_back = back
            break
        pts.append(cur)
    return pts


# ---------- 幾何 ----------
def smooth(pts, win):
    n = len(pts)
    out = []
    for i in range(n):
        sx = sy = 0.0
        for k in range(-win, win + 1):
            x, y = pts[(i + k) % n]
            sx += x
            sy += y
        out.append((sx / (2 * win + 1), sy / (2 * win + 1)))
    return out


def area2(pts):
    s = 0.0
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        s += x1 * y2 - x2 * y1
    return s


def cumlen(pts):
    acc = [0.0]
    n = len(pts)
    for i in range(1, n + 1):
        a, b = pts[i - 1], pts[i % n]
        acc.append(acc[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    return acc  # 長度 n+1，acc[n] = 周長


def point_at(pts, acc, s):
    n = len(pts)
    total = acc[-1]
    s = s % total
    lo, hi = 0, n
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if acc[mid] <= s:
            lo = mid
        else:
            hi = mid
    a, b = pts[lo], pts[(lo + 1) % n]
    seg = acc[lo + 1] - acc[lo]
    t = 0 if seg == 0 else (s - acc[lo]) / seg
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def resample_uniform(pts, n):
    acc = cumlen(pts)
    total = acc[-1]
    return [point_at(pts, acc, total * i / n) for i in range(n)]


def turning(dense, i, span):
    n = len(dense)
    a = dense[(i - span) % n]
    b = dense[i]
    c = dense[(i + span) % n]
    v1 = (b[0] - a[0], b[1] - a[1])
    v2 = (c[0] - b[0], c[1] - b[1])
    d = math.degrees(abs(math.atan2(v1[0] * v2[1] - v1[1] * v2[0], v1[0] * v2[0] + v1[1] * v2[1])))
    return d


def pick_dots(dense, n):
    """在稠密輪廓（0 號點 = 起點）上選 n 個點：轉角處優先，其餘平均分布。回傳 index 清單（遞增、含 0）"""
    m = len(dense)
    acc = cumlen(dense)
    total = acc[-1]
    avg = m / n
    span = max(2, int(m * 0.02))
    score = [turning(dense, i, span) for i in range(m)]
    # 局部極大的轉角
    cand = [i for i in range(m) if score[i] >= 38 and all(score[i] >= score[(i + k) % m] for k in range(-span, span + 1))]
    cand.sort(key=lambda i: -score[i])
    chosen = [0]
    min_sep = avg * 0.55
    max_corners = max(1, n // 2)
    for i in cand:
        if len(chosen) - 1 >= max_corners:
            break
        if all(min(abs(i - j), m - abs(i - j)) >= min_sep for j in chosen):
            chosen.append(i)
    chosen.sort()
    extra = n - len(chosen)
    # 其餘的點按弧長分配到各段
    gaps = []
    for k, i in enumerate(chosen):
        j = chosen[(k + 1) % len(chosen)]
        glen = (acc[j] - acc[i]) if j > i else (total - acc[i] + acc[j])
        gaps.append(glen)
    # 逐一把新點放進目前「平均每格最長」的段落
    cnt = [0] * len(gaps)
    for _ in range(extra):
        k = max(range(len(gaps)), key=lambda q: gaps[q] / (cnt[q] + 1))
        cnt[k] += 1
    arcs = []
    for k, i in enumerate(chosen):
        arcs.append(acc[i])
        glen = gaps[k]
        for t in range(1, cnt[k] + 1):
            arcs.append((acc[i] + glen * t / (cnt[k] + 1)) % total)
    arcs.sort()
    return arcs, acc, total


def process(name):
    im = Image.open(ART / f"{name}.png").convert("RGBA")
    w, h = im.size
    alpha = im.getchannel("A").point(lambda v: 255 if v > 128 else 0)
    alpha = alpha.filter(ImageFilter.MaxFilter(9))  # 膨脹 4px，把靠很近的零件黏起來
    mask = bytearray(1 if v else 0 for v in alpha.tobytes())
    mask = largest_component(mask, w, h)
    mask = fill_holes(mask, w, h)
    # 回縮一點（膨脹的 4px 退回去）
    img = Image.frombytes("L", (w, h), bytes(255 if v else 0 for v in mask)).filter(ImageFilter.MinFilter(7))
    mask = bytearray(1 if v else 0 for v in img.tobytes())
    mask = largest_component(mask, w, h)
    raw = trace(mask, w, h)
    pts = smooth([(float(x) + 0.5, float(y) + 0.5) for x, y in raw], 3)
    pts = resample_uniform(pts, 400)
    pts = smooth(pts, 2)
    # 順時針（螢幕座標 y 向下：shoelace 為正 = 順時針）
    if area2(pts) < 0:
        pts.reverse()
    # 起點：最上方（平頂時取最上方那一段的中間）
    top = min(p[1] for p in pts)
    tops = [i for i, p in enumerate(pts) if p[1] <= top + 1.2]
    # 連續區段的中間
    n = len(pts)
    tops_set = set(tops)
    run = []
    best = []
    for i in tops:
        if (i - 1) % n in tops_set and i != tops[0]:
            run.append(i)
        else:
            if len(run) > len(best):
                best = run
            run = [i]
    if len(run) > len(best):
        best = run
    s0 = best[len(best) // 2]
    pts = pts[s0:] + pts[:s0]
    # 座標轉換：物件包圍盒 → 0–400 的中央
    xs = [x for x, _ in pts]
    ys = [y for _, y in pts]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    s = (BOX - 2 * MARGIN) / max(max(xs) - min(xs), max(ys) - min(ys))
    tf = lambda p: ((p[0] - cx) * s + BOX / 2, (p[1] - cy) * s + BOX / 2)
    pts = [tf(p) for p in pts]
    img_box = [round((0 - cx) * s + BOX / 2, 1), round((0 - cy) * s + BOX / 2, 1), round(w * s, 1), round(h * s, 1)]
    dense = resample_uniform(pts, DENSE)
    # 重新取樣後 0 號點仍是起點（resample 從 s=0 開始）
    out_levels = {}
    for key, n_dots in LEVELS.items():
        arcs, acc, total = pick_dots(dense, n_dots)
        dots = [point_at(dense, acc, a) for a in arcs]
        out_levels[key] = [[round(x, 1), round(y, 1)] for x, y in dots]
    return {
        "img": img_box,
        "outline": [[round(x, 1), round(y, 1)] for x, y in dense],
        "levels": out_levels,
    }


def main():
    names = sys.argv[1:] or NAMES
    data = {"version": 1, "order": NAMES, "items": {}}
    if OUT.exists():
        old = json.loads(OUT.read_text())
        data["items"] = old.get("items", {})
    for nm in names:
        data["items"][nm] = process(nm)
        print(f"{nm}: outline {len(data['items'][nm]['outline'])} pts, levels {[len(v) for v in data['items'][nm]['levels'].values()]}")
    data["items"] = {k: data["items"][k] for k in NAMES if k in data["items"]}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"→ {OUT.relative_to(ROOT)} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
