# 乖寶任務

給 4–7 歲孩子的學習冒險 PWA：跟著 3D 小猴「阿悟」走花果山冒險（數感、分類、規律），用材料佈置房間；生活任務由家長審核換星星餵阿悟。規格依序見 [SPEC.md](SPEC.md)、[SPEC-room-v2.md](SPEC-room-v2.md)、[SPEC-v2.md](SPEC-v2.md)。

## 開發

```bash
pnpm install
pnpm dev          # http://localhost:5173
pnpm test         # Vitest（領域邏輯 + repo 並行寫入）
pnpm typecheck && pnpm lint && pnpm build
```

dev 模式下可在 console 用 `__debug.advanceHours(n)` / `__debug.advanceDays(n)` 推進時間，測飢餓衰減與跨日任務；正式 build 不含。

## 在 iPad 上試玩

- 同一個 Wi-Fi：`pnpm build && pnpm preview --host`，iPad Safari 開 `http://<Mac 的區網 IP>:4173`。可以玩，但 http 下不會啟用 Service Worker（不能離線）。
- 要「加到主畫面」並離線使用，需要 HTTPS：push 到 `main` 會由 GitHub Actions（`.github/workflows/deploy.yml`）自動部署到 GitHub Pages。子路徑由 `BASE_PATH` 控制，本機子路徑測試：`BASE_PATH=/guaibao-quest/ pnpm build && pnpm preview --base /guaibao-quest/`。
- 資料存在該裝置瀏覽器的 IndexedDB，換裝置或清除網站資料就會消失（prototype 刻意不做同步）。

## 結構

- `src/domain` 純邏輯與數值常數（`constants.ts` 調經濟數值）
- `src/db` Dexie schema 與 `Repo`（交易、業務規則）
- `src/art` 素材對照與尺寸、10 張著色頁 SVG
- `public/art` 3D 公仔素材（由 `design/tools/gen.sh` 以 codex image 生成 + macOS Vision 去背）
- `src/ui` 畫面與元件（小孩端、`screens/parent` 家長端）

## 學習冒險（v2）

- 題庫：`src/learning/content/*.json`（固定檔，可審閱）。由 `pnpm gen:questions`（`scripts/gen-questions.mjs`，固定 seed）產生；`src/learning/bank.test.ts` 用獨立解題邏輯驗證每題恰好一個正解。
- 領域邏輯 `src/learning/`：抽題與關卡規劃（select）、難度/掌握/複習排程（skills）、計分（scoring）、家長報告（report）、遊玩時間（playtime）、語音（speech）、音效（sfx）。
- 開發時可用網址 hash 直達畫面：`#map`（冒險地圖）、`#workshop`（工坊）。
- e2e：`pnpm dev --port 5182 --strictPort`，另一個終端 `BASE_URL=http://localhost:5182 pnpm e2e:adventure`。
