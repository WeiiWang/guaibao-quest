#!/bin/zsh
# 逐張生成 v8art.txt（可續跑）：scene-stage-*/title-keyart 轉 1600x900 jpg；ui-logo 白底去背；app-icon 只存 raw，之後另外切圖示
cd ${0:A:h}
ROOT=${0:A:h:h:h}
LIST=${1:-v8art.txt}
while IFS= read -r line || [ -n "$line" ]; do
  [ -z "$line" ] && continue
  name=${line%%|*}; rest=${line#*|}
  prompt=${rest%|*}; ref=${rest##*|}
  [ -n "$ref" ] && ref=${ref:A}
  t=1; wait_s=60
  while [ $t -le 6 ]; do
    [ -f "$ROOT/design/raw/$name.png" ] && { echo "SKIP $name"; break; }
    if ./gen.sh "$name" "$prompt" "$ref"; then echo "RAW $name"; break; fi
    echo "RETRY $name in ${wait_s}s ($t/6)"; sleep $wait_s; wait_s=$((wait_s * 2)); t=$((t + 1))
  done
  case $name in
    scene-*|title-*|story-*) uv run --with pillow python -I -c "
from PIL import Image,ImageOps
im=Image.open('$ROOT/design/raw/$name.png').convert('RGB')
ImageOps.fit(im,(1600,900),Image.LANCZOS).save('$ROOT/public/art/$name.jpg',quality=82,optimize=True)" && echo "JPG $name" ;;
    ui-*|decor-*|obj-*) uv run --with pillow python -I cutout_white.py "$ROOT/design/raw/$name.png" "$ROOT/public/art/$name.png" && echo "CUT $name" ;;
  esac
done < "$LIST"
echo ALLDONE
