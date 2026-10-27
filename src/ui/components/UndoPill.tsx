import type { ReactNode } from 'react'

/**
 * 「退回」小按鈕：剛做完一件事（買東西…）後，在 ms 內可以收回。
 * 浮在畫面右上、標題列下方，不會擋到底部的操作按鈕；倒數用一圈縮小的色條表示，時間到由呼叫端把它拿掉。
 */
export function UndoPill({ ms, label, onUndo, children, testId = 'undo-pill' }: { ms: number; label: string; onUndo: () => void; children?: ReactNode; testId?: string }) {
  return (
    <button className="undo-pill" onClick={onUndo} aria-label={label} data-testid={testId} style={{ ['--undo-ms' as string]: `${ms}ms` }}>
      <span className="undo-arrow" aria-hidden>↩</span>
      {children}
      <span className="undo-text">退回</span>
      <i className="undo-bar" aria-hidden />
    </button>
  )
}
