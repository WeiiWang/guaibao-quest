import { getColoringPage } from '../../art/coloring/pages'

interface Props {
  pageId: string
  fills?: Record<string, string>
  className?: string
  /** 可點擊填色 */
  onRegion?: (regionId: string) => void
}

/** 著色頁 SVG（縮圖與填色畫面共用）。區域是封閉 path，粗黑線 */
export function ColoringSvg({ pageId, fills = {}, className = '', onRegion }: Props) {
  const page = getColoringPage(pageId)
  if (!page) return null
  return (
    <svg
      className={`coloring-svg ${className}`}
      viewBox="-8 -8 416 416"
      role="img"
      aria-label={page.name}
      data-page={pageId}
    >
      <g stroke="#2b2420" strokeWidth={5} strokeLinejoin="round" strokeLinecap="round">
        {page.regions.map((r) => (
          <path
            key={r.id}
            d={r.d}
            data-region={r.id}
            fill={fills[r.id] ?? '#ffffff'}
            className={onRegion ? 'region' : undefined}
            onClick={onRegion ? () => onRegion(r.id) : undefined}
          />
        ))}
        {page.lines.map((d, i) => (
          <path key={i} d={d} fill="none" pointerEvents="none" />
        ))}
        {page.dots.map(([x, y, r], i) => (
          <circle key={i} cx={x} cy={y} r={r} fill="#2b2420" stroke="none" pointerEvents="none" />
        ))}
      </g>
    </svg>
  )
}
