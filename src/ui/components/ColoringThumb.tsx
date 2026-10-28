import { getColoringPage } from '../../art/coloring/pages'
import { DOTS_REFERENCE_OPACITY, dotsItem, parseDotsId, silhouettePath } from '../../art/dots/dots'
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
  /** v7.3 F3：這些區塊閃動提示「還沒塗」 */
  flashIds?: readonly string[]
  /** v7.3 F4：連連看拿去塗色的頁，剪影裡疊一張 25% 的原 3D 圖當參考底圖（畫板用，縮圖不用） */
  reference?: boolean
}

/** 著色頁 SVG（縮圖與填色畫面共用）。區域是封閉 path，粗黑線；支援純色與特殊填色（彩虹、亮片、條紋、點點） */
export function ColoringSvg({ pageId, fills = {}, className = '', onRegion, regionClass, popped, flashIds, reference }: Props) {
  const page = getColoringPage(pageId)
  if (!page) return null
  const defs = defsMarkup(fills)
  const flash = flashIds?.length ? new Set(flashIds) : null
  const ref = reference ? parseDotsId(pageId) : null
  const refItem = ref ? dotsItem(ref.name) : undefined
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
              className={`${onRegion || regionClass ? 'region' : ''} ${isPop ? 'pop' : ''} ${flash?.has(r.id) && !v ? 'f73-flash-region' : ''}`.trim() || undefined}
              onClick={onRegion ? () => onRegion(r.id) : undefined}
            />
          )
        })}
        {refItem && ref && (
          <>
            <clipPath id="f73-ref-clip"><path d={silhouettePath(ref.name)} stroke="none" /></clipPath>
            <image
              className="f73-ref"
              data-testid="dots-reference"
              href={`${import.meta.env.BASE_URL}art/${ref.name}.png`}
              x={refItem.img[0]}
              y={refItem.img[1]}
              width={refItem.img[2]}
              height={refItem.img[3]}
              preserveAspectRatio="xMidYMid meet"
              clipPath="url(#f73-ref-clip)"
              opacity={DOTS_REFERENCE_OPACITY}
              pointerEvents="none"
              stroke="none"
            />
          </>
        )}
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
