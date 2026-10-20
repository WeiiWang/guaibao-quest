import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../../db/db'
import { repo } from '../../../db/repo'
import { isValidPin } from '../../../domain/pin'
import { Modal } from '../../components/Modal'
import { PinPad } from '../../components/PinPad'
import { useToast } from '../../hooks'

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
      <div className="card form">
        <h2>名字</h2>
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
            if (childName !== null) await repo.setChildName(childName)
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
        <h2>更改 PIN</h2>
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
        <h2>重設全部資料</h2>
        <p>會清除所有任務、點數、寵物與著色進度，並回到初次設定。</p>
        <button className="btn danger" onClick={() => setConfirmReset(true)}>重設全部資料</button>
      </div>

      {confirmReset && (
        <Modal title="再輸入一次 PIN 確認重設" onClose={() => setConfirmReset(false)}>
          <PinPad
            label="輸入 PIN 後立即清除全部資料"
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
