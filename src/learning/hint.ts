import type { Question } from './types'

/**
 * 這幾種題型的提示是「動畫 + 逐個唸」（數數、逐個唸序列），由題目畫面自己控制語音；
 * 其他題型的提示就是一句話，由關卡畫面唸 q.hint。
 */
export function hintDriven(q: Pick<Question, 'type'>): boolean {
  return ['count', 'add', 'next', 'missing', 'attr', 'grow', 'seqnum'].includes(q.type)
}

/** 提示時要把「同一類」的選項亮起來的題型 */
export const highlightsSame = (q: Pick<Question, 'type'>): boolean => q.type === 'odd' || q.type === 'dual'
