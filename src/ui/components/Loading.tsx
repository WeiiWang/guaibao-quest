import { useState } from 'react'
import '../shell.css'

/**
 * 品牌化載入畫面（取代「載入中…」）：開場藍天底 + 彈跳的蛋。蛋圖還沒到或缺圖時用純 CSS 蛋，不會空白。
 * 配色與 index.html 的啟動畫面一致，所以從啟動畫面接過來看起來是同一個畫面。
 * 沿用 .splash 這個 class，所以還沒換過來的舊 `<div className="splash">載入中…</div>` 也會是同一個底色。
 */
export function Loading() {
  const [imgOk, setImgOk] = useState(false)
  const [imgFail, setImgFail] = useState(false)
  return (
    <div className="splash gq-loading" role="status" aria-label="載入中" data-testid="loading">
      <span className="gq-loading-egg" aria-hidden>
        {!imgOk && <i className="gq-css-egg" />}
        {!imgFail && (
          <img
            src={`${import.meta.env.BASE_URL}art/pet-egg.png`}
            alt=""
            draggable={false}
            hidden={!imgOk}
            onLoad={() => setImgOk(true)}
            onError={() => setImgFail(true)}
          />
        )}
      </span>
      <i className="gq-loading-shadow" aria-hidden />
    </div>
  )
}
