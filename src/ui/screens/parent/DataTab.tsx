import { useEffect, useState, useSyncExternalStore } from 'react'
import { backupFileName, createBackup } from '../../../profiles/backup'
import { isStandalone } from '../../install'
import { packState, pausePack, refreshPack, startPack, subscribePack, type PackState } from '../../offlinePack'
import { useToast } from '../../hooks'
import { APP_VERSION } from '../../version'
import { InstallGuide } from './InstallGuide'
import { RestoreFlow } from './RestoreFlow'
import { fmtBytes, fmtDateTime } from './dataFormat'
import './learning.css'
import './reliability.css'

const LAST_BACKUP_KEY = 'gq-last-backup'

function readLastBackup(): number {
  try {
    return Number(localStorage.getItem(LAST_BACKUP_KEY)) || 0
  } catch {
    return 0
  }
}

async function makeBackupFile(): Promise<File> {
  const backup = await createBackup(APP_VERSION)
  return new File([JSON.stringify(backup)], backupFileName(), { type: 'application/json' })
}

/** 真的把檔案存下來：Blob + <a download>。iPad Safari 會跳出「要下載嗎」；存到「檔案」App 的下載項目 */
function saveFile(file: File) {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Safari 要等一下才開始讀 blob，太早釋放會下載失敗
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function BackupCard() {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState(readLastBackup)
  const [err, setErr] = useState('')
  const canShare = (() => {
    try {
      return typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File(['{}'], 'x.json', { type: 'application/json' })] })
    } catch {
      return false
    }
  })()

  const done = () => {
    const t = Date.now()
    try {
      localStorage.setItem(LAST_BACKUP_KEY, String(t))
    } catch {
      /* 頂多不顯示上次備份時間 */
    }
    setLast(t)
  }

  const run = async (how: 'download' | 'share') => {
    setBusy(true)
    setErr('')
    try {
      const file = await makeBackupFile()
      if (how === 'download') {
        saveFile(file)
        done()
        toast('備份檔已開始下載', 'ok')
      } else {
        await navigator.share({ files: [file], title: '乖寶任務備份' })
        done()
      }
    } catch (e) {
      // 取消分享不算錯
      if ((e as { name?: string } | null)?.name !== 'AbortError') setErr('備份沒有完成，請再試一次。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" data-testid="backup-card">
      <h2>備份與還原</h2>
      <p className="lt-note">把這台裝置上全部孩子的進度存成一個檔案。換裝置、或擔心資料被瀏覽器清掉時，可以用這個檔案還原。檔案裡有孩子的名字與進度，也有家長 PIN 的雜湊，請放在自己的地方。</p>
      <p className="lt-note" data-testid="backup-last">{last ? `上次備份：${fmtDateTime(last)}` : '這台裝置還沒有備份過。'}</p>
      {err && <p className="form-msg warn" role="alert">{err}</p>}
      <div className="row-actions rl-actions">
        <button className="btn primary" disabled={busy} data-testid="backup-download" onClick={() => void run('download')}>下載備份檔</button>
        {canShare && (
          <button className="btn" disabled={busy} data-testid="backup-share" onClick={() => void run('share')}>用分享存到「檔案」</button>
        )}
        <RestoreFlow requirePin label="從備份檔還原" />
      </div>
      {canShare && <p className="lt-note">如果按「下載備份檔」沒有反應（主畫面版的 App 有時會這樣），請改用分享，選「儲存到檔案」。</p>}
    </div>
  )
}

function packMessage(s: PackState): string | null {
  if (s.problem === 'quota') return '裝置空間不夠了，下載已暫停。已下載的部分還在；清出空間後按「繼續下載」。'
  if (s.problem === 'network') return '連線中斷，下載已暫停。已下載的部分還在；網路恢復後會自動接著下載，也可以按「繼續下載」。'
  if (s.problem === 'partial') return `有 ${s.failed} 個檔案沒有下載成功，按「繼續下載」再試一次。`
  return null
}

function OfflinePackCard() {
  const s = useSyncExternalStore(subscribePack, packState)
  useEffect(() => {
    void refreshPack()
  }, [])
  const pct = s.totalBytes ? Math.floor((s.doneBytes / s.totalBytes) * 100) : 0
  const left = s.totalBytes - s.doneBytes
  const free = s.storage ? Math.max(0, s.storage.quota - s.storage.usage) : null
  const tight = free !== null && free < left
  const msg = packMessage(s)
  return (
    <div className="card" data-testid="pack-card" data-phase={s.phase}>
      <h2>離線內容包</h2>
      <p className="lt-note">平常語音和圖片是用到才下載。一次下載全部之後，沒有網路（車上、飛機上）也能完整玩。</p>
      {s.phase === 'unsupported' && <p className="form-msg warn" data-testid="pack-unsupported">這個瀏覽器不支援離線內容。請用 iPad 的 Safari，並先加到主畫面。</p>}
      {s.phase === 'unavailable' && <p className="form-msg warn" data-testid="pack-unavailable">目前拿不到內容清單，請連上網路後再打開這一頁。</p>}
      {s.phase === 'checking' && <p className="lt-note">檢查中…</p>}
      {s.totalBytes > 0 && (
        <>
          <p data-testid="pack-size">
            全部約 <b>{fmtBytes(s.totalBytes)}</b>（{s.totalFiles} 個檔案）
            {free !== null ? (
              <>
                ；這台裝置還可以用約 <b data-testid="pack-free">{fmtBytes(free)}</b>
              </>
            ) : (
              '；這個瀏覽器不提供可用空間的資訊'
            )}
            。
          </p>
          <div className="rl-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="下載進度">
            <i style={{ width: `${pct}%` }} />
          </div>
          <p className="lt-note" data-testid="pack-progress" data-done={s.doneFiles} data-total={s.totalFiles}>
            {s.phase === 'done' ? '已全部下載，可以離線使用。' : `已下載 ${pct}%（${fmtBytes(s.doneBytes)} / ${fmtBytes(s.totalBytes)}）`}
          </p>
        </>
      )}
      {tight && s.phase !== 'done' && <p className="form-msg warn" data-testid="pack-tight">可用空間可能不夠（還要約 {fmtBytes(left)}）。可以先試試看，空間不夠時會自動暫停。</p>}
      {msg && <p className="form-msg warn" role="alert" data-testid="pack-problem">{msg}</p>}
      <div className="row-actions rl-actions">
        {s.phase === 'ready' && <button className="btn primary" data-testid="pack-start" onClick={() => void startPack()}>下載全部內容</button>}
        {s.phase === 'paused' && <button className="btn primary" data-testid="pack-start" onClick={() => void startPack()}>繼續下載</button>}
        {s.phase === 'running' && <button className="btn" data-testid="pack-pause" onClick={pausePack}>暫停</button>}
        {s.phase === 'done' && <button className="btn" data-testid="pack-recheck" onClick={() => void refreshPack()}>重新檢查</button>}
      </div>
      {s.phase === 'running' && <p className="lt-note">下載時請保持螢幕開著、連著 Wi-Fi。中斷了也沒關係，下次會從中斷的地方接著下載。離開這一頁也會繼續下載。</p>}
      {(s.phase === 'ready' || s.phase === 'paused') && !isStandalone() && <p className="lt-note" data-testid="pack-install-note">建議先加到主畫面，再從主畫面打開下載。iPad 上主畫面版和 Safari 分頁的資料是分開存的。</p>}
    </div>
  )
}

/** 家長區「備份與離線」分頁 */
export function DataTab() {
  return (
    <section className="lt rl" data-testid="data-tab">
      <BackupCard />
      <OfflinePackCard />
      <InstallGuide />
    </section>
  )
}
