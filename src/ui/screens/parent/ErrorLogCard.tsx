import { useState } from 'react'
import { clearErrorLog, readErrorLog, type ErrorEntry } from '../../errorLog'
import '../../components/errorBoundary.css'

const fmt = (t: number) => {
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 設定頁最下面的小區塊：最近 5 筆錯誤（預設收合）。遇到問題時請家長展開、截圖給開發者 */
export function ErrorLogCard() {
  const [list, setList] = useState<ErrorEntry[]>(() => readErrorLog())
  return (
    <details className="card eb-log" data-testid="error-log" onToggle={(e) => e.currentTarget.open && setList(readErrorLog())}>
      <summary>錯誤紀錄（遇到問題時給開發者看）</summary>
      {list.length === 0 ? (
        <p className="eb-empty" data-testid="error-log-empty">沒有錯誤紀錄，一切正常。</p>
      ) : (
        <>
          <ul data-testid="error-log-list">
            {[...list].reverse().map((e) => (
              <li key={`${e.t}-${e.msg}`}>
                <time>
                  {fmt(e.t)}
                  {e.where ? ` / ${e.where}` : ''}
                </time>
                {e.msg}
                {e.stack && <pre>{e.stack}</pre>}
              </li>
            ))}
          </ul>
          <button
            className="btn"
            onClick={() => {
              clearErrorLog()
              setList([])
            }}
          >
            清除紀錄
          </button>
        </>
      )}
    </details>
  )
}
