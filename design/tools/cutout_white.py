"""白底情境圖去背：從四邊 flood fill 掉「接近白色且與邊緣相連」的背景，保留所有道具。

macOS Vision 的前景遮罩只留主角，會把分開的小道具（地上的玩具、香蕉皮、紅綠燈）一起去掉，
所以有多個物件的情境圖改用這支。usage: uv run --with pillow python -I cutout_white.py <in.png> <out.png>
"""
import sys
from collections import deque

from PIL import Image, ImageFilter

THRESH = 238  # RGB 都高於這個值視為白底


def main(src, dst):
    im = Image.open(src).convert('RGBA')
    w, h = im.size
    px = im.load()
    bg = bytearray(w * h)
    q = deque()

    def white(x, y):
        r, g, b, _ = px[x, y]
        return r >= THRESH and g >= THRESH and b >= THRESH

    for x in range(w):
        for y in (0, h - 1):
            if white(x, y):
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if white(x, y):
                q.append((x, y))
    while q:
        x, y = q.popleft()
        i = y * w + x
        if bg[i]:
            continue
        bg[i] = 1
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not bg[ny * w + nx] and white(nx, ny):
                q.append((nx, ny))

    alpha = Image.new('L', (w, h), 255)
    ap = alpha.load()
    for y in range(h):
        for x in range(w):
            if bg[y * w + x]:
                ap[x, y] = 0
    # 邊緣柔化，避免鋸齒白邊
    alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.2))
    im.putalpha(alpha)
    bbox = alpha.point(lambda a: 255 if a > 16 else 0).getbbox()
    if bbox:
        pad = int(max(w, h) * 0.02)
        bbox = (max(0, bbox[0] - pad), max(0, bbox[1] - pad), min(w, bbox[2] + pad), min(h, bbox[3] + pad))
        im = im.crop(bbox)
    im.thumbnail((512, 512))
    im.save(dst)
    print('ok', im.size)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
