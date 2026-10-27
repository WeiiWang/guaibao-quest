import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../../db/db'
import { repo } from '../../../db/repo'
import { isValidPin } from '../../../domain/pin'
import { Modal } from '../../components/Modal'
import { PinPad } from '../../components/PinPad'
import { useToast } from '../../hooks'
import { usePoopSetting } from '../../pet/hooks'
import { Switch } from './AudioTab'
import { ChildrenManager } from '../../../profiles/ChildrenManager'
import { useProfiles } from '../../../profiles/context'
import { profiles } from '../../../profiles/manager'
import { AGE_BANDS, AGE_LABEL } from '../../../learning/profile'
import { useLearnerProfile } from '../../learningHooks'
import './learning.css'

export function SettingsTab({ onReset }: { onReset: () => void }) {
  const toast = useToast()
  const settings = useLiveQuery(() => db.settings.get('main'))
  const pet = useLiveQuery(() => db.pets.get('pet'))
  const [childName, setChildName] = useState<string | null>(null)
  const [petName, setPetName] = useState<string | null>(null)
  const [oldPin, setOldPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [newPin2, setNewPin2] = useState('')
  const [pinMsg, setPinMsg] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const poopOn = usePoopSetting()
  const profile = useLearnerProfile()
  const ctx = useProfiles()

  const changePin = async () => {
    if (!isValidPin(newPin)) return setPinMsg('新 PIN 需為 4 位數字')
    if (newPin !== newPin2) return setPinMsg('兩次輸入的新 PIN 不一樣')
    const r = await repo.changePin(oldPin, newPin)
    if (!r.ok) return setPinMsg(r.error)
    setPinMsg('')
    setOldPin('')
    setNewPin('')
    setNewPin2('')
    toast('PIN 已更改', 'ok')
  }

  return (
    <section className="settings">
      <ChildrenManager />

      <div className="card" data-testid="age-card">
        <h2>孩子的年齡</h2>
        <p className="lt-text">決定學習從哪裡開始。已經玩過的技能不會被改動，只影響還沒玩過的。</p>
        <div className="lt-choices" role="radiogroup" aria-label="孩子的年齡">
          {AGE_BANDS.map((b) => (
            <button
              key={b}
              role="radio"
              aria-checked={profile.configured && profile.ageBand === b}
              className={`lt-choice ${profile.configured && profile.ageBand === b ? 'on' : ''}`}
              data-testid={`age-${b}`}
              onClick={async () => {
                // 年齡以孩子名冊為準，同步寫進這個孩子資料庫的 settings.ageBand
                const r = ctx ? await profiles.setChildAge(ctx.activeId, b) : await repo.setAgeBand(b)
                toast(r.ok ? `已設定：${AGE_LABEL[b]}` : r.error, r.ok ? 'ok' : 'warn')
              }}
            >
              {AGE_LABEL[b]}
            </button>
          ))}
        </div>
        <p className="lt-note">
          {!profile.configured && '還沒設定：目前用 4–5 歲的內容（從最簡單開始）。'}
          {profile.ageBand === '3' && profile.configured && '幼幼模式：只有 2 選 1、只出 1–3 個、最常見的物件、答錯馬上示範。'}
          {profile.ageBand === '4-5' && profile.configured && '從最簡單的題目開始，慢慢加深。'}
          {profile.ageBand === '6-7' && profile.configured && '從難度 2 開始，表現好會升到加法、雙屬性等新內容。'}
        </p>
      </div>

      <div className="card">
        <h2>寵物</h2>
        <Switch
          label="寵物會大便"
          desc="吃東西後，阿悟偶爾會大便（可愛的卡通風），小孩點一下就能清掉。不會影響飽足、也不會生病。關閉後不會再出現新的便便。"
          on={poopOn}
          testId="poop-switch"
          onChange={(v) => void repo.setPetPoopOn(v)}
        />
      </div>

      <div className="card form">
        <h2>這個孩子的名字</h2>
        <label className="field">
          小孩名字
          <input className="input" value={childName ?? settings?.childName ?? ''} maxLength={10} onChange={(e) => setChildName(e.target.value)} />
        </label>
        <label className="field">
          寵物名字
          <input className="input" value={petName ?? pet?.name ?? ''} maxLength={10} onChange={(e) => setPetName(e.target.value)} />
        </label>
        <button
          className="btn primary"
          onClick={async () => {
            if (childName !== null) {
              if (ctx) await profiles.renameChild(ctx.activeId, childName)
              else await repo.setChildName(childName)
            }
            if (petName !== null) await repo.setPetName(petName)
            setChildName(null)
            setPetName(null)
            toast('已儲存', 'ok')
          }}
        >
          儲存名字
        </button>
      </div>

      <div className="card form">
        <h2>更改 PIN（全家共用）</h2>
        <label className="field">
          目前的 PIN
          <input className="input" type="password" inputMode="numeric" maxLength={4} value={oldPin} onChange={(e) => setOldPin(e.target.value.replace(/\D/g, ''))} />
        </label>
        <label className="field">
          新 PIN
          <input className="input" type="password" inputMode="numeric" maxLength={4} value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))} />
        </label>
        <label className="field">
          再輸入一次新 PIN
          <input className="input" type="password" inputMode="numeric" maxLength={4} value={newPin2} onChange={(e) => setNewPin2(e.target.value.replace(/\D/g, ''))} />
        </label>
        {pinMsg && <p className="form-msg warn" role="alert">{pinMsg}</p>}
        <button className="btn primary" onClick={changePin}>更改 PIN</button>
      </div>

      <div className="card form danger-zone">
        <h2>重設這個孩子的資料</h2>
        <p>
          只會清除目前這個孩子{settings?.childName ? `「${settings.childName}」` : ''}的任務、點數、寵物與著色進度，讓他重新領一顆蛋。
          其他孩子和家長 PIN 都不受影響。
        </p>
        <button className="btn danger" onClick={() => setConfirmReset(true)}>重設這個孩子的資料</button>
      </div>

      {confirmReset && (
        <Modal title="再輸入一次 PIN 確認重設" onClose={() => setConfirmReset(false)}>
          <PinPad
            label="輸入 PIN 後立即清除這個孩子的資料"
            onComplete={async (pin) => {
              const r = await repo.resetAll(pin)
              if (!r.ok) return r.error
              onReset()
            }}
          />
          <button className="btn" onClick={() => setConfirmReset(false)}>取消</button>
        </Modal>
      )}
    </section>
  )
}
