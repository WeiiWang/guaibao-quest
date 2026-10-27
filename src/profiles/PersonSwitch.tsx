import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Pet } from '../domain/types'
import { Modal } from '../ui/components/Modal'
import { PetSprite } from '../ui/components/PetSprite'
import { moodAt } from '../domain/pet'
import { now as clockNow } from '../domain/clock'
import { useProfiles } from './context'
import './profiles.css'

/**
 * 首頁左上角頭像。只有 1 個孩子時就是一般的頭像；有 2 個以上時變成按鈕，
 * 點下去由阿悟揮手問「要換人玩嗎？」，孩子確認才回到選孩子畫面（換人不需要 PIN）。
 */
export function PersonSwitch({ pet, children }: { pet: Pet; children: ReactNode }) {
  const ctx = useProfiles()
  const [asking, setAsking] = useState(false)
  if (!ctx || ctx.children.length < 2) {
    return (
      <span className="avatar" aria-hidden>
        {children}
      </span>
    )
  }
  return (
    <>
      <button className="avatar avatar-btn" aria-label="換人玩" data-testid="switch-person" onClick={() => setAsking(true)}>
        {children}
      </button>
      {asking &&
        createPortal(
          <Modal title="要換人玩嗎？" onClose={() => setAsking(false)}>
            <div className="switch-ask" data-testid="switch-confirm">
              <PetSprite pet={pet} mood={moodAt(pet, clockNow())} pose="cheer" className="switch-pet" />
              <p className="switch-say">{pet.name}揮揮手：要換人玩嗎？</p>
              <div className="switch-actions">
                <button className="btn primary" data-testid="switch-yes" onClick={ctx.switchPerson}>
                  要，換人
                </button>
                <button className="btn" data-testid="switch-no" onClick={() => setAsking(false)}>
                  不要，繼續玩
                </button>
              </div>
            </div>
          </Modal>,
          document.body,
        )}
    </>
  )
}
