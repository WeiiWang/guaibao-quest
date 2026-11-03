import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { profiles } from '../../profiles/manager'
import '../shell.css'
import '../title.css'

/** 這一頁的天空色（跟 index.html 的啟動畫面、manifest 的 background_color 同一個藍） */
const TITLE_SKY = '#67b2fd'

/** 飄的雲：位置（%）、寬度（vmin）、速度（秒）、起始延遲（負值 = 一開始就在途中）、透明度 */
const CLOUDS: { top: number; w: number; dur: number; delay: number; o: number }[] = [
  { top: 3, w: 34, dur: 70, delay: -18, o: 0.95 },
  { top: 15, w: 24, dur: 92, delay: -60, o: 0.8 },
  { top: 20, w: 30, dur: 80, delay: -40, o: 0.9 },
  { top: 8, w: 18, dur: 110, delay: -90, o: 0.7 },
]

/** 花瓣：從左到右散開，慢慢飄下來（只動 transform / opacity） */
const PETALS = Array.from({ length: 12 }, (_, i) => ({
  left: (i * 83 + 7) % 100,
  size: 12 + ((i * 5) % 9),
  dur: 9 + ((i * 7) % 8),
  delay: -((i * 13) % 14),
  sway: 30 + ((i * 11) % 50) * (i % 2 ? 1 : -1),
}))

type LogoState = 'wait' | 'img' | 'text'

/** 預先暖機：資料庫與名冊先開好、第一個畫面要用的圖先載（按下開始之後立刻有東西看） */
function warmUp(): void {
  void profiles.bootstrap().catch(() => undefined)
  const base = import.meta.env.BASE_URL
  for (const n of ['pet-egg', 'pet-baby-happy', 'pet-rabbit-baby-happy', 'pet-tiger-baby-happy']) {
    const im = new Image()
    im.src = `${base}art/${n}.png`
  }
}

export function Title({ onStart }: { onStart: () => void }) {
  const started = useRef(false)
  const [art, setArt] = useState<'wait' | 'ok' | 'fail'>('wait')
  const [logo, setLogo] = useState<LogoState>('wait')
  const base = import.meta.env.BASE_URL

  // 狀態列顏色跟著開場的藍天；離開時還原成其他畫面的米色
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    const prev = meta?.content
    if (meta) meta.content = TITLE_SKY
    warmUp()
    // logo 圖超過 1.5 秒還沒到，就先用文字 logo（之後圖到了也不換，避免跳動）
    const t = window.setTimeout(() => setLogo((s) => (s === 'wait' ? 'text' : s)), 1500)
    return () => {
      window.clearTimeout(t)
      if (meta && prev !== undefined) meta.content = prev
    }
  }, [])

  const start = () => {
    if (started.current) return
    started.current = true
    onStart()
  }

  return (
    <main className="title" data-testid="title" data-art={art} data-logo={logo} onClick={start}>
      <div className="title-sky" aria-hidden />
      <img
        className={`title-art ${art === 'ok' ? 'on' : ''}`}
        src={`${base}art/title-keyart.jpg`}
        alt=""
        draggable={false}
        onLoad={() => setArt('ok')}
        onError={() => setArt('fail')}
      />
      <div className="title-clouds" aria-hidden>
        {CLOUDS.map((c, i) => (
          <i
            key={i}
            className="gq-cloud title-cloud"
            style={{ top: `${c.top}%`, width: `${c.w}vmin`, animationDuration: `${c.dur}s`, animationDelay: `${c.delay}s`, opacity: c.o } as CSSProperties}
          />
        ))}
      </div>
      <div className="title-petals" aria-hidden>
        {PETALS.map((p, i) => (
          <i
            key={i}
            className="title-petal"
            style={{ left: `${p.left}%`, width: p.size, height: p.size * 0.78, animationDuration: `${p.dur}s`, animationDelay: `${p.delay}s`, ['--sway' as string]: `${p.sway}px` }}
          />
        ))}
      </div>
      <div className="title-stack">
        <h1 className={`title-logo ${logo === 'wait' ? '' : 'in'}`} aria-label="乖寶任務">
          {logo !== 'text' && (
            <img
              className="title-logo-img"
              src={`${base}art/ui-logo.png`}
              alt=""
              draggable={false}
              hidden={logo !== 'img'}
              onLoad={() => setLogo('img')}
              onError={() => setLogo('text')}
            />
          )}
          {logo === 'text' && (
            <span className="title-wordmark" aria-hidden>
              {['乖', '寶', '任', '務'].map((ch, i) => (
                <b key={ch} style={{ ['--i' as string]: i }}>
                  {ch}
                </b>
              ))}
            </span>
          )}
        </h1>
        <button
          type="button"
          className="title-start"
          data-testid="title-start"
          aria-label="開始"
          onClick={(e) => {
            e.stopPropagation()
            start()
          }}
        >
          <svg className="title-play" viewBox="0 0 64 64" aria-hidden>
            <polygon points="21,13 53,32 21,51" fill="#fff" stroke="#fff" strokeWidth="9" strokeLinejoin="round" />
          </svg>
          <span>開始</span>
        </button>
      </div>
    </main>
  )
}
