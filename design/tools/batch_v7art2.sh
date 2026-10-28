#!/bin/zsh
# 逐張生成 v7art2.txt：scene-map-* 不去背（縮到 1280 寬並裁成 1280x720），其餘白底去背
cd ${0:A:h}
ROOT=${0:A:h:h:h}
while IFS= read -r line; do
  [ -z "$line" ] && continue
  name=${line%%|*}; rest=${line#*|}
  prompt=${rest%|*}; ref=${rest##*|}
  [ -n "$ref" ] && ref=${ref:A}
  t=1; wait_s=60
  while [ $t -le 6 ]; do
    [ -f "$ROOT/public/art/$name.png" ] && { echo "SKIP $name"; break; }
    if ./gen.sh "$name" "$prompt" "$ref"; then
      if [[ $name == scene-map-* ]]; then
        uv run --with pillow python -I -c "
from PIL import Image,ImageOps
im=Image.open('$ROOT/design/raw/$name.png').convert('RGB')
ImageOps.fit(im,(1280,720),Image.LANCZOS).save('$ROOT/public/art/$name.png')" && echo "MAP $name"
      else
        uv run --with pillow python -I cutout_white.py "$ROOT/design/raw/$name.png" "$ROOT/public/art/$name.png"
      fi
      break
    fi
    echo "RETRY $name in ${wait_s}s ($t/6)"
    sleep $wait_s; wait_s=$((wait_s * 2)); t=$((t + 1))
  done
done < v7art2.txt
echo ART2-DONE
