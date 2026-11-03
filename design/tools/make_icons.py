"""App 圖示：從 design/raw/app-icon.png（AI 生成的主圖，不進 repo）切出所有尺寸，寫到 public/。

執行（在 repo 根目錄）：
    uv run --with pillow python -I design/tools/make_icons.py
    # 指定來源 / 輸出資料夾（測試用）：
    uv run --with pillow python -I design/tools/make_icons.py --src /path/app-icon.png --out /tmp/icons

產出（public/）：
    icon-192.png            192×192   manifest purpose=any（有透明角就保留透明）
    icon-512.png            512×512   manifest purpose=any
    icon-maskable-512.png   512×512   manifest purpose=maskable：圖內縮到 90%（Android 圓形 / 圓角遮罩會切四周），四周用主圖最外一圈像素延伸補滿
    apple-touch-icon.png    180×180   iOS 主畫面圖示：一定要不透明、不能自己切圓角（iOS 會切）

來源圖的建議：1024×1024 以上、正方形、滿版（不要自己畫圓角或留白邊）。不是正方形會置中裁成正方形；
有透明的角（例如已經切成圓角）會用邊緣的顏色補滿，給 apple-touch-icon 與 maskable 用。
舊的像素猴 public/icon.svg 已經不用（index.html 與 manifest 都改指向 png），可以刪。
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[2]


def center_square(im: Image.Image) -> Image.Image:
    w, h = im.size
    if w == h:
        return im
    s = min(w, h)
    print(f"  來源不是正方形（{w}×{h}），置中裁成 {s}×{s}")
    return im.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s))


def edge_color(im: Image.Image) -> tuple[int, int, int]:
    """四邊（內縮 2%）不透明像素的平均色：用來補透明的角、當 maskable 的底色。"""
    small = im.resize((64, 64), Image.LANCZOS)
    px = small.load()
    acc = [0, 0, 0]
    n = 0
    for i in range(64):
        for x, y in ((i, 2), (i, 61), (2, i), (61, i)):
            r, g, b, a = px[x, y]
            if a > 200:
                acc[0] += r
                acc[1] += g
                acc[2] += b
                n += 1
    if n == 0:
        return (255, 246, 234)  # 專案的奶油色
    return (acc[0] // n, acc[1] // n, acc[2] // n)


def flatten(im: Image.Image, fill: tuple[int, int, int]) -> Image.Image:
    """透明的地方用邊緣色補滿，回傳不透明 RGB。"""
    bg = Image.new("RGBA", im.size, fill + (255,))
    bg.alpha_composite(im)
    return bg.convert("RGB")


def has_transparency(im: Image.Image) -> bool:
    return im.getchannel("A").getextrema()[0] < 250


def resized(im: Image.Image, size: int) -> Image.Image:
    return im.resize((size, size), Image.LANCZOS)


def maskable(im_opaque: Image.Image, size: int = 512, scale: float = 0.9) -> Image.Image:
    """內縮到安全區（Android 遮罩會切掉四周）。四周的邊用主圖最外一圈像素「延伸」再輕微模糊補出來：
    背景漸層無縫接上；不鏡射（鏡射會把星星、耳朵複製一份）。主圖的主角在正中央，留 90% 就夠。"""
    inner = int(size * scale)
    m = (size - inner) // 2  # 每邊補的寬度
    icon = im_opaque.resize((inner, inner), Image.LANCZOS)
    canvas = Image.new("RGB", (size, size))
    canvas.paste(icon, (m, m))
    if m > 0:
        canvas.paste(icon.crop((0, 0, inner, 1)).resize((inner, m), Image.NEAREST), (m, 0))
        canvas.paste(icon.crop((0, inner - 1, inner, inner)).resize((inner, m), Image.NEAREST), (m, size - m))
        canvas.paste(icon.crop((0, 0, 1, inner)).resize((m, inner), Image.NEAREST), (0, m))
        canvas.paste(icon.crop((inner - 1, 0, inner, inner)).resize((m, inner), Image.NEAREST), (size - m, m))
        for sx, sy, dx, dy in ((0, 0, 0, 0), (inner - 1, 0, size - m, 0), (0, inner - 1, 0, size - m), (inner - 1, inner - 1, size - m, size - m)):
            canvas.paste(icon.crop((sx, sy, sx + 1, sy + 1)).resize((m, m), Image.NEAREST), (dx, dy))
        # 只模糊外圈（內圈保持銳利），讓延伸出來的條紋變成柔和的漸層
        blurred = canvas.filter(ImageFilter.GaussianBlur(m * 0.9))
        ring = Image.new("L", (size, size), 255)
        ring.paste(0, (m, m, size - m, size - m))
        canvas = Image.composite(blurred, canvas, ring)
    return canvas


def main() -> None:
    ap = argparse.ArgumentParser(description="從 app-icon.png 切出 PWA / iOS 圖示")
    ap.add_argument("--src", type=Path, default=ROOT / "design/raw/app-icon.png")
    ap.add_argument("--out", type=Path, default=ROOT / "public")
    args = ap.parse_args()

    if not args.src.exists():
        raise SystemExit(f"找不到來源圖 {args.src}（還沒生成？產出後放到 design/raw/app-icon.png）")
    args.out.mkdir(parents=True, exist_ok=True)

    src = Image.open(args.src).convert("RGBA")
    print(f"來源 {args.src}  {src.size[0]}×{src.size[1]}")
    src = center_square(src)
    if src.size[0] < 512:
        print(f"  警告：來源只有 {src.size[0]}px，小於 512，圖示會偏糊")

    transparent = has_transparency(src)
    fill = edge_color(src)
    opaque = flatten(src, fill) if transparent else src.convert("RGB")
    if transparent:
        print(f"  來源有透明的角，apple-touch-icon / maskable 用邊緣色 #{fill[0]:02x}{fill[1]:02x}{fill[2]:02x} 補滿")

    outputs = {
        "icon-192.png": resized(src, 192),
        "icon-512.png": resized(src, 512),
        "icon-maskable-512.png": maskable(opaque),
        "apple-touch-icon.png": resized(opaque, 180),
    }
    for name, im in outputs.items():
        path = args.out / name
        im.save(path, optimize=True)
        print(f"  寫入 {path}  {im.size[0]}×{im.size[1]}  {path.stat().st_size // 1024}KB")
    print("完成。manifest（vite.config.ts）已指向這四個檔；記得把它們一起 commit。")


if __name__ == "__main__":
    main()
