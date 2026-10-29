import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { sayText } from '../../learning/speech'
import { useLearningSettings } from '../learningHooks'
import type { Pet } from '../../domain/types'
import { PetSprite } from './PetSprite'
import '../j74.css'

interface Props {
  /** 阿悟說的那一句（畫面上顯示，也會唸一次） */
  line: string
  /** 「去做」按鈕的字 */
  button: string
  onGo: () => void
  testId?: string
  /** 呼叫端已經讀到阿悟就傳進來（換分頁時不用等資料庫、不會閃一下空白）；沒給就自己讀 */
  pet?: Pet
}

/**
 * v7.4 J2：空狀態。阿悟的一張圖 + 一句話（顯示並唸出來）+ 一顆「去做」大按鈕，3 歲看到的不是一片空白。
 * 元件一出現就唸一次；換到另一個空狀態（key 不同）會重新唸。
 */
export function EmptyState({ line, button, onGo, testId = 'empty-state', pet: petIn }: Props) {
  const { voiceOn } = useLearningSettings()
  const own = useLiveQuery(() => (petIn ? undefined : db.pets.get('pet')), [petIn])
  const pet = petIn ?? own
  useEffect(() => {
    sayText(line, { enabled: voiceOn })
    // 只在出現時唸一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line])
  return (
    <section className="j74-empty" data-testid={testId} role="status">
      <div className="j74-empty-pet" aria-hidden>
        {pet && <PetSprite pet={pet} mood="normal" pose={pet.stage === 'egg' ? undefined : 'think'} hat={pet.hat ?? null} />}
      </div>
      <p className="j74-empty-line">{line}</p>
      <button type="button" className="btn primary j74-empty-go" onClick={onGo} data-testid={`${testId}-go`}>
        {button}
      </button>
    </section>
  )
}
