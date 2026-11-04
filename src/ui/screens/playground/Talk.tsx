import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { db } from '../../../db/db'
import { STATIC_LINES } from '../../../learning/lines'
import { learningSettingsOf } from '../../../learning/playtime'
import { sayRecorded } from '../../../learning/speech'
import { talkRate } from '../../../domain/talk'
import { Icon } from '../../components/Icon'
import { placeVoiceOn } from '../../feelFlags'
import { Companion, type Pose } from '../adventure/Companion'
import { GameShell } from './GameShell'
import type { GameRootProps } from './GameScreen'
import { TalkEngine, type TalkBlock, type TalkPhase } from './talkEngine'
import './talk.css'

/** 一句台詞最多等這麼久（播放事件在 iOS 上偶爾不會來，不能卡在這裡） */
const LINE_MAX_MS = 7000
/** 開場台詞在畫面出現後多久說（跟其他玩法一樣） */
const INTRO_DELAY_MS = 500
/** 嘴巴一開一合的節奏 */
const MOUTH_MS = 150

type Phase = 'intro' | TalkPhase
type Block = TalkBlock | 'off'

const BLOCK_NOTE: Record<Block, string> = {
  denied: '給家長：這個玩法要用麥克風。請到家長區或裝置的系統設定，允許這個網站使用麥克風。',
  unsupported: '給家長：這台裝置或瀏覽器沒辦法錄音，所以沒辦法玩學我說話。',
  off: '給家長：學我說話還沒打開，可以到家長區的設定打開。',
}

const POSE: Record<Phase, Pose> = { intro: 'happy', asking: 'think', listening: 'think', hearing: 'happy', thinking: 'happy', playing: 'happy', speaking: 'happy', blocked: 'shy' }

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

function TalkPlay() {
  const [phase, setPhase] = useState<Phase>('intro')
  const [block, setBlock] = useState<Block | null>(null)
  const [rounds, setRounds] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    let engine: TalkEngine | null = null
    const timers = new Set<number>()
    const wait = (ms: number) =>
      new Promise<void>((res) => {
        const id = window.setTimeout(() => {
          timers.delete(id)
          res()
        }, ms)
        timers.add(id)
      })
    // 嘴巴跟著播出去的聲音動：有聲音才開合，音量變化用音波表現。寫 DOM 不重畫
    let mouthAt = 0
    let mouthOpen = false
    const setMouth = (open: boolean) => {
      if (open === mouthOpen) return
      mouthOpen = open
      rootRef.current?.classList.toggle('mouth-open', open)
    }

    void (async () => {
      const [settings, pet] = await Promise.all([db.settings.get('main'), db.pets.get('pet')])
      if (!alive) return
      // 家長沒開就絕對不碰麥克風（網址列直接進來也一樣）
      if (!settings?.talkOn) {
        setBlock('off')
        setPhase('blocked')
        return
      }
      const voiceOn = learningSettingsOf(settings).voiceOn && placeVoiceOn()
      const speak = async (key: string) => {
        const line = STATIC_LINES[key]
        if (!voiceOn || typeof line !== 'string') return
        let done = () => {}
        const ended = new Promise<void>((res) => {
          done = res
        })
        // 只播預錄；沒錄就安靜，不用等
        if (!sayRecorded('pet.', line, { enabled: true, onEnd: () => done() })) return
        await Promise.race([ended, wait(LINE_MAX_MS)])
      }
      await wait(INTRO_DELAY_MS)
      if (!alive) return
      // 說完才開始聽，不然會錄到自己
      await speak('pet.play.talk.intro')
      if (!alive) return
      engine = new TalkEngine({
        rate: talkRate(pet?.species),
        speak,
        onPhase: (p, b) => {
          if (!alive) return
          if (p !== 'playing') setMouth(false)
          if (b) setBlock(b)
          setPhase(p)
        },
        onLevel: (level) => {
          const root = rootRef.current
          if (!root) return
          root.style.setProperty('--lvl', level.toFixed(3))
          if (root.dataset.phase !== 'playing') return
          if (reducedMotion()) return setMouth(true)
          const now = performance.now()
          if (level < 0.12) setMouth(false)
          else if (now - mouthAt >= MOUTH_MS) {
            mouthAt = now
            setMouth(!mouthOpen)
          }
        },
        onRound: (n) => {
          if (alive) setRounds(n)
        },
      })
      engine.start()
    })()

    return () => {
      alive = false
      engine?.dispose()
      for (const id of timers) window.clearTimeout(id)
      timers.clear()
    }
  }, [])

  const blocked = phase === 'blocked'
  const listening = phase === 'listening' || phase === 'hearing'
  return (
    <div ref={rootRef} className="pg-talk" data-testid="talk" data-phase={phase} data-rounds={rounds} data-block={block ?? undefined}>
      <div className="pg-talk-stage">
        <div className={`pg-talk-wave ${listening ? 'on' : ''}`} data-testid="talk-wave" aria-hidden>
          {[0.5, 0.8, 1, 0.7, 0.9, 0.6, 0.4].map((f, i) => (
            <i key={i} style={{ '--f': f } as CSSProperties} />
          ))}
        </div>
        <div className="pg-talk-pet">
          <div className="pg-talk-pose closed">
            <Companion pose={POSE[phase]} size="100%" />
          </div>
          {/* 張嘴的那張一直掛著（只切透明度）：交替時才不會等圖載入、閃一下 */}
          <div className="pg-talk-pose open" aria-hidden>
            <Companion pose="sing" size="100%" />
          </div>
        </div>
      </div>
      {blocked && block && (
        <div className="pg-talk-blocked" data-testid="talk-blocked">
          <div className="pg-talk-mic">
            <Icon name="ui-game-talk" emoji="🎤" size="100%" alt="" />
          </div>
          <p className="pg-talk-note" data-testid="talk-note">
            {BLOCK_NOTE[block]}
          </p>
        </div>
      )}
    </div>
  )
}

export default function Talk({ onExit }: GameRootProps) {
  // 開場台詞由玩法自己說（要等它說完才能開麥克風），殼不用再說一次
  return (
    <GameShell id="talk" scene="scene-play-music" intro="" onExit={onExit}>
      {() => <TalkPlay />}
    </GameShell>
  )
}
