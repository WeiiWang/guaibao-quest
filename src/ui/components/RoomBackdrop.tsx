import './roomBackdrop.css'
import { useArtStatus } from '../artProbe'
import { fixtureLayout, type FestivalSpot, type FixtureId, type RoomFixture } from '../../domain/roomFixtures'
export type TimeOfDay = 'day' | 'dusk' | 'night'

export interface RoomTheme {
  /** 壁紙主題 id（例：'wall-cream'）；不給就用預設。可用 id 見 src/domain/theme.ts */
  wall?: string
  /** 地板主題 id（例：'floor-wood'）；不給就用預設 */
  floor?: string
}

/** 夜晚會發光的燈（decor-lamp / decor-cloudlamp）：中心點，佔房間寬 / 高的比例 */
export interface RoomGlow {
  x: number
  y: number
}

interface Props {
  timeOfDay: TimeOfDay
  theme?: RoomTheme
  /** 夜晚燈光：每盞燈一圈暖色光暈（畫在家具下面）；非夜晚時不顯示 */
  glows?: RoomGlow[]
  /** v8.1：要讓位的內建陳設（玩家擺了同類家具） */
  hideFixtures?: readonly FixtureId[]
  /** v8.1：現在的節慶掛飾（沒給 = 沒有節慶） */
  festival?: RoomFestival | null
  /** v8.1：房間的寬 / 高（陳設依這個排版）；不給當 iPad 橫向 */
  roomAspect?: number
}

/** 節慶掛飾：art = public/art 圖名；enter = 這次是第一次看到，從天花板掉下來晃一晃 */
export interface RoomFestival {
  art: string
  enter?: boolean
}

const WINDOWS = ['22%', '70%']

/** 灰塵光點：固定位置與節奏（不用亂數，畫面穩定） */
/** v8 線 O：最多 10 顆（以前 18 顆）；位置集中在兩扇窗的光柱附近，看起來像光裡的灰塵，不是滿屋子亂飄 */
const DUST = Array.from({ length: 10 }, (_, i) => {
  const win = i % 2 === 0 ? 22 : 70
  return {
    left: `${win + ((i * 37 + 5) % 21) - 4}%`,
    top: `${34 + ((i * 53) % 44)}%`,
    size: 3 + (i % 3),
    dur: 14 + (i % 5) * 4,
    delay: -((i * 7) % 20),
  }
})

function WindowScene({ tod }: { tod: TimeOfDay }) {
  return (
    <div className="rb-scene" data-scene={tod}>
      <div className="rb-sky" />
      {tod === 'night' && (
        <>
          <div className="rb-stars rb-stars-a" />
          <div className="rb-stars rb-stars-b" />
          <div className="rb-stars rb-stars-c" />
          <div className="rb-moon" />
        </>
      )}
      {tod === 'dusk' && <div className="rb-sun" />}
      {tod === 'day' && <div className="rb-daysun" />}
      {tod === 'day' && (
        <svg className="rb-bird" viewBox="0 0 24 12" aria-hidden>
          <path d="M1 8 Q6 0 12 7 Q18 0 23 8 Q18 5 12 10 Q6 5 1 8 Z" />
        </svg>
      )}
      {tod !== 'night' && (
        <>
          <i className="rb-cloud c1" />
          <i className="rb-cloud c2" />
          {tod === 'day' && <i className="rb-cloud c3" />}
        </>
      )}
      <svg className="rb-hills" viewBox="0 0 120 100" preserveAspectRatio="none" aria-hidden>
        <path className="hill-far" d="M0 70 Q22 48 46 64 T92 58 T120 66 V100 H0 Z" />
        <path className="hill-near" d="M0 84 Q30 62 62 80 T120 76 V100 H0 Z" />
        <rect className="tree-trunk" x="86" y="66" width="3" height="14" rx="1.2" />
        <ellipse className="tree-crown" cx="87.5" cy="60" rx="9" ry="11" />
        <rect className="tree-trunk" x="20" y="74" width="2.4" height="10" rx="1" />
        <ellipse className="tree-crown" cx="21.2" cy="70" rx="6.5" ry="8" />
      </svg>
    </div>
  )
}

const artUrl = (name: string) => `${import.meta.env.BASE_URL}art/${name}.png`

/** 內建陳設一件：圖還沒有就什麼都不畫（不破版）；地上的東西有接觸陰影，牆上的有貼牆的柔影 */
function Fixture({ f }: { f: RoomFixture }) {
  const ok = useArtStatus(f.art) === 'ok'
  if (!ok) return null
  return (
    <div
      className={`rb-fixture rb-fixture-${f.id}`}
      data-testid={`room-fixture-${f.id}`}
      style={{ left: `${f.x * 100}%`, bottom: `${(1 - f.bottom) * 100}%`, height: `${f.h * 100}cqh`, aspectRatio: `${f.aspect}` }}
    >
      {f.slot === 'floor' && f.id !== 'mat' && <i className="rb-contact" />}
      <img src={artUrl(f.art)} alt="" draggable={false} />
    </div>
  )
}

