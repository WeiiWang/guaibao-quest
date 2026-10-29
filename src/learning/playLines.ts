/**
 * v7.4 線 K：「朋友來作客」與「阿悟的小願望」會唸出來的句子。
 * 名字是動態的（每個朋友一句），所以不放在 lines.ts 的固定清單；這裡把所有可能的句子列出來給 export-speech-lines 預錄，
 * 畫面用 sayText(原文) 或 say(key, 原文) 依文字找音檔（句型一律用 domain/play74.ts 的函式產生，呼叫端與清單完全一致）。
 *
 * key：
 *   play.guest.arrive.<朋友id>   今天 XX 來玩囉！
 *   play.guest.page.<朋友id>     XX 送你一張新的畫！（禮物是著色頁或連連看）
 *   play.guest.food.<朋友id>     XX 送你好吃的！（畫都有了，改送食物）
 *   play.guest.name.<朋友id>     點朋友唸名字（英文名字沿用 en.<word>）
 *   pet.wish.<願望id>            阿悟說的願望（阿悟聲）
 *   pet.wish.done.<願望id>       願望實現後阿悟說的話（阿悟聲）
 *   play.wish.card.<願望id>      回憶卡上的一句話（旁白聲）
 */
import { FRIENDS } from '../domain/friends'
import { canVisit, guestArriveLine, guestFoodLine, guestPageLine, WISHES } from '../domain/play74'

export const guestKey = (kind: 'arrive' | 'page' | 'food' | 'name', id: string): string => `play.guest.${kind}.${id}`
export const wishKey = (id: string): string => `pet.wish.${id}`
export const wishDoneKey = (id: string): string => `pet.wish.done.${id}`
export const wishCardKey = (id: string): string => `play.wish.card.${id}`

export function playLines(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of FRIENDS) {
    if (!canVisit(f.id)) continue
    out[guestKey('arrive', f.id)] = guestArriveLine(f.name)
    out[guestKey('page', f.id)] = guestPageLine(f.name)
    out[guestKey('food', f.id)] = guestFoodLine(f.name)
    out[guestKey('name', f.id)] = f.name
  }
  for (const w of WISHES) {
    out[wishKey(w.id)] = w.line
    out[wishDoneKey(w.id)] = w.doneLine
    out[wishCardKey(w.id)] = w.caption
  }
  return out
}
