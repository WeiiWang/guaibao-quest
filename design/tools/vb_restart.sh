#!/bin/zsh
# 重啟 Voicebox（含背景的 voicebox-server）。
# 用途：同一個 server 換用不同模型（例如 TTS 之後做辨識）會出現「There is no Stream(gpu, N) in current thread」，
# unload 模型沒用，只有整個 server 重開才恢復。quit App 不會帶走 server，所以要自己結束它。
osascript -e 'quit app "Voicebox"' 2>/dev/null
sleep 3
pkill -f "voicebox-server --data-dir" 2>/dev/null
sleep 4
open -a Voicebox
for i in $(seq 1 60); do
  sleep 3
  [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:17493/health)" = 200 ] && { echo "voicebox up after $((i * 3))s"; exit 0; }
done
echo "voicebox did not come up"; exit 1
