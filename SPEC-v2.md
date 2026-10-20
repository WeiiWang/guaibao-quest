# 乖寶任務 Prototype v2 規格

承接 Phase 0（SPEC.md）與房間 v2（SPEC-room-v2.md）。本版目標：**prototype 等級**——孩子能自主完成學習冒險、獲得材料、照顧寵物、佈置房間；家長能管理任務、看懂學習紀錄、控制使用時間。參考 Little Quest 規格（摘要見文末），但維持 Web PWA（Vite + React + TS + Dexie）。

## 1. 核心循環

```
冒險地圖（學習關卡）──通關──▶ 材料（木材/石頭/花朵）──▶ 工坊：做家具 ──▶ 佈置房間
生活任務（家長審核）──通過──▶ 星星 ──▶ 商店：飼料/著色頁 ──▶ 餵阿悟
阿悟：學習夥伴（答錯給提示、答對歡呼）＋寵物（餵食成長）
```

- 兩種貨幣分開：**星星**＝生活任務（沿用 PointLedger、每日上限 100）；**材料**＝學習（新表 MaterialLedger）。家長報表分開統計。
- 家具改由「工坊」用材料製作（不再用星星買）；商店只賣飼料與著色頁。
- 家長不設任何任務，孩子仍可完整玩學習冒險。

## 2. 冒險地圖（西遊記・第一章 花果山）

- 一章 5 站，沿著山路排列；每站一個關卡，依序解鎖。章末有「寶箱」與結束儀式（阿悟歡呼 + 獲得額外材料 + 「今天的冒險完成了！」）。
- 一次冒險約 8–12 分鐘（5 站 × 約 2 分鐘），有明確結束點。
- 每站 = 5 題，題型混合三種技能；完成一站給 2–4 個材料（依無提示答對數）。
- 第二次以後重玩同一章：題目從題庫抽不同題面；已掌握技能出複習題。
- 後續章節（水簾洞、龍宮…）先顯示「即將開放」鎖住。

## 3. 學習機制（只做這三種技能）

| 技能 id | 內容 | 難度 1 | 難度 2 | 難度 3 |
|---|---|---|---|---|
| `number` 數感 | 1–20 數量辨識、多寡比較 | 數 1–5 個 | 數 6–10、比較兩堆 | 11–20、哪堆多幾個（≤3） |
| `classify` 分類 | 依特徵分類 | 依種類（水果/動物）2 選 1 | 依顏色、3 類 | 找出不同類的那一個 |
| `pattern` 規律 | 序列 | AB 補下一個 | AAB、ABB | ABC、補中間缺的 |

- 題目以 JSON 配置（`src/learning/content/*.json`）：`{ id, skill, difficulty, type, prompt(語音與字幕文字), items, choices, answer, hint, version }`。題目要人工可讀、適齡。每技能每難度至少 12 題（共 ≥108 題），可用程式產生器 + 人工檢查的方式產出，但輸出必須是固定 JSON 檔（可審閱）。
- **語音唸題**：所有題目與提示用 Web Speech API（zh-TW）唸出；畫面有「再聽一次」喇叭按鈕；家長可關閉音效/語音。不支援時只顯示字幕。
- **答錯**：不扣分不懲罰；第一次錯 → 阿悟「想一想」姿勢 + 提示（語音 + 視覺，例如數數時逐一亮起物件）；第二次錯 → 標出正確答案並請孩子點一下。提示後答對**不算**獨立答對。
- **作答紀錄** `Attempt { id, at, questionId, skill, difficulty, firstTryCorrect, hintsUsed, durationMs, sessionId }`。
- **難度調整**：每技能各自追蹤；最近 5 題無提示答對 ≥4 → 升一級；≤1 → 降一級。
- **複習**：技能在某難度「已掌握」（連續 2 次站點 ≥80% 無提示答對）後，隔天/隔週以不同題面出 1 題複習。第 14 天短版異題追蹤先記錄欄位即可（`followUp: true`），不做額外 UI。
- 操作：題目選項是大張 3D 物件卡片（點選），最小 96px；數量用物件圖排列。

## 4. 阿悟（寵物 + 學習夥伴）

- 成長：仙石蛋 → 小猴（無背心、無頭箍）→ 阿悟（背心 + 金頭箍）。門檻沿用 constants。
- 姿勢圖：happy、idle、sleepy、eating、cheer（歡呼）、think（想一想）。學習時出現在畫面角落當夥伴。
- 用 CSS 做動態：idle 呼吸（scaleY 1→1.02）、點擊彈跳（squash & stretch）、cheer 跳躍、eating 時切圖。
- 不會死；餓了 sleepy。

## 5. 家長區（PIN）

沿用：審核、加扣星星、任務管理、星星紀錄、設定。新增：
- **學習報告**（分頁）：本週練習回合數、各技能「無提示答對率」與題數、目前難度、需要加強的技能（答對率最低者）、最近 7 天每日練習長條。文字要白話（例：「數數 6–10 已經很穩，可以多練比較多寡」）。
- **每日遊玩時間**：15/20/30/45/不限，預設 20 分鐘。到時間：阿悟打哈欠「我想睡覺了，明天再一起冒險吧」，學習與餵食鎖住（家長 PIN 可延長 10 分鐘）。計時只算前景使用時間。
- **音效/語音開關**。
- **生活任務建議每日最多 2 項**：任務管理提示「建議每天 1–2 項」，超過時溫和提醒（不禁止）。
- **訂閱方案頁（樣品）**：只在家長區。顯示免費 vs 訂閱內容、NT$149/月、NT$990/年、自動續訂與取消說明、恢復購買按鈕；按下購買顯示「Prototype 尚未開放付款」。不可出現在兒童端。