/** 節慶掛飾：圖還沒有就不顯示。掛在牆上半部、寵物頭上的那面牆 */
function FestivalHanging({ festival, spot }: { festival: RoomFestival; spot: FestivalSpot }) {
  const ok = useArtStatus(festival.art) === 'ok'
  if (!ok) return null
  return (
    <div
      className={`rb-fest ${festival.enter ? 'enter' : ''}`}
      data-testid="room-festival"
      data-art={festival.art}
      style={{ left: `${spot.x * 100}%`, top: `${spot.top * 100}%`, width: `min(${spot.wOfH * 100}cqh, ${spot.wOfW * 100}cqw)` }}
    >
      <img src={artUrl(festival.art)} alt="" draggable={false} />
    </div>
  )
}

/**
 * 房間背景：牆面（壁紙）、窗戶與窗景、地板、光線與灰塵光點。只負責外觀，不處理互動。
 * 由 RoomView 放在 .room 內最底層；寵物與家具疊在上面。
 * - timeOfDay 決定窗景、整體色調與光斑
 * - theme 決定壁紙與地板（不給用預設）
 * - glows 夜晚燈光（選用）
 */
export function RoomBackdrop({ timeOfDay, theme, glows, hideFixtures, festival, roomAspect = 5.4 }: Props) {
  const wall = theme?.wall ?? 'wall-cream'
  const floor = theme?.floor ?? 'floor-wood'
  const layout = fixtureLayout(roomAspect)
  return (
    <div className={`room-backdrop tod-${timeOfDay} ${wall} ${floor}`} data-tod={timeOfDay} data-wall={wall} data-floor={floor} aria-hidden>
      <div className="rb-wall" />
      <div className="rb-wall-light" />
      <div className="rb-ceiling" />
      <div className="rb-wainscot" />
      {WINDOWS.map((left, i) => (
        <div key={left} className="rb-window-set" style={{ left }}>
          {/* v8：窗口往下的斜光柱（透明度慢慢呼吸）；顏色跟著時段 */}
          <i className="rb-shaft" style={{ animationDelay: `${-i * 4}s` }} />
          <div className="rb-window">
            <WindowScene tod={timeOfDay} />
            <i className="rb-bar" />
          </div>
          <div className="rb-sill" />
          <i className="rb-drape l" />
          <i className="rb-drape r" />
        </div>
      ))}
      <div className="rb-floor" />
      {WINDOWS.map((left) => (
        <div key={left} className="rb-beam" style={{ left }} />
      ))}

      <div className="rb-baseboard" />
      {/* v8.1：內建陳設：在牆面、地板之上，整體色調之下（入夜會一起變暗），在家具與寵物之下 */}
      <div className="rb-fixtures">
        {layout.fixtures.filter((f) => !hideFixtures?.includes(f.id)).map((f) => (
          <Fixture key={f.id} f={f} />
        ))}
      </div>
      <div className="rb-tint" />
      {/* 掛飾掛在窗戶前面（窗戶和窗簾有自己的 z-index，比一般陳設高）；入夜的色調由 RoomAmbient 蓋上，和家具一樣 */}
      {festival && (
        <div className="rb-fixtures rb-fest-layer">
          <FestivalHanging festival={festival} spot={layout.festival} />
        </div>
      )}
      {timeOfDay === 'night' &&
        glows?.map((g, i) => (
          <div key={i} className="rb-glow" style={{ left: `${g.x * 100}%`, top: `${g.y * 100}%` }} />
        ))}
      <div className="rb-dust">
        {DUST.map((d, i) => (
          <i key={i} style={{ left: d.left, top: d.top, width: d.size, height: d.size, animationDuration: `${d.dur}s`, animationDelay: `${d.delay}s` }} />
        ))}
      </div>
    </div>
  )
}

/**
 * 蓋在家具上方的整體色調（傍晚暖色、夜晚偏暗藍）。選用：RoomView 放在物件之上、陰影之下，
 * 讓家具跟寵物也跟著「入夜」。白天不輸出任何東西。
 */
export function RoomAmbient({ timeOfDay }: { timeOfDay: TimeOfDay }) {
  if (timeOfDay === 'day') return null
  return <div className={`room-ambient tod-${timeOfDay}`} aria-hidden />
}
