import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { OBJ_EMOJI } from '../../../art/items'
import { pickLine } from '../../../learning/lines'
import { mustObject } from '../../../learning/objects'
import { playSfx } from '../../../learning/sfx'
import { say } from '../../../learning/speech'
import type { Question } from '../../../learning/types'
import { Icon } from '../../components/Icon'
import { useLearningSettings } from '../../learningHooks'
import type { HintStage } from './QuestionView'
import './adventure-v6.css'

interface Props {
  q: Question
  hintStage: HintStage
  solved: boolean
  voiceOn: boolean
  /** 翻錯太多次：由關卡畫面接手提示階梯 */
  onWrong: () => void
  /** 全部配對完 */
  onSolved: () => void
  /** 教學：阿悟示範翻兩張一樣的，示範完呼叫 onDemoEnd 並蓋回去 */
  demo?: boolean
  onDemoEnd?: () => void
}

/** 翻錯幾次算一次「答錯」：2 對的牌 2 次，其他是對數（最少 2）。翻錯是玩遊戲的一部分，不是答錯，所以門檻放寬 */
export const missLimit = (pairs: number): number => Math.max(2, pairs)
const FLIP_BACK_MS = 900
const MATCH_MS = 450
const PEEK_MS = 1700

/**
 * 記憶翻牌：點一張牌翻開，再翻一張；一樣就留下來，不一樣就蓋回去。全部配對完就答對。
 * 判斷在這裡。翻錯次數到門檻就算一次「答錯」：所有還沒配對的牌先亮一下給孩子看（第一次提示），
 * 再錯一輪，一對一樣的牌會一直發光（第二次提示）。
 */
export function FlipView({ q, hintStage, solved, voiceOn, onWrong, onSolved, demo = false, onDemoEnd }: Props) {
  const faces = q.items.map((it) => it.obj as string)
  const cols = q.params?.cols ?? 2
  const pairs = faces.length / 2
  const { soundOn } = useLearningSettings()
  // 已配對的牌、目前翻開的牌（最多兩張）
  const [matched, setMatched] = useState<ReadonlySet<number>>(new Set())
  const [open, setOpen] = useState<number[]>([])
  const [peek, setPeek] = useState(false)
  const [demoOpen, setDemoOpen] = useState<number[]>([])
  const misses = useRef(0)
  const missedOnce = useRef(false)
  const locked = useRef(false)
  const timers = useRef<number[]>([])
  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms)
    timers.current.push(id)
  }
  useEffect(() => {
    const t = timers.current
    return () => t.forEach((id) => window.clearTimeout(id))
  }, [])

  const flip = (i: number) => {
    if (solved || demo || locked.current || matched.has(i) || open.includes(i) || peek) return
    playSfx('tap', soundOn)
    const next = [...open, i]
    setOpen(next)
    if (next.length < 2) return
    locked.current = true
    const [a, b] = next
    if (faces[a] === faces[b]) {
      later(() => {
        const m = new Set(matched).add(a).add(b)
        setMatched(m)
        setOpen([])
        locked.current = false
        if (m.size === faces.length) {
          const l = pickLine('flip.done')
          say(l.key, l.text, { enabled: voiceOn })
          onSolved()
        } else {
          const l = pickLine('flip.match', m.size)
          say(l.key, l.text, { enabled: voiceOn })
        }
      }, MATCH_MS)
      return
    }
    misses.current += 1
    // 第一次翻錯說一句（之後安靜，免得一直唸）；翻錯到門檻時由關卡畫面唸提示
    if (!missedOnce.current && misses.current < missLimit(pairs)) {
      missedOnce.current = true
      const l = pickLine('flip.miss')
      say(l.key, l.text, { enabled: voiceOn })
    }
    later(() => {
      setOpen([])
      if (misses.current >= missLimit(pairs)) {
        // 翻錯太多次：這算一次答錯，先把沒配對的牌亮一下
        misses.current = 0
        setPeek(true)
        onWrong()
        later(() => {
          setPeek(false)
          locked.current = false
        }, PEEK_MS)
      } else {
        locked.current = false
      }
    }, FLIP_BACK_MS)
  }

  // 教學：阿悟示範翻開兩張一樣的，再蓋回去換孩子試
  useEffect(() => {
    if (!demo) return
    const first = 0
    const mate = faces.findIndex((f, i) => f === faces[first] && i !== first)
    const a = window.setTimeout(() => setDemoOpen([first]), 900)
    const b = window.setTimeout(() => setDemoOpen([first, mate]), 1700)
    const c = window.setTimeout(() => {
      setDemoOpen([])
      onDemoEnd?.()
    }, 3300)
    return () => [a, b, c].forEach((id) => window.clearTimeout(id))
    // 只在進入教學時跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo])

  // 第二次錯起：還沒配對的一對一樣的牌一直發光
  const hintPair = (() => {
    if (!(hintStage >= 2) || solved) return new Set<number>()
    const i = faces.findIndex((_, k) => !matched.has(k))
    if (i < 0) return new Set<number>()
    const j = faces.findIndex((f, k) => f === faces[i] && k !== i)
    return new Set([i, j])
  })()

  return (
    <div className="flp" data-testid="question" data-question-id={q.id} data-hint-stage={hintStage} data-type="flip" data-peek={peek ? 'true' : undefined} style={{ ['--flp-cols' as string]: cols } as CSSProperties}>
      <div className="flp-grid" role="group" aria-label={`${faces.length} 張牌，找出一樣的兩張`}>
        {faces.map((f, i) => {
          const isMatched = matched.has(i)
          const up = isMatched || open.includes(i) || peek || demoOpen.includes(i) || (solved && !isMatched)
          const o = mustObject(f)
          return (
            <button
              key={i}
              type="button"
              className={`flp-card ${up ? 'up' : ''} ${isMatched ? 'matched' : ''} ${hintPair.has(i) && !up ? 'hint' : ''} ${demo && demoOpen.includes(i) ? 'demo' : ''}`}
              data-testid="flip-card"
              data-card={i}
              data-state={isMatched ? 'matched' : up ? 'up' : 'down'}
              aria-label={up ? o.name : `第 ${i + 1} 張牌（蓋著）`}
              aria-pressed={up}
              disabled={solved || demo || isMatched}
              onClick={() => flip(i)}
            >
              <span className="flp-inner">
                <span className="flp-back" aria-hidden>
                  <i>?</i>
                </span>
                <span className="flp-face">
                  <Icon name={f} emoji={OBJ_EMOJI[f]} alt={o.name} />
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
