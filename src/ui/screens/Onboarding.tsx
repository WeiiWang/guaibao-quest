import { useEffect, useRef, useState } from 'react'
import { AGE_CHOICES } from '../../domain/home7'
import { DEFAULT_SPECIES, speciesName, type Species } from '../../domain/species'
import { hasRecordedText, sayText, setVoiceSpecies } from '../../learning/speech'
import type { AgeBand } from '../../domain/types'
import { Icon } from '../components/Icon'
import { PetSprite } from '../components/PetSprite'
import { PinPad } from '../components/PinPad'
import { SpeciesPicker } from '../components/SpeciesPicker'
import { RoomBackdrop } from '../components/RoomBackdrop'
import { skipShellMotion } from '../titleGate'
import { playSound } from '../../learning/audioEngine'
import { prefersReducedMotion } from '../components/ScreenTransition'
import '../j74.css'
import '../onboarding.css'

/** 落蛋編排的總長（毫秒）：蛋從天上落下、彈兩下、停穩。要小於 1.5 秒，點一下可以跳過 */
export const EGG_DROP_MS = 1450
/** 蛋第一次碰到地板的時間（title.css / shell.css 的落下動畫），這時候響落地音 */
const EGG_LAND_MS = 620

type Step = 'pin1' | 'pin2' | 'child' | 'age' | 'pet' | 'egg'

interface Props {
  /** true = 全新安裝（要先設定全家共用的家長 PIN）；false = 簡化版（孩子已在名冊裡，例如重設之後），不問 PIN */
  withPin: boolean
  defaultName?: string
  /** 名冊裡已經知道這個孩子的年齡（例如重設之後）就不再問「幾歲」 */
  defaultAge?: AgeBand
  /** v7.5：寵物的名字跟著物種固定（阿悟、兔兔、虎虎），不再讓孩子取名 */
  onFinish: (input: { pin?: string; childName: string; species: Species; ageBand?: AgeBand }) => Promise<{ ok: true } | { ok: false; error: string }>
}

