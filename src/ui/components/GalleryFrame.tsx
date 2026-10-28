import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { isFrameId } from '../../domain/frames'
import './galleryFrame.css'
import './frames.css'

/** itemId（art-<galleryId>）或畫廊 id → 畫廊 id */
export const galleryIdOf = (artId: string) => (artId.startsWith('art-') ? artId.slice(4) : artId)

/**
 * 畫框 + 畫的樣子（純顯示）。frame 沒有或不認得 = 預設的簡單畫框（舊作品都是這樣）。
 * 填滿父層的寬高（父層請給明確尺寸）。畫廊選畫框的小預覽、完成慶祝、房間牆上的畫都用它。
 */
export function GalleryFrameView({ png, frame, artId = '', className = '' }: { png?: string | null; frame?: string; artId?: string; className?: string }) {
  const f = isFrameId(frame) ? frame : 'plain'
  return (
    <div className={`gallery-frame ${className}`} data-testid="gallery-frame" data-art={artId} data-frame={f}>
      <i className="gf-string" />
      <div className={`gf-board fr-${f}`}>
        {png ? <img src={png} alt="我的畫" draggable={false} /> : <span className="gf-empty" aria-hidden>🖼️</span>}
        {f === 'star' && (
          <>
            <i className="fr-spark fr-spark-a" aria-hidden>★</i>
            <i className="fr-spark fr-spark-b" aria-hidden>★</i>
            <i className="fr-spark fr-spark-c" aria-hidden>★</i>
            <i className="fr-spark fr-spark-d" aria-hidden>★</i>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * 掛在牆上的畫框，裡面是畫廊作品的完成圖，畫框是作品選用的那一個（D2）。
 * 用法：<GalleryFrame artId={placement.itemId} />，會填滿父層的寬高（父層請給明確尺寸）。
 * 作品不存在（被刪除）或還在載入時顯示空畫框，不會壞版。
 */
export function GalleryFrame({ artId, className = '' }: { artId: string; className?: string }) {
  const work = useLiveQuery(async () => {
    const w = await db.coloring.get(`g:${galleryIdOf(artId)}`)
    return w ? { png: w.png ?? null, frame: w.frame } : null
  }, [artId])
  return <GalleryFrameView png={work?.png} frame={work?.frame} artId={artId} className={className} />
}
