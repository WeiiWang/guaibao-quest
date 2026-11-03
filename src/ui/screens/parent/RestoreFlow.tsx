import { useRef, useState } from 'react'
import { MAX_BACKUP_BYTES, parseBackup, restoreBackup, type BackupFile, type BackupSummary } from '../../../profiles/backup'
import { profiles } from '../../../profiles/manager'
import { Modal } from '../../components/Modal'
import { PinPad } from '../../components/PinPad'
import { fmtDateTime } from './dataFormat'
import { RESTORED_FLAG } from './restoredFlag'

type Step = { name: 'idle' } | { name: 'reading' } | { name: 'bad'; error: string } | { name: 'summary'; backup: BackupFile; summary: BackupSummary } | { name: 'confirm'; backup: BackupFile; summary: BackupSummary } | { name: 'restoring' } | { name: 'failed'; error: string }

/**
 * 從備份還原：選檔 → 驗證並顯示內容 → 第二次確認（有 PIN 的裝置要再輸入一次 PIN）→ 取代 → 重新載入。
 * requirePin = false：全新裝置（還沒有任何資料也沒有 PIN，onboarding 用）。
 */
export function RestoreFlow({ requirePin, label, className = 'btn' }: { requirePin: boolean; label: string; className?: string }) {
  const [step, setStep] = useState<Step>({ name: 'idle' })
  const input = useRef<HTMLInputElement>(null)
  const close = () => setStep({ name: 'idle' })

  const onFile = async (file: File | undefined) => {
    if (input.current) input.current.value = '' // 同一個檔案可以再選一次
    if (!file) return
    if (file.size > MAX_BACKUP_BYTES) return setStep({ name: 'bad', error: '這個檔案太大了，不是乖寶任務的備份檔。' })
    setStep({ name: 'reading' })
    let text: string
    try {
      text = await file.text()
    } catch {
      return setStep({ name: 'bad', error: '這個檔案讀不出來。如果檔案在雲端硬碟，請先下載到這台裝置再試。' })
    }
    const r = parseBackup(text)
    if (!r.ok) return setStep({ name: 'bad', error: r.error })
    setStep({ name: 'summary', backup: r.backup, summary: r.summary })
  }

  const doRestore = async (backup: BackupFile): Promise<string | void> => {
    setStep({ name: 'restoring' })
    const r = await restoreBackup(backup)
    if (!r.ok) {
      setStep({ name: 'failed', error: r.error })
      return
    }
    try {
      sessionStorage.setItem(RESTORED_FLAG, '1')
    } catch {
      /* 頂多少一句提示 */
    }
    location.reload()
  }

  return (
    <>
      {/* 不設 accept：iPad 的檔案選單有時會把副檔名不認得的檔案變灰，選到錯的檔案由驗證擋下來 */}
      <input ref={input} type="file" hidden data-testid="restore-file" onChange={(e) => void onFile(e.target.files?.[0])} />
      <button type="button" className={className} data-testid="restore-pick" onClick={() => input.current?.click()}>
        {label}
      </button>
      {step.name === 'reading' && (
        <Modal title="讀取備份檔">
          <p>讀取中…</p>
        </Modal>
      )}
      {step.name === 'bad' && (
        <Modal title="不能用這個檔案" onClose={close}>
          <p className="form-msg warn" role="alert" data-testid="restore-error">{step.error}</p>
          <div className="row-actions">
            <button className="btn" onClick={close}>知道了</button>
          </div>
        </Modal>
      )}
      {step.name === 'summary' && (
        <Modal title="這份備份的內容" onClose={close}>
          <div data-testid="restore-summary">
            <p>建立時間：{step.summary.createdAt ? fmtDateTime(step.summary.createdAt) : '不明'}</p>
            <ul className="rl-list">
              {step.summary.children.map((c) => (
                <li key={c.id}>{c.name}</li>
              ))}
            </ul>
            <p className="form-msg warn">還原會取代這台裝置上全部孩子的資料與家長 PIN（改成備份時的 PIN）。這個動作不能復原。</p>
          </div>
          <div className="row-actions">
            <button className="btn" onClick={close}>取消</button>
            <button
              className="btn danger"
              data-testid="restore-continue"
              onClick={() => (requirePin ? setStep({ name: 'confirm', backup: step.backup, summary: step.summary }) : void doRestore(step.backup))}
            >
              {requirePin ? '繼續' : '確定還原'}
            </button>
          </div>
        </Modal>
      )}
      {step.name === 'confirm' && (
        <Modal title="再輸入一次目前的 PIN 確認還原" onClose={close}>
          <PinPad
            label={`輸入後立即用備份取代（${step.summary.children.length} 個孩子）`}
            onComplete={async (pin) => {
              if (!(await profiles.verifyPin(pin))) return 'PIN 不正確'
              await doRestore(step.backup)
            }}
          />
          <div className="row-actions">
            <button className="btn" onClick={close}>取消</button>
          </div>
        </Modal>
      )}
      {step.name === 'restoring' && (
        <Modal title="還原中">
          <p data-testid="restore-working">正在寫入，請不要關閉 App…</p>
        </Modal>
      )}
      {step.name === 'failed' && (
        <Modal title="還原沒有完成" onClose={close}>
          <p className="form-msg warn" role="alert" data-testid="restore-error">{step.error}</p>
          <div className="row-actions">
            <button className="btn" onClick={close}>知道了</button>
          </div>
        </Modal>
      )}
    </>
  )
}
