/** 貼紙：用 public/art 的 3D 公仔素材。缺圖時用 emoji 備援。 */
export const STICKERS: { art: string; emoji: string; label: string }[] = [
  { art: 'pet-adult-happy', emoji: '🐵', label: '阿悟' },
  { art: 'pet-adult-cheer', emoji: '🙌', label: '歡呼阿悟' },
  { art: 'pet-baby-happy', emoji: '🐒', label: '小猴' },
  { art: 'obj-banana', emoji: '🍌', label: '香蕉' },
  { art: 'obj-peach', emoji: '🍑', label: '桃子' },
  { art: 'obj-apple', emoji: '🍎', label: '蘋果' },
  { art: 'obj-grape', emoji: '🍇', label: '葡萄' },
  { art: 'obj-fish', emoji: '🐟', label: '小魚' },
  { art: 'obj-chick', emoji: '🐥', label: '小雞' },
  { art: 'obj-rabbit', emoji: '🐰', label: '兔子' },
  { art: 'obj-flower', emoji: '🌸', label: '花' },
  { art: 'obj-shell', emoji: '🐚', label: '貝殼' },
  { art: 'obj-star', emoji: '⭐', label: '星星' },
  { art: 'food-cake', emoji: '🍰', label: '蛋糕' },
  { art: 'decor-rainbow', emoji: '🌈', label: '彩虹' },
  { art: 'decor-rocket', emoji: '🚀', label: '火箭' },
  { art: 'decor-dino', emoji: '🦖', label: '恐龍' },
  { art: 'mat-flower', emoji: '🌼', label: '小花' },
]

export const stickerEmoji = (art: string): string | undefined => STICKERS.find((s) => s.art === art)?.emoji