export function Onboarding({ withPin, defaultName = '', defaultAge, onFinish }: Props) {
  const [step, setStep] = useState<Step>(withPin ? 'pin1' : 'child')
  const [pin, setPin] = useState('')
  const [childName, setChildName] = useState(defaultName)
  const [species, setSpecies] = useState<Species>(DEFAULT_SPECIES)
  const petName = speciesName(species)
  const [age, setAge] = useState<AgeBand | undefined>(defaultAge)
  const advance = useRef<number | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // v8：按「開始冒險」後先播落蛋（蛋從天上落到房間地板、彈兩下），再真的建立孩子、進首頁
  const [drop, setDrop] = useState(false)
  const dropTimer = useRef<number | undefined>(undefined)
  const landTimer = useRef<number | undefined>(undefined)
  const finishing = useRef(false)

  const finish = async () => {
    if (finishing.current) return
    finishing.current = true
    window.clearTimeout(dropTimer.current)
    setBusy(true)
    const r = await onFinish({ pin: withPin ? pin : undefined, childName, species, ageBand: age })
    if (!r.ok) {
      setErr(r.error)
      setBusy(false)
      setDrop(false)
      finishing.current = false
    }
  }

  const begin = () => {
    if (busy || drop) return
    setErr('')
    // 這一句是寵物自己說的（物種聲音）：先把語音物種設成他選的，沒錄到就不播（不用機器語音硬唸）
    setVoiceSpecies(species)
    if (hasRecordedText('出發囉！')) sayText('出發囉！')
    // e2e（自動化瀏覽器）預設跳過動畫，立刻建立並進首頁；gq-title-test 時才播
    if (skipShellMotion()) {
      void finish()
      return
    }
    setDrop(true)
    landTimer.current = window.setTimeout(() => playSound('drop'), EGG_LAND_MS)
    dropTimer.current = window.setTimeout(() => void finish(), prefersReducedMotion() ? 400 : EGG_DROP_MS)
  }

  useEffect(
    () => () => {
      window.clearTimeout(advance.current)
      window.clearTimeout(dropTimer.current)
      window.clearTimeout(landTimer.current)
    },
    [],
  )
  // 進到「幾歲」那一頁：先唸一次問句
  useEffect(() => {
    if (step === 'age') sayText('你幾歲了？')
  }, [step])
  const pickAge = (band: AgeBand, say: string) => {
    setAge(band)
    sayText(say)
    window.clearTimeout(advance.current)
    advance.current = window.setTimeout(() => setStep('pet'), 750)
  }

  return (
    <main className="onboarding theme-cream">
      <div className="card onboard-card">
        <h1>乖寶任務</h1>
        {withPin && (step === 'pin1' || step === 'pin2' || step === 'child') && (
          // 這個畫面是家長要做的事，但按下開場「開始」的通常是小孩：寫得很清楚、配上鎖的圖
          <p className="ob-parent" data-testid="onboard-parent-only">
            <Icon name="ui-lock" emoji="🔒" alt="" className="ob-parent-icon" />
            <span>這一步請爸媽來</span>
          </p>
        )}
        {step === 'pin1' && (
          <>
            <p className="lead">請爸媽設定 4 位數家長密碼（PIN），之後進家長區要用。小朋友先不要偷看喔。</p>
            <PinPad
              label="設定家長 PIN"
              onComplete={(p) => {
                setPin(p)
                setStep('pin2')
              }}
            />
          </>
        )}
        {step === 'pin2' && (
          <>
            <p className="lead">再輸入一次確認。</p>
            <PinPad
              label="再輸入一次 PIN"
              onComplete={(p) => {
                if (p !== pin) {
                  setStep('pin1')
                  setPin('')
                  return '兩次不一樣，請重新設定'
                }
                setStep('child')
              }}
            />
          </>
        )}
        {step === 'child' && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (childName.trim()) setStep(defaultAge ? 'pet' : 'age')
            }}
          >
            <p className="lead">小朋友叫什麼名字？</p>
            <input
              className="input big"
              autoFocus
              value={childName}
              maxLength={10}
              placeholder="小朋友的名字"
              onChange={(e) => setChildName(e.target.value)}
            />
            <button className="btn primary" type="submit" disabled={!childName.trim()}>下一步</button>
          </form>
        )}
        {step === 'age' && (
          <div className="h7-age" data-testid="onboard-age">
            <p className="lead">{childName}幾歲了？</p>
            <div className="h7-age-grid" role="radiogroup" aria-label="孩子的年齡">
              {AGE_CHOICES.map((a) => (
                <button
                  key={a.band}
                  type="button"
                  role="radio"
                  aria-checked={age === a.band}
                  className={`h7-age-btn ${age === a.band ? 'on' : ''}`}
                  data-testid={`onboard-age-${a.band}`}
                  onClick={() => pickAge(a.band, a.say)}
                >
                  <Icon name={a.art} emoji={a.emoji} alt="" className="j74-age-icon" />
                  <span className="h7-age-label">{a.label}</span>
                </button>
              ))}
            </div>
            <p className="h7-age-note">年齡決定學習從哪裡開始；之後可以在家長區的「孩子們」修改。</p>
            <button type="button" className="h7-age-skip" data-testid="onboard-age-skip" onClick={() => setStep('pet')}>
              之後再設定
            </button>
          </div>
        )}
        {step === 'pet' && (
          // v7.5：選寵物（取代以前的「取名字」：名字跟著物種固定）。預設是阿悟，直接按下一步就跟以前一樣
          <form
            className="l75-onboard"
            data-testid="onboard-species"
            onSubmit={(e) => {
              e.preventDefault()
              setStep('egg')
            }}
          >
            <p className="lead">想養哪一隻寵物？</p>
            <SpeciesPicker value={species} onChange={setSpecies} />
            <p className="l75-note">選好之後就不能換了喔。</p>
            <button className="btn primary" type="submit" data-testid="onboard-species-next">下一步</button>
          </form>
        )}
        {step === 'egg' && (
          <div className="egg-step">
            <p className="lead">
              {childName}，這是{petName}的蛋！
              <br />
              完成冒險和任務，一起把牠孵出來吧。
            </p>
            <PetSprite pet={{ stage: 'egg', feedCount: 0, name: petName, species }} mood="happy" className="egg-big idle" />
            {err && <p className="form-error">{err}</p>}
            <button className="btn primary" disabled={busy} onClick={begin}>開始冒險</button>
          </div>
        )}
      </div>
      {drop && (
        // 點一下就跳過、直接進首頁
        <div className="egg-drop" data-testid="egg-drop" onClick={() => void finish()}>
          <RoomBackdrop timeOfDay="day" />
          <i className="egg-drop-shadow" aria-hidden />
          <i className="egg-drop-ring" aria-hidden />
          <div className="egg-drop-egg">
            <PetSprite pet={{ stage: 'egg', feedCount: 0, name: petName, species }} mood="happy" className="egg-drop-sprite" />
          </div>
        </div>
      )}
    </main>
  )
}
