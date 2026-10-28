#!/bin/zsh
# 逐張生成 lineart.txt 的著色線稿（不去背），輸出 design/raw/<name>.png；已存在就跳過
cd ${0:A:h}
ROOT=${0:A:h:h:h}
while IFS= read -r line; do
  [ -z "$line" ] && continue
  name=${line%%|*}; rest=${line#*|}
  prompt=${rest%|*}; ref=${rest##*|}
  [ -n "$ref" ] && ref=${ref:A}
  t=1; wait_s=60
  while [ $t -le 6 ]; do
    [ -f "$ROOT/design/raw/$name.png" ] && { echo "SKIP $name"; break; }
    ./gen.sh "$name" "$prompt" "$ref" && break
    echo "RETRY $name in ${wait_s}s ($t/6)"
    sleep $wait_s; wait_s=$((wait_s * 2)); t=$((t + 1))
  done
  [ $t -gt 6 ] && echo "GIVEUP $name"
done < lineart.txt
echo LINE-DONE