## 6. 視覺設計系統（取代 16-bit）

參考：Pinterest 上的 3D 公仔兒童 App UI（本機 `design/ref/`，不入版控；3D 軟膠公仔 + 馬卡龍純色卡片）與 `design/concepts/ui-1.png`（首頁版面）。
- 角色與物件：3D 軟膠公仔 PNG（透明背景），放 `public/art/`。**不再使用 PixelArt 元件**（著色頁 SVG 保留）。
- 色票（CSS variables）：mint `#7FD6B4`、butter `#FFD66B`、peach `#FF9F8A`、bubblegum `#FF8FB1`、lavender `#B9A6F5`、sky `#8EC9F5`、cream 背景 `#FFF6EA`、ink `#4A3B35`。每個主畫面一個主色（首頁 cream+暖光、地圖 mint、商店 peach、工坊 butter、著色 lavender、任務 sky）。
- 形狀：圓角 24–32px 卡片、按鈕為「軟糖」感（底部 4–6px 深色厚陰影 + 按下下沉）、大量留白。
- 字體：系統字 `"PingFang TC","Noto Sans TC",system-ui`，標題 800–900 粗。字級：標題 28–36、按鈕 20–24、內文 18。
- 動效：所有按鈕按下 scale 0.96 + 陰影變薄；畫面切換淡入上滑 200ms；獲得獎勵飛入動畫（物件飛到貨幣列）。尊重 `prefers-reduced-motion`。
- 主選單（首頁底部）四顆大糖果按鈕：冒險地圖、今日任務、商店、著色本；次要：工坊、背包（較小）。

## 7. 美術素材清單（`public/art/<name>.png`，透明背景、已裁切）

由 `design/tools/gen.sh` 生成（codex image + macOS Vision 去背）。程式請以這些檔名引用；缺檔時顯示圓角色塊 + 名稱當 fallback，不可壞版。

- 阿悟：`pet-egg`、`pet-egg-crack`、`pet-baby-{happy,idle,sleepy,eating,cheer,think}`、`pet-adult-{happy,idle,sleepy,eating,cheer,think}`
- 飼料：`food-banana`、`food-peach`
- 家具（slot）：`decor-plant`(floor)、`decor-rug`(floor)、`decor-frame`(wall)、`decor-clock`(wall)、`decor-curtain`(wall)、`decor-poster`(wall)、`decor-bed`(floor)、`decor-ball`(floor)、`decor-shelf`(floor)、`decor-crate`(floor)
- 材料：`mat-wood`、`mat-stone`、`mat-flower`
- 學習物件（含屬性，供出題）：
  - `obj-banana`(水果, 黃)、`obj-peach`(水果, 粉)、`obj-apple`(水果, 紅)、`obj-grape`(水果, 紫)
  - `obj-fish`(動物, 藍)、`obj-chick`(動物, 黃)、`obj-rabbit`(動物, 白)
  - `obj-flower`(大自然, 粉)、`obj-shell`(大自然, 粉橘)、`obj-star`(大自然, 黃)
- UI 圖示：`ui-map`、`ui-tasks`、`ui-shop`、`ui-coloring`、`ui-bag`、`ui-workshop`、`ui-star`、`ui-lock`、`ui-chest`
- 場景：`scene-map-huaguoshan`（花果山地圖背景，橫向，非透明）

房間背景用 CSS 繪製（暖色牆面 + 木地板 + 柔光漸層），不用圖。

## 8. 資料與遷移

- Dexie version +1：新增 `attempts`、`materialLedger`、`progress`（每章每站狀態）、`skillState`（每技能難度、最近結果、mastered 時間）、`playTime`（每日累計秒數）；settings 加 `dailyLimitMin`、`soundOn`、`voiceOn`。
- 家具在 ShopItem 加 `cost: { wood, stone, flower }`；舊資料已擁有的裝飾保留。
- 舊玩家升級不可遺失：星星、寵物、已擺放家具、著色進度。

## 9. 驗收（prototype 完成標準）

- 新使用者：onboarding → 3 分鐘內完成第一站第一題（含語音）。
- 冒險：完成 5 站與章末儀式，材料入帳；答錯有提示且提示後答對不計獨立答對（看 attempts 資料）。
- 工坊：用材料做家具 → 佈置房間（沿用拖曳）。
- 生活任務：申請 → 家長審核 → 星星 → 買香蕉 → 拖曳餵食。
- 家長：學習報告數字與 attempts 一致；時間限制到時鎖住並可延長；訂閱樣品頁只在家長區。
- 離線：build 後 preview，斷網重整仍可玩（Service Worker）。
- 版面：1024×768、768×1024、375×812 不破；build/test/typecheck/lint 全過；e2e 腳本涵蓋冒險一站的完整流程。

## 附：Little Quest 規格中本版不做

正式 App Store/Google Play 內購與恢復購買、Flutter/Flame、隱私政策與客服流程、30–50 家庭封測營運。這些在 prototype 驗證後再決定。
