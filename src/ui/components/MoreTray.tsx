import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon'
import '../wardrobe.css'

export interface MoreItem {
  id: string
  label: string
  emoji: string
  /** v7.4：3D 圖示名（public/art/<icon>.png）；缺圖時自動退回 emoji */
  icon?: string
  tone: 'mint' | 'lavender' | 'bubblegum' | 'butter'
  onClick: () => void
  testId?: string
  aria?: string
}

/**
 * 首頁右側的「更多」：工坊、背包之外的按鈕（表演、朋友、相簿、衣櫃）收進一個小托盤，
 * 右側不會再一直往下堆，三種螢幕尺寸都放得下；每顆按鈕都 >= 56px。
 */
export function MoreTray({ items, children }: { items: MoreItem[]; children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const out = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', out)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', out)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  return (
    <div className="more-wrap" ref={wrap}>
      <button className={`mini-candy sky more-btn ${open ? 'open' : ''}`} onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="true" data-testid="more-btn" aria-label="更多">
        <span className="mini-emoji" aria-hidden>{open ? '✕' : '⋯'}</span>
        <span>更多</span>
      </button>
      {open && (
        <div className="more-tray" role="menu" data-testid="more-tray">
          {items.map((it) => (
            <button
              key={it.id}
              role="menuitem"
              className={`mini-candy ${it.tone}`}
              onClick={() => {
                setOpen(false)
                it.onClick()
              }}
              data-testid={it.testId}
              aria-label={it.aria ?? it.label}
            >
              {it.icon ? <Icon name={it.icon} emoji={it.emoji} size={34} alt="" /> : <span className="mini-emoji" aria-hidden>{it.emoji}</span>}
              <span className="more-label">{it.label}</span>
            </button>
          ))}
          {children}
        </div>
      )}
    </div>
  )
}
