import './roomBackdrop.css'
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
}

const WINDOWS = ['22%', '70%']

/** 灰塵光點：固定位置與節奏（不用亂數，畫面穩定） */
const DUST = Array.from({ length: 18 }, (_, i) => ({
  left: `${(i * 37 + 11) % 97}%`,
  top: `${14 + ((i * 53) % 62)}%`,
  size: 3 + (i % 3),
  dur: 14 + (i % 5) * 4,
  delay: -((i * 7) % 20),
}))

function WindowScene({ tod }: { tod: TimeOfDay }) {
  return (
    <div className="rb-scene" data-scene={tod}>
      <div className="rb-sky" />
      {tod === 'night' && (
        <>
          <div className="rb-stars rb-stars-a" />
          <div className="rb-stars rb-stars-b" />
          <div className="rb-moon" />
        </>
      )}
      {tod === 'dusk' && <div className="rb-sun" />}
      {tod === 'day' && <div className="rb-daysun" />}
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

/**
 * 房間背景：牆面（壁紙）、窗戶與窗景、地板、光線與灰塵光點。只負責外觀，不處理互動。
 * 由 RoomView 放在 .room 內最底層；寵物與家具疊在上面。
 * - timeOfDay 決定窗景、整體色調與光斑
 * - theme 決定壁紙與地板（不給用預設）
 * - glows 夜晚燈光（選用）
 */
export function RoomBackdrop({ timeOfDay, theme, glows }: Props) {
  const wall = theme?.wall ?? 'wall-cream'
  const floor = theme?.floor ?? 'floor-wood'
  return (
    <div className={`room-backdrop tod-${timeOfDay} ${wall} ${floor}`} data-tod={timeOfDay} data-wall={wall} data-floor={floor} aria-hidden>
      <div className="rb-wall" />
      <div className="rb-wall-light" />
      <div className="rb-ceiling" />
      <div className="rb-wainscot" />
      {WINDOWS.map((left) => (
        <div key={left} className="rb-window-set" style={{ left }}>
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
      <div className="rb-tint" />
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
