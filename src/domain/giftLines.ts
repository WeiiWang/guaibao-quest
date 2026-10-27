// 禮物與新招的固定句型（會唸出來）。句子要跟 src/learning/lines.ts 的 STATIC_LINES 一字不差，
// 這樣預錄的媽媽聲才找得到音檔；src/domain/gifts.test.ts 會檢查兩邊一致。
import type { Gift } from './types'

/** 食物的量詞與名字（「一顆蘋果」） */
export const GIFT_FOOD_PHRASE: Record<string, string> = {
  carrot: '一根胡蘿蔔',
  cookie: '一片餅乾',
  banana: '一根香蕉',
  apple: '一顆蘋果',
  grape: '一串葡萄',
  milk: '一瓶牛奶',
  peach: '一顆桃子',
  riceball: '一個飯糰',
  watermelon: '一塊西瓜',
}
export const GIFT_DAILY_LINE = '今天的小禮物！'
export const GIFT_COLLECT_LINE = '你認識好多朋友，這個送給你！'
export const giftFoodLine = (foodId: string): string => `我在路上撿到${GIFT_FOOD_PHRASE[foodId] ?? '好吃的東西'}，送給你！`

/** 阿悟拿出禮物時說的話：學習掉落是「路上撿到」，今日小禮物、圖鑑獎勵各有固定句 */
export function giftLine(g: Gift): string {
  if (g.from === 'daily') return GIFT_DAILY_LINE
  if (g.from === 'collection') return GIFT_COLLECT_LINE
  return g.foodId ? giftFoodLine(g.foodId) : GIFT_DAILY_LINE
}

export const TIME_WARN_LINE = '再玩一下下就要睡覺囉'
