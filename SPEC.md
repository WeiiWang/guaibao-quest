# 乖寶任務 — Phase 0 MVP 規格

## 目標
驗證：小孩會不會為了寵物，主動要求家長審核任務。單機 PWA，家長與小孩共用一台 iPad，以 PIN 切換家長模式。

## 不做
上架、收費、帳號、雲端同步、多寵物、廣告、外部連結、追蹤分析。

## 技術
- Vite + React 18 + TypeScript（strict）+ pnpm
- 資料：IndexedDB via Dexie（`dexie` + `dexie-react-hooks`）
- PWA：`vite-plugin-pwa`（manifest、離線快取、可加到主畫面）
- 樣式：純 CSS（CSS variables），不用 UI 框架
- 測試：Vitest，至少覆蓋領域邏輯（點數、每日上限、寵物成長/飢餓、任務狀態轉移）
- 時間一律透過可注入的 `now()`，方便測試
- 介面全繁體中文；觸控優先（iPad 直/橫向，按鈕最小 56px），手機寬度也要能用

## 核心循環
1. 小孩端看到今日任務 → 按「我做完了」→ 狀態 `pending`
2. 家長（PIN）審核 → `approved` 加點 / `rejected` 不加點（可再申請）
3. 家長也能直接給點數（附理由，例：「今天很乖」）或扣點（不可讓餘額 < 0）
4. 小孩在商店用點數買飼料/裝飾/著色頁 → 餵寵物、放裝飾、解鎖著色頁
5. 寵物成長、表情變化

## 設計原則（必守）
- 寵物不會死。飢餓度 0–100，每小時 −4，最低 0；0 時只是「無精打采」表情，餵了就恢復
- 每日（本地日期）任務 + 家長加點總和上限 100 點；超過的部分不發放，UI 告知家長「今日已達上限」
- 家長功能需 4 位數 PIN（首次啟動設定；可在家長設定中更改）。PIN 以 SHA-256 雜湊存（不用很強，防小孩看即可）
- 點數用只新增的流水帳 `PointLedger`，餘額 = 加總，不存餘額欄位

## 資料模型（Dexie）
- `Child { id, name, avatar }` — MVP 只一個小孩，首次啟動設定名字
- `TaskTemplate { id, title, emoji, points(10–30), repeatDaily: boolean, active: boolean, order }`
  - 預設模板：寫功課 30、收玩具 20、看書 10 分鐘 20、刷牙 10、自己穿衣服 10
- `TaskInstance { id, templateId, date(YYYY-MM-DD), status: 'todo'|'pending'|'approved'|'rejected', updatedAt }`
  - 每日任務在當天第一次開啟時依 active+repeatDaily 模板產生（idempotent）
  - 非每日模板：建立後產生一次，完成後不再出現
- `PointLedger { id, at, delta, reason, kind: 'task'|'bonus'|'penalty'|'purchase', refId? }`
- `Pet { id, name, stage: 'egg'|'baby'|'adult', feedCount, hunger, hungerUpdatedAt, mood }`
  - 成長：feedCount ≥ 20 → baby；≥ 80 → adult（蛋階段餵食 = 孵蛋，給溫暖動畫）
  - 表情：happy（hunger ≥ 60）、normal（30–59）、sleepy/low（< 30）、eating（餵食動畫中）
  - 摸摸：點寵物有反應動畫（不影響數值）
- `ShopItem { id, kind: 'food'|'decor'|'coloring', name, price, asset }`
  - 飼料：香蕉 10（hunger +25, feedCount +1）、桃子 20（hunger +50, feedCount +2）
  - 裝飾 3 個：50–150（放在寵物房間背景，可切換顯示）
  - 著色頁：每張 30
- `Inventory { id, itemId, qty }`；`ColoringProgress { pageId, fills: Record<regionId, color>, updatedAt }`
- `Settings { pinHash, childName, onboarded }`

## 畫面
小孩端（預設）
1. 首頁：寵物房間（大）、點數餘額、今日任務入口、商店入口、著色入口；右上角小鎖頭 = 家長入口
2. 今日任務：卡片列表（emoji + 名稱 + 點數 + 狀態），按「我做完了」→ 變「等爸媽確認」
3. 商店：分頁 飼料/裝飾/著色頁，餘額不足時按鈕 disabled 並顯示差多少
4. 背包/餵食：從首頁點飼料拖或點選餵寵物
5. 著色本：已解鎖頁面列表 → 填色畫面（點區域填色，12 色低彩度色盤，可清除，自動存）

家長端（PIN 後）
6. 審核：待審核列表，一鍵通過/退回；全部通過按鈕
7. 加/扣點：數量 + 理由
8. 任務管理：新增/編輯/停用模板
9. 點數紀錄：流水帳列表
10. 設定：改 PIN、改小孩名字、改寵物名字、重設全部資料（需再輸 PIN 確認）
- 家長模式 5 分鐘無操作自動回小孩端；有明顯「回到小孩模式」按鈕

首次啟動（onboarding）：設定 PIN（輸兩次）→ 小孩名字 → 寵物名字（預設「阿悟」）→ 看到一顆蛋

## 美術
- 16-bit 像素風、低彩度（參考動森的柔和色調）、Q 版
- 寵物：小猴子（孫悟空意象，頭上金色小箍可在 adult 出現）。用程式化像素陣列（例：32×32 字元格 + 色盤）渲染成 SVG 或 canvas，`image-rendering: pixelated`
- 每階段至少 happy/normal/low 三種表情 + eating；蛋階段可用蛋的晃動/裂痕表現
- 簡單動畫：idle 上下呼吸、被摸跳一下、吃東西
- 著色頁：10 張 SVG 線稿（每張 6–15 個可填色區域，主題：猴子、香蕉樹、雲、筋斗雲、房子、魚、花、汽車、太陽月亮、小雞），粗黑線、區域為封閉 path

## 數值常數
集中在 `src/domain/constants.ts`，方便調整。

## 驗收條件
- `pnpm build` 無錯誤、`pnpm test` 全綠、`pnpm lint`/`tsc --noEmit` 無錯
- 完整走過：onboarding → 小孩申請任務 → 家長審核通過 → 點數增加 → 買香蕉 → 餵食 → feedCount 增加；退回流程；每日上限；扣點不能為負；買不起 disabled；著色頁購買後可填色且重開仍保留；PIN 錯誤不得進入家長模式
- 重新整理後資料保留；跨日（模擬 now）產生新的每日任務
- iPad 寬度（1024×768、768×1024）與手機寬度（375）版面不破
