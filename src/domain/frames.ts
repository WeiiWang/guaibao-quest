/**
 * 畫框收藏（v7.1 D2）：畫完一幅就累計一次，固定門檻解鎖畫框。
 * 不用機率、不給星星（避免影響經濟、也不做成癮設計）：1、3、6、10、15 幅各解鎖一種，看得到下一個目標。
 */
export type FrameId = 'wood' | 'silver' | 'gold' | 'rainbow' | 'star'

export interface FrameDef {
  id: FrameId
  name: string
  /** 累計完成幾幅就解鎖 */
  need: number
}

export const FRAMES: readonly FrameDef[] = [
  { id: 'wood', name: '木框', need: 1 },
  { id: 'silver', name: '銀框', need: 3 },
  { id: 'gold', name: '金框', need: 6 },
  { id: 'rainbow', name: '彩虹框', need: 10 },
  { id: 'star', name: '星星框', need: 15 },
]

/** 著色頁完成度達這個百分比才算「完成一幅」（空白畫紙不看完成度）；低於它按完成會先問「再畫一點好嗎？」 */
export const COUNT_MIN_PCT = 60

export const isFrameId = (v: unknown): v is FrameId => FRAMES.some((f) => f.id === v)
export const frameDef = (id: string | undefined): FrameDef | undefined => FRAMES.find((f) => f.id === id)
const cnt = (n: number | undefined): number => Math.max(0, Math.trunc(n ?? 0) || 0)

/** 這一次按完成算不算「完成一幅」：空白畫紙有內容就算；著色頁要達到 60% */
export const countsAsFinished = (free: boolean, pct: number): boolean => free || pct >= COUNT_MIN_PCT

/** 累計 count 幅時，已解鎖的畫框（依門檻排序） */
export const unlockedFrames = (count: number | undefined): FrameDef[] => FRAMES.filter((f) => cnt(count) >= f.need)
export const isFrameUnlocked = (id: string | undefined, count: number | undefined): boolean => {
  const f = frameDef(id)
  return !!f && cnt(count) >= f.need
}
/** 從 prev 幅到 next 幅，新解鎖的畫框 */
export const newlyUnlocked = (prev: number | undefined, next: number | undefined): FrameDef[] => FRAMES.filter((f) => cnt(prev) < f.need && cnt(next) >= f.need)
/** 下一個要解鎖的畫框；全部解鎖了回 undefined */
export const nextFrame = (count: number | undefined): FrameDef | undefined => FRAMES.find((f) => cnt(count) < f.need)
/** 還差幾幅解鎖這個畫框（已解鎖 = 0） */
export const framesToGo = (id: string | undefined, count: number | undefined): number => Math.max(0, (frameDef(id)?.need ?? 0) - cnt(count))
/** 目前最高級的畫框（沒有就是 undefined） */
export const bestFrame = (count: number | undefined): FrameDef | undefined => unlockedFrames(count).at(-1)

// ---------- 新句子（會唸出來；src/learning/lines.ts 有同一份，frames.test.ts 會檢查兩邊一字不差） ----------
export const FRAME_LINES: Record<string, string | string[]> = {
  'ui.frame.unlock': '解鎖新畫框！',
  'ui.frame.locked': '再多畫幾幅，這個畫框就是你的了',
  'ui.frame.pick': '幫這幅畫選一個畫框',
}
export const FRAME_UNLOCK_LINE = FRAME_LINES['ui.frame.unlock'] as string
export const FRAME_LOCKED_LINE = FRAME_LINES['ui.frame.locked'] as string
export const FRAME_PICK_LINE = FRAME_LINES['ui.frame.pick'] as string
