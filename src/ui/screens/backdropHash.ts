import type { TimeOfDay } from '../components/RoomBackdrop'

/** 解析房間背景預覽的網址（#backdrop/<day|dusk|night>/<壁紙id>/<地板id>/<水平位置%>）。獨立成檔，主 bundle 才不用載入預覽畫面 */
export const parseBackdropHash = (h: string): { tod: TimeOfDay; wall: string; floor: string; scroll: number } | null => {
  const m = /^#?\/?backdrop(?:\/([a-z]+))?(?:\/([a-z-]+))?(?:\/([a-z-]+))?(?:\/(\d+))?$/.exec(h)
  if (!m) return null
  const tod = (['day', 'dusk', 'night'] as const).find((t) => t === m[1]) ?? 'day'
  return { tod, wall: m[2] ?? 'wall-cream', floor: m[3] ?? 'floor-wood', scroll: Number(m[4] ?? 20) }
}
