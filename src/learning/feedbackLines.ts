/**
 * 商店、工坊、任務的回饋句（v7.2）：句子裡帶商品名稱，所以不在 lines.ts 的固定清單裡。
 * 這裡把所有可能的句子列出來給 export-speech-lines 預錄；畫面用 sayText(原文) 依文字找音檔。
 * 句型要跟呼叫端完全一樣（Shop.tsx、Workshop.tsx、Tasks.tsx、Coloring.tsx）。
 */
import { SHOP_ITEMS } from '../domain/constants'
import { THEME_DEFS } from '../domain/theme'

export const buyLine = (name: string): string => `買到${name.replace('著色頁：', '')}囉！`
export const refundLine = (name: string): string => `${name.replace('著色頁：', '')}退回囉`
export const craftLine = (name: string): string => `${name}做好了！`
export const coloringPriceLine = (price: number): string => `這張要用${price}顆星星，在商店換喔`
/** 工坊材料不夠：缺多少已經用圖示 + 數字顯示，語音只說一句固定的話（組合太多，沒辦法每種都預錄） */
export const CRAFT_SHORT_LINE = '材料還不夠喔，去冒險找材料吧'
export const TASK_UNDO_LINE = '收回囉'

export function feedbackLines(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const it of SHOP_ITEMS) {
    out[`fb.buy.${it.id}`] = buyLine(it.name)
    out[`fb.refund.${it.id}`] = refundLine(it.name)
    if (it.kind === 'decor') out[`fb.craft.${it.id}`] = craftLine(it.name)
  }
  for (const t of THEME_DEFS) out[`fb.craft.${t.id}`] = craftLine(t.name)
  for (const p of new Set(SHOP_ITEMS.filter((i) => i.kind === 'coloring').map((i) => i.price))) out[`fb.coloring.price.${p}`] = coloringPriceLine(p)
  out['fb.craft.short'] = CRAFT_SHORT_LINE
  out['fb.task.undo'] = TASK_UNDO_LINE
  return out
}
