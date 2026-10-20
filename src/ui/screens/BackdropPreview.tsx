import { RoomAmbient, RoomBackdrop, type TimeOfDay } from '../components/RoomBackdrop'
import { Art } from '../components/Art'
import './backdropPreview.css'

export const parseBackdropHash = (h: string): { tod: TimeOfDay; wall: string; floor: string; scroll: number } | null => {
  const m = /^#?\/?backdrop(?:\/([a-z]+))?(?:\/([a-z-]+))?(?:\/([a-z-]+))?(?:\/(\d+))?$/.exec(h)
  if (!m) return null
  const tod = (['day', 'dusk', 'night'] as const).find((t) => t === m[1]) ?? 'day'
  return { tod, wall: m[2] ?? 'wall-cream', floor: m[3] ?? 'floor-wood', scroll: Number(m[4] ?? 20) }
}

/**
 * 房間背景預覽（網址 #backdrop/<day|dusk|night>/<壁紙id>/<地板id>/<水平位置%>）。
 * 給美術檢視與截圖用；正式畫面的房間由 RoomView 使用 RoomBackdrop。
 */
export function BackdropPreview({ tod, wall, floor, scroll }: { tod: TimeOfDay; wall: string; floor: string; scroll: number }) {
  const glows = [{ x: 0.405, y: 0.58 }]
  return (
    <main className="bp" data-testid="backdrop-preview">
      <div className="bp-room" style={{ transform: `translateX(-${scroll}vw)` }}>
        <RoomBackdrop timeOfDay={tod} theme={{ wall, floor }} glows={glows} />
        <Art name="decor-rug" className="bp-item" style={{ left: '30%', top: '76%', width: '16%', height: '18%' }} />
        <Art name="decor-lamp" className="bp-item" style={{ left: '37%', top: '36%', width: '6%', height: '44%' }} />
        <Art name="decor-bed" className="bp-item" style={{ left: '50%', top: '58%', width: '14%', height: '34%' }} />
        <Art name="pet-adult-idle" className="bp-item" style={{ left: '28%', top: '50%', width: '9%', height: '42%' }} />
        <RoomAmbient timeOfDay={tod} />
      </div>
    </main>
  )
}
