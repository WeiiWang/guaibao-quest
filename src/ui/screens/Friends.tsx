import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { repo } from '../../db/repo'
import { FRIENDS, type Friend } from '../../domain/friends'
import { COLLECTION_STEP } from '../../domain/gifts'
import { sayText } from '../../learning/speech'
import { useLearningSettings } from '../learningHooks'
import { Icon } from '../components/Icon'
import { ScreenHeader } from '../components/Header'
import { Modal } from '../components/Modal'
import '../meta.css'

/** 沒有素材時的備援 emoji（物件 id → emoji） */
const FRIEND_EMOJI: Record<string, string> = {
  'obj-banana': '🍌',
  'obj-peach': '🍑',
  'obj-apple': '🍎',
  'obj-grape': '🍇',
  'obj-fish': '🐟',
  'obj-chick': '🐥',
  'obj-rabbit': '🐰',
  'obj-flower': '🌸',
  'obj-shell': '🐚',
  'obj-star': '⭐',
  'decor-car': '🚗',
  'decor-rocket': '🚀',
  'decor-ball': '⚽',
  'decor-dino': '🦖',
  'decor-piano': '🎹',
}

/** 圖鑑「我認識的朋友」：答題遇過的物件是彩色大圖，沒遇過的是剪影。點一下放大並唸名字；每認識 6 個，阿悟送一份禮物。 */
export function FriendsScreen({ onBack }: { onBack: () => void }) {
  const { voiceOn } = useLearningSettings()
  const known = useLiveQuery(() => repo.knownFriends(), [], undefined)
  const [view, setView] = useState<Friend | null>(null)
  if (!known) return <main className="screen theme-lavender" data-testid="friends"><ScreenHeader title="我認識的朋友" onBack={onBack} /></main>

  const n = FRIENDS.filter((f) => known.has(f.id)).length
  const toNext = COLLECTION_STEP - (n % COLLECTION_STEP)
  const open = (f: Friend) => {
    if (!known.has(f.id)) return
    setView(f)
    sayText(f.name, { enabled: voiceOn })
  }
  return (
    <main className="screen friends theme-lavender" data-testid="friends">
      <ScreenHeader title="我認識的朋友" onBack={onBack} />
      <p className="friends-progress" data-testid="friends-progress">
        認識 {n} / {FRIENDS.length} 個朋友
        <small>{n >= FRIENDS.length ? '全部都認識了！' : `再認識 ${toNext} 個新朋友，阿悟就送你禮物`}</small>
      </p>
      <ul className="friends-grid">
        {FRIENDS.map((f) => {
          const isKnown = known.has(f.id)
          return (
            <li key={f.id}>
              <button
                className={`friend-cell ${isKnown ? 'known' : 'unknown'}`}
                data-testid="friend"
                data-friend={f.id}
                data-known={isKnown}
                onClick={() => open(f)}
                aria-label={isKnown ? `${f.name}，點一下聽名字` : '還沒認識的朋友'}
              >
                <Icon name={f.id} emoji={FRIEND_EMOJI[f.id] ?? '❔'} alt={isKnown ? f.name : ''} className="friend-img" />
                <span className="friend-name">{isKnown ? f.name : '？'}</span>
              </button>
            </li>
          )
        })}
      </ul>
      {view && (
        <Modal title={view.name} onClose={() => setView(null)}>
          <div className="friend-view" data-testid="friend-view">
            <button className="friend-say" style={{ background: 'none', border: 0, padding: 0 }} onClick={() => sayText(view.name, { enabled: voiceOn })} aria-label={`再聽一次：${view.name}`}>
              <Icon name={view.id} emoji={FRIEND_EMOJI[view.id] ?? '❔'} alt={view.name} className="friend-big" />
            </button>
            <div className="friend-bigname">{view.name}</div>
            {view.en && <div className="friend-en">{view.en}</div>}
          </div>
          <button className="btn primary" onClick={() => setView(null)}>好</button>
        </Modal>
      )}
    </main>
  )
}
