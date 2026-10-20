import { getColoringPage } from '../../art/coloring/pages'
import { defsMarkup, fillAttr, LINE_COLOR, VIEWBOX } from '../../art/coloring/render'

interface Props {
  pageId: string
  fills?: Record<string, string>
  className?: string
  /** 可點擊填色 */
  onRegion?: (regionId: string) => void
  /** 剛填的區域：換 n 會重播「啵」彈跳動畫 */
  popped?: { id: string; n: number } | null
}

/** 著色頁 SVG（縮圖與填色畫面共用）。區域是封閉 path，粗黑線；支援純色與特殊填色（彩虹、亮片、條紋、點點） */
export function ColoringSvg({ pageId, fills = {}, className = '', onRegion, popped }: Props) {
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
              className={`${onRegion ? 'region' : ''} ${isPop ? 'pop' : ''}`.trim() || undefined}
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
