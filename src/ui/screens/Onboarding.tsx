import { useState } from 'react'
import { repo } from '../../db/repo'
import { DEFAULT_PET_NAME } from '../../domain/constants'
import { PetSprite } from '../components/PetSprite'
import { PinPad } from '../components/PinPad'

type Step = 'pin1' | 'pin2' | 'child' | 'pet' | 'egg'

export function Onboarding() {
  const [step, setStep] = useState<Step>('pin1')
  const [pin, setPin] = useState('')
  const [childName, setChildName] = useState('')
  const [petName, setPetName] = useState(DEFAULT_PET_NAME)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const finish = async () => {
    setBusy(true)
    const r = await repo.onboard({ pin, childName, petName })
    if (!r.ok) {
      setErr(r.error)
      setBusy(false)
    }
  }

  return (
    <main className="onboarding theme-cream">
      <div className="card onboard-card">
        <h1>乖寶任務</h1>
        {step === 'pin1' && (
          <>
            <p className="lead">先請爸媽設定 4 位數家長密碼（PIN）。小孩不要偷看喔。</p>
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
              if (childName.trim()) setStep('pet')
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
        {step === 'pet' && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              setStep('egg')
            }}
          >
            <p className="lead">幫小寵物取個名字吧！</p>
            <input
              className="input big"
              autoFocus
              value={petName}
              maxLength={10}
              placeholder={DEFAULT_PET_NAME}
              onChange={(e) => setPetName(e.target.value)}
            />
            <button className="btn primary" type="submit">下一步</button>
          </form>
        )}
        {step === 'egg' && (
          <div className="egg-step">
            <p className="lead">
              {childName}，這是{petName.trim() || DEFAULT_PET_NAME}的蛋！
              <br />
              完成冒險和任務，一起把牠孵出來吧。
            </p>
            <PetSprite pet={{ stage: 'egg', feedCount: 0, name: petName.trim() || DEFAULT_PET_NAME }} mood="happy" className="egg-big idle" />
            {err && <p className="form-error">{err}</p>}
            <button className="btn primary" disabled={busy} onClick={finish}>開始冒險</button>
          </div>
        )}
      </div>
    </main>
  )
}
