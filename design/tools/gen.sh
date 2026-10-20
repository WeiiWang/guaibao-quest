#!/bin/zsh
# 用 codex 生圖並（可選）去背
# usage: gen.sh <name> <prompt> [ref.png] [--cut]
# 輸出：design/raw/<name>.png；加 --cut 另輸出 public/art/<name>.png（透明、裁切）
set -u
setopt null_glob
ROOT=${0:A:h:h:h}
NAME=$1; PROMPT=$2; REF=${3:-}; CUT=${4:-}
WORK=${TMPDIR:-/tmp}/guaibao-codex-$NAME
mkdir -p "$WORK" "$ROOT/design/raw" "$ROOT/public/art"
cd "$WORK"
LOG=$WORK/log.txt
ARGS=(exec -m gpt-5.6-sol --skip-git-repo-check --sandbox workspace-write)
[ -n "$REF" ] && ARGS+=("--image=$REF")
codex "${ARGS[@]}" "$PROMPT" < /dev/null > "$LOG" 2>&1
SID=$(sed -n 's/^session id: //p' "$LOG" | head -1)
FILES=("$HOME/.codex/generated_images/$SID"/*.png)
if [ ${#FILES[@]} -eq 0 ]; then echo "FAIL $NAME (log: $LOG)"; grep -m2 ERROR "$LOG"; exit 1; fi
cp "${FILES[1]}" "$ROOT/design/raw/$NAME.png"
if [ "$CUT" = "--cut" ]; then
  swift "$ROOT/design/tools/cutout.swift" "$ROOT/design/raw/$NAME.png" "$ROOT/public/art/$NAME.png" >/dev/null 2>&1 \
    && sips -Z 512 "$ROOT/public/art/$NAME.png" >/dev/null && echo "OK $NAME (cut)" || echo "CUTFAIL $NAME"
else
  echo "OK $NAME"
fi
rm -rf "$WORK"
