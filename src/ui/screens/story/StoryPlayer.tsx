import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../../db/db'
import { repo } from '../../../db/repo'
import { playSound } from '../../../learning/audioEngine'
import { forSpecies } from '../../../learning/speciesLines'
import { cancelSpeech, say } from '../../../learning/speech'
import { PAGE_BREATH_MS, pageCapMs, pageLine, pageReadMs, STAR_COLORS, STORIES, type StoryFx, type StoryId, type StoryPage } from '../../../learning/story'
import { speciesEmoji } from '../../../domain/species'
import { Art } from '../../components/Art'
import { useArtStatuses, useFirstArt } from '../../artProbe'
import { useLearningSettings } from '../../learningHooks'
import { useSpecies } from '../../species'
import { companionArt, type Pose } from '../adventure/Companion'
import './story.css'

const artUrl = (art: string): string => `${import.meta.env.BASE_URL}art/${art}.jpg`
const reducedMotion = (): boolean => {
  try {
    return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** 換頁後等交叉淡入走一半才開口，畫面先到、聲音再來 */
const VOICE_DELAY_MS = 500
/** 新的一頁至少停這麼久才接受「點一下翻頁」：孩子連點不會一口氣翻完 */
const TAP_GUARD_MS = 450
/** 圖太慢：最多等這麼久就先淡入底色（圖到了再自己出現） */
const ART_WAIT_MS = 1200
/** 上一張背景留到新的一張淡入完才拿掉 */
const LAYER_KEEP_MS = 1100
const LEAVE_MS = 380

/** 語音回報結束的時間短到不可能唸完：當成沒唸（字幕停留時間照算） */
const tooShortToBeVoice = (text: string, elapsed: number): boolean => elapsed < text.length * 100

/**
 * 動態繪本播放器：全螢幕蓋在目前畫面上，依序演 ids 這幾個故事。
 * 背景 Ken Burns + 換頁交叉淡入；孩子的寵物與小星是獨立圖層；媽媽聲唸完自動翻頁，點畫面提前，右上小「跳過」。
 * 語音失敗或沒回報結束一定有上限時間（pageCapMs），不會卡住。
 * 演完或跳過就記到 settings.storySeen，呼叫 onClose。
 */
export function StoryPlayer({ ids, onClose }: { ids: readonly StoryId[]; onClose: () => void }) {
  const species = useSpecies()
  const { voiceOn } = useLearningSettings()
  const pages = useMemo(() => ids.flatMap((id) => STORIES[id]), [ids])
  const [i, setI] = useState(0)
  const [paused, setPaused] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const page = pages[i]
  const next = pages[i + 1] as StoryPage | undefined

  const voiceOnRef = useRef(voiceOn)
  voiceOnRef.current = voiceOn
  const iRef = useRef(0)
  const leavingRef = useRef(false)
  const flippedAt = useRef(0)
  const leaveTimer = useRef<number | undefined>(undefined)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const finish = useCallback(() => {
    if (leavingRef.current) return
    leavingRef.current = true
    cancelSpeech()
    setLeaving(true)
    leaveTimer.current = window.setTimeout(() => onCloseRef.current(), reducedMotion() ? 0 : LEAVE_MS)
  }, [])

  const advance = useCallback(() => {
    if (leavingRef.current) return
    const cur = pages[iRef.current]
    const nxt = pages[iRef.current + 1] as StoryPage | undefined
    if (!nxt || nxt.story !== cur.story) void repo.markStoriesSeen([cur.story])
    if (!nxt) {
      finish()
      return
    }
    iRef.current += 1
    flippedAt.current = performance.now()
    playSound('page')
    setI(iRef.current)
  }, [pages, finish])

  const skip = () => {
    void repo.markStoriesSeen(ids)
    finish()
  }

  const onTap = () => {
    if (performance.now() - flippedAt.current < TAP_GUARD_MS) return
    advance()
  }

  // 這一頁的旁白與自動翻頁（切到背景時停住，回來重唸這一頁）
  useEffect(() => {
    if (paused) return
    const cur = pages[i]
    const line = forSpecies(pageLine(cur), species)
    const timers: number[] = []
    let done = false
    const later = (fn: () => void, ms: number) => timers.push(window.setTimeout(fn, ms))
    const flip = () => {
      if (done) return
      done = true
      advance()
    }
    later(() => {
      const t0 = performance.now()
      const started = say(line.key, line.text, {
        enabled: voiceOnRef.current,
        onEnd: () => {
          if (done) return
          const elapsed = performance.now() - t0
          // 語音一開始就失敗（錯誤事件）也算 onEnd：字幕還是要留夠時間給大人唸
          if (tooShortToBeVoice(line.text, elapsed)) later(flip, Math.max(0, pageReadMs(line.text) - elapsed))
          else later(flip, PAGE_BREATH_MS)
        },
      })
      // 開始唸了但一直沒回報結束（iOS 偶爾這樣）也不能卡住；沒有語音就照閱讀時間走
      later(flip, started ? pageCapMs(line.text) : pageReadMs(line.text))
    }, VOICE_DELAY_MS)
    return () => {
      done = true
      timers.forEach((t) => window.clearTimeout(t))
    }
  }, [i, paused, pages, species, advance])

  useEffect(() => {
    const onVis = () => {
      if (document.hidden) cancelSpeech()
      setPaused(document.hidden)
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  useEffect(() => {
    flippedAt.current = performance.now()
    return () => {
      window.clearTimeout(leaveTimer.current)
      cancelSpeech()
    }
  }, [])

  // 只預載下一頁的背景
  const nextArt = next?.art
  useEffect(() => {
    if (!nextArt) return
    const im = new Image()
    im.src = artUrl(nextArt)
  }, [nextArt])

  const line = forSpecies(pageLine(page), species)
  const moving = page.move !== undefined

  return (
    <div
      className={`sb ${leaving ? 'leaving' : ''}`}
      data-testid="story"
      data-story={page.story}
      data-page={line.key}
      data-look={page.look}
      role="dialog"
      aria-label="小星的故事"
      style={{ ['--glow' as string]: page.glow, ['--focus' as string]: `${page.focus}%` } as CSSProperties}
      onClick={onTap}
    >
      <Backdrop page={page} />
      <Fx kind={page.fx} />
      <div className="sb-front">
        <div className="sb-cast" data-testid="story-cast" data-alone={page.pose ? undefined : 'true'}>
          {page.pose && <StoryPet pose={page.pose} nextPose={next?.pose ?? null} />}
          <div className={`sb-star-pos ${page.pose ? '' : 'alone'} ${moving ? `move-${page.move}` : ''}`} key={moving ? line.key : 'still'} data-testid="story-star" data-look={page.look} data-move={page.move}>
            <div className="sb-star-float">
              <span className="sb-halo" data-look={page.look} />
              {page.look === 'five' && (
                <span className="sb-orbit" aria-hidden>
                  {STAR_COLORS.map((c, k) => (
                    <i key={c} style={{ ['--a' as string]: `${k * 72}deg`, background: `radial-gradient(circle, #fff 0%, ${c} 45%, transparent 72%)` }} />
                  ))}
                </span>
              )}
              <Art key={page.look} name="ui-xiaoxing" alt="小星" className={`sb-star-img look-${page.look}`} />
            </div>
          </div>
        </div>
        <p className="sb-caption" key={line.key} data-testid="story-caption" aria-live="polite">
          {line.text}
        </p>
      </div>
      <button
        type="button"
        className="sb-skip"
        data-testid="story-skip"
        onClick={(e) => {
          e.stopPropagation()
          skip()
        }}
      >
        跳過
      </button>
    </div>
  )
}

interface Layer {
  id: number
  page: StoryPage
}

/** 背景層：新的一張淡入蓋在舊的上面（舊的繼續慢推，不會停格），淡入完才拿掉舊的 */
function Backdrop({ page }: { page: StoryPage }) {
  // 同一個 state 同時記「畫到哪一頁」和圖層：render 當下衍生，新的一頁和新圖層在同一次 commit 出現
  const [state, setState] = useState<{ page: StoryPage; layers: Layer[] }>({ page, layers: [{ id: 0, page }] })
  let layers = state.layers
  if (state.page !== page) {
    layers = [...layers.slice(-1), { id: layers[layers.length - 1].id + 1, page }]
    setState({ page, layers })
  }
  const newest = layers[layers.length - 1].id
  const dropOlder = useCallback((id: number) => setState((s) => (s.layers.some((l) => l.id < id) ? { ...s, layers: s.layers.filter((l) => l.id >= id) } : s)), [])
  return (
    <div className="sb-bgs" aria-hidden>
      {layers.map((l) => (
        <BackdropLayer key={l.id} layer={l} top={l.id === newest} onShown={dropOlder} />
      ))}
      <div className="sb-vignette" />
    </div>
  )
}

function BackdropLayer({ layer, top, onShown }: { layer: Layer; top: boolean; onShown: (id: number) => void }) {
  const { page, id } = layer
  const [ready, setReady] = useState(false)
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    if (ready) return
    const t = window.setTimeout(() => setReady(true), ART_WAIT_MS)
    return () => window.clearTimeout(t)
  }, [ready])
  useEffect(() => {
    if (!ready || !top) return
    const t = window.setTimeout(() => onShown(id), reducedMotion() ? 0 : LAYER_KEEP_MS)
    return () => window.clearTimeout(t)
  }, [ready, top, id, onShown])
  const style: CSSProperties = { background: `linear-gradient(180deg, ${page.tint[0]}, ${page.tint[1]})`, ['--focus' as string]: `${page.focus}%` }
  const kb = (STORY_KB_SEED(page) % 4) + 1
  return (
    <div className="sb-layer" data-ready={ready ? 'true' : undefined} data-art={page.art} data-missing={missing ? 'true' : undefined} style={style}>
      {!missing && (
        <div className={`sb-kb kb-${kb}`}>
          <img
            className="sb-art"
            src={artUrl(page.art)}
            alt=""
            draggable={false}
            onLoad={() => setReady(true)}
            onError={() => {
              setMissing(true)
              setReady(true)
            }}
          />
          <img className="sb-art sb-mirror" src={artUrl(page.art)} alt="" draggable={false} />
        </div>
      )}
    </div>
  )
}

/** Ken Burns 的方向：固定、每頁輪替（不用亂數） */
const STORY_KB_SEED = (p: StoryPage): number => [...p.art].reduce((n, c) => n + c.charCodeAt(0), 0)

/** 孩子自己的寵物（物種與階段都是他的）。不能點（整個畫面點了是翻頁） */
function StoryPet({ pose, nextPose }: { pose: Pose; nextPose: Pose | null }) {
  const pet = useLiveQuery(() => db.pets.get('pet'), [])
  const stage = pet?.stage ?? 'adult'
  const feed = pet?.feedCount ?? 0
  const chosen = useFirstArt(companionArt(stage, pose, feed, pet?.species))
  // 順便探測下一頁的姿勢，換頁時不閃
  useArtStatuses(nextPose ? companionArt(stage, nextPose, feed, pet?.species) : [])
  if (!pet) return <div className="sb-pet" />
  return (
    <div className={`sb-pet pose-${pose}`} key={`${pose}`} data-testid="story-pet" data-species={pet.species ?? 'monkey'} data-art={chosen ?? ''} data-pose={pose}>
      <div className="sb-pet-bob">
        {chosen ? (
          <Art key={chosen} name={chosen} alt={pet.name} className="sb-pet-img" />
        ) : (
          <span className="sb-pet-img sb-pet-emoji" role="img" aria-label={pet.name}>
            {pet.stage === 'egg' ? '🥚' : speciesEmoji(pet.species)}
          </span>
        )}
      </div>
    </div>
  )
}

const FX_COUNT: Record<StoryFx, number> = { stars: 16, motes: 12, petals: 12, drops: 9, sparkle: 12, fireflies: 10, confetti: 18 }

/** 環境動態：一小把 <i>，只動 transform / opacity。位置與節奏固定（不用亂數）；同一種動態換頁時不重來 */
const Fx = memo(function Fx({ kind }: { kind: StoryFx }) {
  const n = FX_COUNT[kind]
  return (
    <div className={`sb-fx fx-${kind}`} key={kind} data-testid="story-fx" data-fx={kind} aria-hidden>
      {Array.from({ length: n }, (_, k) => (
        <i
          key={k}
          style={{
            left: `${((k * 37 + 11) % 97) + 1}%`,
            top: `${((k * 53 + 7) % 62) + 3}%`,
            animationDelay: `${-((k * 1.7) % 9).toFixed(2)}s`,
            animationDuration: `${6 + (k * 3) % 7}s`,
            ['--c' as string]: kind === 'confetti' ? STAR_COLORS[k % STAR_COLORS.length] : undefined,
            ['--s' as string]: 0.7 + ((k * 5) % 7) / 10,
          }}
        />
      ))}
    </div>
  )
})
