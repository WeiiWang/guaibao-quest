#!/bin/zsh
# 逐張生成 assets.txt 內的素材（每行 name|prompt|ref），已存在的跳過。
# 圖片 API 有限流（429），所以一次只跑一張，失敗就退避重試。
# usage: batch.sh [max_tries=6]
cd ${0:A:h}
ROOT=${0:A:h:h:h}
TRIES=${1:-6}
while IFS= read -r line; do
  [ -z "$line" ] && continue
  name=${line%%|*}; rest=${line#*|}
  prompt=${rest%|*}; ref=${rest##*|}
  [ -n "$ref" ] && ref=${ref:A}
  t=1; wait_s=60
  while [ $t -le $TRIES ]; do
    [ -f "$ROOT/public/art/$name.png" ] && { echo "SKIP $name"; break; }
    ./gen.sh "$name" "$prompt" "$ref" --cut && break
    echo "RETRY $name in ${wait_s}s ($t/$TRIES)"
    sleep $wait_s; wait_s=$((wait_s * 2)); t=$((t + 1))
  done
  [ $t -gt $TRIES ] && echo "GIVEUP $name"
done < assets.txt
echo DONE
