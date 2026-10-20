import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import './galleryFrame.css'

/** itemId（art-<galleryId>）或畫廊 id → 畫廊 id */
export const galleryIdOf = (artId: string) => (artId.startsWith('art-') ? artId.slice(4) : artId)

/**
 * 掛在牆上的畫框，裡面是畫廊作品的完成圖。
 * 用法：<GalleryFrame artId={placement.itemId} />，會填滿父層的寬高（父層請給明確尺寸）。
 * 作品不存在（被刪除）或還在載入時顯示空畫框，不會壞版。
 */
export function GalleryFrame({ artId, className = '' }: { artId: string; className?: string }) {
  const png = useLiveQuery(async () => (await db.coloring.get(`g:${galleryIdOf(artId)}`))?.png ?? null, [artId])
  return (
    <div className={`gallery-frame ${className}`} data-testid="gallery-frame" data-art={artId}>
      <i className="gf-string" />
      <div className="gf-board">
        {png ? <img src={png} alt="我的畫" draggable={false} /> : <span className="gf-empty" aria-hidden>🖼️</span>}
      </div>
    </div>
  )
}
