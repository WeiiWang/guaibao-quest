import { Component, type ErrorInfo, type ReactNode } from 'react'
import { petArt, speciesEmoji, speciesName } from '../../domain/species'
import { isChunkLoadError, recordError, reloadOnceForChunkError } from '../errorLog'
import { useSpecies } from '../species'
import { Icon } from './Icon'
import './errorBoundary.css'

interface Props {
  children: ReactNode
  /** 「回首頁」：兒童端 = 切回首頁畫面；不給 = 回到網站根網址（整頁重新載入） */
  onHome?: () => void
  /** 這個值變了（例如換了畫面）就把錯誤狀態清掉，重新嘗試畫 children */
  resetKey?: unknown
  /** 記錄用：哪一層接到的（child、parent、app） */
  where?: string
}

interface State {
  error: Error | null
}

/**
 * 錯誤邊界：任何畫面丟錯都不白屏，顯示寵物 + 一句溫柔的話 + 大按鈕「回首頁」「重新整理」。
 * 錯誤記到 localStorage（最近 5 筆，家長區設定頁看得到）。
 * 動態載入失敗（新版部署後舊 chunk 找不到）會自動重新整理一次，拿到新版。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    recordError(error, this.props.where ?? 'app', info.componentStack ?? undefined)
    if (isChunkLoadError(error)) reloadOnceForChunkError()
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  private home = () => {
    if (this.props.onHome) {
      this.props.onHome()
      this.setState({ error: null })
    } else {
      location.replace(import.meta.env.BASE_URL)
    }
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return <ErrorScreen onHome={this.home} onReload={() => location.reload()} />
  }
}

/** 出錯時的畫面：不依賴資料庫與其他畫面，圖載入不了就用 emoji */
export function ErrorScreen({ onHome, onReload }: { onHome: () => void; onReload: () => void }) {
  const species = useSpecies()
  const name = speciesName(species)
  return (
    <main className="eb" role="alert" data-testid="error-screen">
      <div className="eb-card">
        <Icon name={petArt(species, 'baby', 'dizzy')} emoji={speciesEmoji(species)} alt={name} className="eb-pet" />
        <p className="eb-line">哎呀，{name}有點暈暈的。我們先回家休息一下，再繼續玩吧！</p>
        <div className="eb-actions">
          <button type="button" className="eb-btn eb-go-home" data-testid="error-home" onClick={onHome}>
            <svg viewBox="0 0 48 48" aria-hidden>
              <path d="M24 7 6 22.5h5V40a2 2 0 0 0 2 2h8V30h6v12h8a2 2 0 0 0 2-2V22.5h5z" fill="#fff" stroke="#fff" strokeWidth="3" strokeLinejoin="round" />
            </svg>
            <span>回首頁</span>
          </button>
          <button type="button" className="eb-btn eb-go-reload" data-testid="error-reload" onClick={onReload}>
            <svg viewBox="0 0 48 48" aria-hidden>
              <path d="M38 24a14 14 0 1 1-4.1-9.9" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" />
              <path d="M40 6v13H27z" fill="#fff" stroke="#fff" strokeWidth="3" strokeLinejoin="round" />
            </svg>
            <span>重新整理</span>
          </button>
        </div>
      </div>
    </main>
  )
}
