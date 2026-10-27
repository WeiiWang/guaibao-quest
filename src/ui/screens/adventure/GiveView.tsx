import { useEffect, useRef, useState } from 'react'
import { mustObject } from '../../../learning/objects'
import { numberKey, pickLine } from '../../../learning/lines'
import { chineseNumber, say } from '../../../learning/speech'
import type { Question } from '../../../learning/types'
import { OBJ_EMOJI } from '../../../art/items'
import { Icon } from '../../components/Icon'
import type { HintStage } from './QuestionView'
import './adventure-v4.css'

interface Props {
  q: Question
  hintStage: HintStage
  solved: boolean
  voiceOn: boolean
  /** 答錯（按「好了」時數量不對）：由關卡畫面接手提示階梯 */
  onWrong: () => void
  /** 數量剛好：答對 */
  onSolved: () => void
}

/**
 * 拿給我 N 個：桌上有一堆東西，點一下放進籃子，拿到剛好就按「好了」。
 * 判斷對錯在這裡（數量 = n），再回報 onWrong / onSolved，關卡畫面照舊套用提示階梯與計分。
 * 點籃子裡的東西可以放回去。第一次答錯後出現 n 個格子（一對一），第二次答錯阿悟示範拿 n 個。
 */
export function GiveView({ q, hintStage, solved, voiceOn, onWrong, onSolved }: Props) {
  const n = q.params?.n ?? Number(q.answer)
  const pool = q.params?.pool ?? n + 3
  const obj = (q.params?.obj ?? 'obj-banana') as string
  const o = mustObject(obj)
  // 在籃子裡的物件，依放進去的順序
  const [basket, setBasket] = useState<number[]>([])
  const [msg, setMsg] = useState<'' | 'more' | 'less' | 'ok'>('')
  const demo = useRef(false)

  const take = (i: number) => {
    if (solved) return
    setMsg('')
    const next = [...basket, i]
    setBasket(next)
    say(numberKey(next.length), chineseNumber(next.length), { enabled: voiceOn })
  }
  const putBack = (i: number) => {
    if (solved) return
    setMsg('')
    setBasket(basket.filter((x) => x !== i))
  }
  const done = () => {
    if (solved) return
    if (basket.length === n) {
      setMsg('ok')
      onSolved()
      return
    }
    const key = basket.length < n ? 'give.more' : 'give.less'
    setMsg(basket.length < n ? 'more' : 'less')
    say(key, pickLine(key).text, { enabled: voiceOn })
    onWrong()
  }

  // 第二次答錯：阿悟示範，把籃子慢慢補到剛好 n 個，一個一個唸
  useEffect(() => {
    if (hintStage < 2 || solved || demo.current) return
    demo.current = true
    const ids: number[] = []
    setBasket([])
    for (let k = 0; k < n; k++)
      ids.push(
        window.setTimeout(() => {
          setBasket((b) => [...b, k])
          say(numberKey(k + 1), chineseNumber(k + 1), { enabled: voiceOn })
        }, 500 + k * 800),
      )
    return () => {
      ids.forEach((id) => window.clearTimeout(id))
      demo.current = false
    }
  }, [hintStage, solved, n, voiceOn])

  const showSlots = hintStage >= 1 && !solved
  const inBasket = new Set(basket)
  return (
    <div className="give" data-testid="question" data-question-id={q.id} data-hint-stage={hintStage} data-type="give">
      <div className="give-table" aria-label={`桌上有${pool}${o.unit}${o.name}`}>
        {Array.from({ length: pool }, (_, i) =>
          inBasket.has(i) ? (
            <span key={i} className="give-slot" aria-hidden />
          ) : (
            <button key={i} type="button" className="give-obj" onClick={() => take(i)} data-testid="give-obj" aria-label={`拿一${o.unit}${o.name}`} disabled={solved}>
              <Icon name={obj} emoji={OBJ_EMOJI[obj]} alt={o.name} />
            </button>
          ),
        )}
      </div>
      <div className={`give-basket ${solved ? 'ok' : ''} ${msg === 'more' || msg === 'less' ? 'off' : ''}`} data-testid="give-basket" data-count={basket.length}>
        <div className="give-basket-items">
          {basket.map((i, k) => (
            <button key={i} type="button" className="give-in" onClick={() => putBack(i)} data-testid="give-in" aria-label={`放回去（第 ${k + 1} 個）`} disabled={solved}>
              <Icon name={obj} emoji={OBJ_EMOJI[obj]} alt={o.name} />
              <b className="pile-num">{k + 1}</b>
            </button>
          ))}
          {showSlots &&
            Array.from({ length: Math.max(0, n - basket.length) }, (_, k) => <span key={`s${k}`} className="give-want" aria-hidden />)}
        </div>
        <span className="give-count" data-testid="give-count" aria-live="polite">
          {basket.length}
        </span>
      </div>
      <p className="give-msg" data-testid="give-msg" data-msg={msg} aria-live="polite">
        {msg === 'more' && '再拿一個'}
        {msg === 'less' && '多拿了，放回去一個'}
      </p>
      <button type="button" className="adv-btn primary big give-done" onClick={done} disabled={solved || basket.length === 0} data-testid="give-done">
        好了
      </button>
    </div>
  )
}
