import { getColoringPage } from '../../art/coloring/pages'
import { rasterThumb, useRasterArt } from '../../art/coloring/rasterArt'
import { defsMarkup, fillAttr, LINE_COLOR, VIEWBOX } from '../../art/coloring/render'

interface Props {
  pageId: string
  fills?: Record<string, string>
  className?: string
  /** 可點擊填色 */
  onRegion?: (regionId: string) => void
  /** 區塊顯示成「可點」的游標樣式（點擊本身由外層的畫板處理） */
  regionClass?: boolean
  /** 剛填的區域：換 n 會重播「啵」彈跳動畫 */
  popped?: { id: string; n: number } | null
}

/** 著色頁 SVG（縮圖與填色畫面共用）。區域是封閉 path，粗黑線；支援純色與特殊填色（彩虹、亮片、條紋、點點） */
export function ColoringSvg({ pageId, fills = {}, className = '', onRegion, regionClass, popped }: Props) {
  const page = getColoringPage(pageId)
  if (!page) return null
  const defs = defsMarkup(fills)
  return (
    <svg
      className={`coloring-svg ${className}`}
      viewBox={`${VIEWBOX.x} ${VIEWBOX.y} ${VIEWBOX.size} ${VIEWBOX.size}`}
      role="img"
      aria-label={page.name}
      data-page={pageId}
    >
      {defs && <defs dangerouslySetInnerHTML={{ __html: defs }} />}
      <g stroke={LINE_COLOR} strokeWidth={5} strokeLinejoin="round" strokeLinecap="round">
        {page.regions.map((r) => {
          const isPop = popped?.id === r.id
          const v = fills[r.id]
          return (
            <path
              key={isPop ? `${r.id}#${popped!.n}` : r.id}
              d={r.d}
              data-region={r.id}
              data-fill={v ? v.split(':')[0] : undefined}
              fill={fillAttr(v)}
              className={`${onRegion || regionClass ? 'region' : ''} ${isPop ? 'pop' : ''}`.trim() || undefined}
              onClick={onRegion ? () => onRegion(r.id) : undefined}
            />
          )
        })}
        {page.lines.map((d, i) => (
          <path key={i} d={d} fill="none" pointerEvents="none" />
        ))}
        {page.dots.map(([x, y, r], i) => (
          <circle key={i} cx={x} cy={y} r={r} fill={LINE_COLOR} stroke="none" pointerEvents="none" />
        ))}
      </g>
    </svg>
  )
}

/** 點陣頁縮圖：小 canvas 合成後轉 dataURL，依 fills 快取（見 rasterArt.rasterThumb） */
export function RasterThumb({ pageId, fills, className = '', size = 256 }: { pageId: string; fills?: Record<string, string>; className?: string; size?: number }) {
  const art = useRasterArt(pageId)
  const page = getColoringPage(pageId)
  if (!art) return <span className={`coloring-svg raster-thumb pending ${className}`} data-page={pageId} aria-label={page?.name} role="img" />
  return <img className={`coloring-svg raster-thumb ${className}`} src={rasterThumb(art, fills, size)} alt={page?.name ?? ''} data-page={pageId} draggable={false} />
}

/** 著色頁縮圖：向量頁畫 SVG，點陣頁畫 canvas 縮圖 */
export function PageThumb({ pageId, fills, className = '' }: { pageId: string; fills?: Record<string, string>; className?: string }) {
  return getColoringPage(pageId)?.kind === 'raster' ? <RasterThumb pageId={pageId} fills={fills} className={className} /> : <ColoringSvg pageId={pageId} fills={fills} className={className} />
}
