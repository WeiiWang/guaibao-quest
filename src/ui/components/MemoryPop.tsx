import { useEffect } from 'react'
import { playSfx } from '../../learning/sfx'
import { sayText } from '../../learning/speech'
import type { AlbumCard } from '../../domain/types'
import { MemoryCard } from './MemoryCard'
import '../wardrobe.css'

/** 回憶卡停多久自己收進相簿（ms） */
export const MEMORY_SHOW_MS = 6000

interface Props {
  card: AlbumCard
  petName: string
  voiceOn: boolean
  soundOn: boolean
  onClose: () => void
  onOpenAlbum: () => void
}

/**
 * 新的回憶卡：獎勵依序出現的最後一個（材料 → 食物 → 新招 → 回憶卡）。
 * 不擋住畫面：卡片從上方掉下來、唸出那一句話，幾秒後自己收進相簿；只有卡片本身可以點。
 */
export function MemoryPop({ card, petName, voiceOn, soundOn, onClose, onOpenAlbum }: Props) {
  useEffect(() => {
    playSfx('reward', soundOn)
    sayText(card.caption, { enabled: voiceOn })
    const t = window.setTimeout(onClose, MEMORY_SHOW_MS)
    return () => window.clearTimeout(t)
    // 每張卡只在出現時唸一次、只計一次時
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id])
  return (
    <div className="al-pop" role="status" aria-label={`新的回憶卡：${card.caption}`} data-testid="memory-pop" data-card={card.id}>
      <div className="al-pop-sheet">
        <p className="al-pop-title">新的回憶卡</p>
        <MemoryCard card={card} petName={petName} big />
        <div className="al-pop-actions">
          <button className="btn" onClick={onOpenAlbum} data-testid="memory-album">看相簿</button>
          <button className="btn primary" onClick={onClose} data-testid="memory-close">好</button>
        </div>
      </div>
    </div>
  )
}
