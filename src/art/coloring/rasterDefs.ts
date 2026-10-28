/**
 * 點陣線稿著色頁（v7）的名單。純資料，不 import 專案其他模組（constants 也會用到）。
 * 線稿由 design/tools/prep_lineart.py 產生，並寫入 lineart-manifest.json；
 * 名單裡有、但 manifest 沒有（素材還沒生成）的頁面不會出現在著色本與商店，補齊素材重跑 prep 就生效。
 */
import manifest from './lineart-manifest.json'

export type RasterTier = 'easy' | 'hard'
export interface RasterDef {
  id: string
  name: string
  tier: RasterTier
}

/** 順序同 design/tools/lineart.txt：先 8 張簡單版，再 8 張挑戰版 */
export const RASTER_DEFS: readonly RasterDef[] = [
  { id: 'line-awu-banana', name: '阿悟抱香蕉', tier: 'easy' },
  { id: 'line-awu-bath', name: '阿悟洗澡', tier: 'easy' },
  { id: 'line-dino', name: '小恐龍', tier: 'easy' },
  { id: 'line-birthday-cake', name: '生日蛋糕', tier: 'easy' },
  { id: 'line-rocket', name: '小火箭', tier: 'easy' },
  { id: 'line-ice-cream', name: '冰淇淋', tier: 'easy' },
  { id: 'line-whale', name: '小鯨魚', tier: 'easy' },
  { id: 'line-train', name: '小火車', tier: 'easy' },
  { id: 'line-awu-garden', name: '阿悟的花園', tier: 'hard' },
  { id: 'line-awu-space', name: '阿悟在月球', tier: 'hard' },
  { id: 'line-awu-ocean', name: '海底大冒險', tier: 'hard' },
  { id: 'line-wukong-dragon', name: '悟空與小龍', tier: 'hard' },
  { id: 'line-castle', name: '童話城堡', tier: 'hard' },
  { id: 'line-farm', name: '開心農場', tier: 'hard' },
  { id: 'line-mandala-flower', name: '花朵曼陀羅', tier: 'hard' },
  { id: 'line-city-street', name: '小城街道', tier: 'hard' },
]

const have = new Set<string>((manifest as { ids: string[] }).ids)
/** 素材已經備妥、可以玩的點陣頁 */
export const AVAILABLE_RASTER: readonly RasterDef[] = RASTER_DEFS.filter((d) => have.has(d.id))

/** 點陣頁售價（星星）：簡單 30、挑戰 50 */
export const RASTER_PRICE: Record<RasterTier, number> = { easy: 30, hard: 50 }

export const rasterSrc = (id: string) => `art/coloring/${id}.png`
