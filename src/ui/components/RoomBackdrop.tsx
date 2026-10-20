import './roomBackdrop.css'
export type TimeOfDay = 'day' | 'dusk' | 'night'

export interface RoomTheme {
  /** 壁紙主題 id（例：'wall-cream'）；不給就用預設 */
  wall?: string
  /** 地板主題 id（例：'floor-wood'）；不給就用預設 */
  floor?: string
}

interface Props {
  timeOfDay: TimeOfDay
  theme?: RoomTheme
}

/**
 * 房間背景：牆面、窗戶與窗景、地板、光線。只負責外觀，不處理互動。
 * 由 RoomView 放在 .room 內最底層；寵物與家具疊在上面。
 * （v3 最小版：外觀沿用 v2 樣式，內容擴充由內容 agent 實作）
 */
export function RoomBackdrop({ timeOfDay, theme }: Props) {
  return (
    <div className={`room-backdrop tod-${timeOfDay} ${theme?.wall ?? ''} ${theme?.floor ?? ''}`} aria-hidden>
      <div className="wall-light" />
      <div className="wainscot" />
      {['22%', '70%'].map((left) => (
        <div key={left} className="window-set" style={{ left }}>
          <div className="room-window" />
          <i className="drape l" />
          <i className="drape r" />
        </div>
      ))}
      <div className="floor" />
      <div className="sunbeam" style={{ left: '19%' }} />
      <div className="sunbeam" style={{ left: '67%' }} />
      <div className="baseboard" />
    </div>
  )
}
