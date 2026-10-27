import type { CSSProperties } from 'react'
import { hatAnchor, hatFit } from '../../art/hats'
import { hatOf } from '../../domain/hats'
import { useArtStatus } from '../artProbe'
import { Art } from './Art'
import '../wardrobe.css'

/**
 * 阿悟頭上的帽子。放在 PetSprite 裡、跟阿悟圖同一個容器（.wd-art）：
 * 走路翻轉（pf-flip）、各種動畫（套在 .pet-sprite 上）都會一起動，帽子不會飄開。
 * 位置用「頭頂錨點表」（art/hats.ts）依目前實際顯示的那張姿勢圖決定；睡覺等不戴的姿勢回 null。
 * 帽子圖還沒生成時用 emoji 補上。
 */
export function PetHat({ hat, artFile }: { hat: string; artFile: string }) {
  const def = hatOf(hat)
  const anchor = hatAnchor(artFile)
  const status = useArtStatus(hat)
  if (!def || !anchor) return null
  const fit = hatFit(hat, status === 'ok')
  const w = anchor.w * fit.scale
  // 錨點 = 帽子底邊中心再往上 sink（陷進頭裡的部分）；轉動也繞著這一點
  const pivotY = (1 - fit.sink) * 100
  const style = {
    left: `${anchor.x}%`,
    top: `${anchor.y}%`,
    width: `${w}%`,
    aspectRatio: String(fit.aspect),
    transform: `translate(-50%, -${pivotY}%) rotate(${anchor.rotate}deg)`,
    transformOrigin: `50% ${pivotY}%`,
    '--hw': w,
  } as CSSProperties
  return (
    <span className="wd-hat" style={style} data-testid="pet-hat" data-hat={hat} data-art={artFile} aria-hidden>
      {status === 'ok' ? <Art name={hat} className="wd-hat-img" alt="" /> : status === 'no' ? <span className="wd-hat-emoji">{def.emoji}</span> : null}
    </span>
  )
}
