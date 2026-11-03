"""iPad 冷啟動畫面（apple-touch-startup-image）：從 public/art/title-keyart.jpg 切出常見 iPad 尺寸的橫直兩張，
並印出要貼進 index.html 的 <link> 標籤。沒有符合的尺寸時 iOS 會顯示白畫面，所以常見機型都要有。

執行（在 repo 根目錄）：
    uv run --with pillow python -I design/tools/make_startup_images.py
    # 只印 <link>、不寫檔：加 --links-only

產出：public/startup/ipad-<寬>x<高>.jpg（JPEG，每張約 130–270KB；不進 precache，iOS 只在加到主畫面時抓）。
裁切方式：主視覺是 16:9 橫圖。橫向 iPad 直接置中裁；直向 iPad 把主視覺放在下方（角色與地景才不會被切掉一大半），
上面的天空用主視覺最上面一排像素往上延伸（不用模糊放大墊底：那樣角色會在天空留下一團團的影子）。
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "public/art/title-keyart.jpg"
OUT = ROOT / "public/startup"

# (CSS 寬, CSS 高, 像素比)：直向的 CSS 尺寸。iPad 全部都是 @2x
DEVICES = [
    (744, 1133, 2),  # iPad mini 6/7
    (768, 1024, 2),  # iPad 9.7 吋、iPad mini 5
    (810, 1080, 2),  # iPad 10.2 吋
    (820, 1180, 2),  # iPad 10.9 吋（Air 4/5、iPad 10）
    (834, 1112, 2),  # iPad Air 3、Pro 10.5 吋
    (834, 1194, 2),  # iPad Pro 11 吋（M1/M2）
    (834, 1210, 2),  # iPad Pro 11 吋（M4）、Air 11 吋
    (1024, 1366, 2),  # iPad Pro 12.9 吋、Air 13 吋
    (1032, 1376, 2),  # iPad Pro 13 吋（M4）
]


def render(src: Image.Image, w: int, h: int) -> Image.Image:
    if w >= h:
        return ImageOps.fit(src, (w, h), Image.Resampling.LANCZOS, centering=(0.5, 0.5))
    # 直向：主視覺貼著下緣，天空用它最上面一排往上延伸
    fg_h = round(h * 0.62)
    fg = ImageOps.fit(src, (w, fg_h), Image.Resampling.LANCZOS, centering=(0.5, 0.5))
    sky = fg.crop((0, 0, w, 1)).resize((w, h - fg_h + 8), Image.Resampling.BILINEAR)
    out = Image.new("RGB", (w, h))
    out.paste(sky, (0, 0))
    out.paste(fg, (0, h - fg_h))
    return out


def link_tag(w: int, h: int, r: int, orient: str) -> str:
    pw, ph = (w * r, h * r) if orient == "portrait" else (h * r, w * r)
    return f'    <link rel="apple-touch-startup-image" href="/startup/ipad-{pw}x{ph}.jpg" media="(device-width: {w}px) and (device-height: {h}px) and (-webkit-device-pixel-ratio: {r}) and (orientation: {orient})" />'


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--links-only", action="store_true")
    args = ap.parse_args()
    tags: list[str] = []
    src = Image.open(SRC).convert("RGB")
    if not args.links_only:
        OUT.mkdir(parents=True, exist_ok=True)
    for w, h, r in DEVICES:
        for orient in ("portrait", "landscape"):
            tags.append(link_tag(w, h, r, orient))
            if args.links_only:
                continue
            pw, ph = (w * r, h * r) if orient == "portrait" else (h * r, w * r)
            render(src, pw, ph).save(OUT / f"ipad-{pw}x{ph}.jpg", quality=72, optimize=True, progressive=True)
    print("\n".join(tags))


if __name__ == "__main__":
    main()
