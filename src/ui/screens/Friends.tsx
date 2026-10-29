import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { repo } from '../../db/repo'
import {
  collectionStep,
  FAMILIARITY_NAMES,
  familiarityOf,
  FRIEND_RIGHT_GOLD,
  FRIEND_RIGHT_SILVER,
  FRIEND_TABS,
  FRIENDS,
  type Familiarity,
  type Friend,
  type FriendStat,
  type FriendTab,
} from '../../domain/friends'
import { getChapter } from '../../learning/chapter'
import { sayEnglish, sayText } from '../../learning/speech'
import { useLearningSettings } from '../learningHooks'
import { Icon } from '../components/Icon'
import { ScreenHeader } from '../components/Header'
import { Modal } from '../components/Modal'
import { artEmoji } from './adventure/EnglishView'
import '../meta.css'
import './adventure/adventure-v7.css'
import { useSpeciesName } from '../species'

/** 沒有素材時的備援 emoji（朋友 id → emoji）；沒有的再退回 artEmoji（obj-*、food-*、decor-*） */
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

const emojiOf = (f: Friend): string => FRIEND_EMOJI[f.id] ?? f.emoji ?? (f.art ? artEmoji(f.art) : undefined) ?? '❔'

/** 朋友的圖：物件圖（缺圖用 emoji）、英文顏色的色塊、英文數字的大字 */
function FriendPic({ f, className }: { f: Friend; className: string }) {
  if (f.swatch) return <span className={`q7-fswatch ${className}`} style={{ background: f.swatch }} role="img" aria-label={f.name} />
  if (f.digit) return <span className={`q7-fdigit ${className}`} role="img" aria-label={f.name}>{f.digit}</span>
  return <Icon name={f.art ?? f.id} emoji={emojiOf(f)} alt={f.name} className={className} />
}

const FRAME: Record<Familiarity, string> = { 0: 'unknown', 1: 'met', 2: 'silver', 3: 'gold' }

/** 到下一級還差什麼（超級好朋友就沒有下一級） */
function nextGoal(level: Familiarity, st: FriendStat | undefined): string {
  const right = st?.right ?? 0
  if (level >= 3) return '已經是超級好朋友了！'
  if (level === 2) return `再答對 ${FRIEND_RIGHT_GOLD - right} 次，就是超級好朋友`
  return `再答對 ${FRIEND_RIGHT_SILVER - right} 次，就是好朋友`
}

/**
 * 圖鑑「我認識的朋友」：答題遇過的物件、動物、英文單字、生活與自然的圖，依分頁顯示。
 * 熟悉度三級：認識（遇過 1 次）→ 好朋友（答對 3 次，銀框）→ 超級好朋友（答對 10 次，金框閃光）。
 * 點一下放大並唸中文名字（有英文的接著唸英文）；每認識一批朋友，阿悟送一份禮物；章節挑戰徽章也放在這裡。
 */
export function FriendsScreen({ onBack }: { onBack: () => void }) {
  const petName = useSpeciesName()
  const { voiceOn } = useLearningSettings()
  const stats = useLiveQuery(() => repo.friendStats(), [], undefined)
  const badges = useLiveQuery(() => repo.listChapterBadges(), [], [])
  const [tab, setTab] = useState<FriendTab>('animal')
  const [view, setView] = useState<Friend | null>(null)
  if (!stats) return <main className="screen theme-lavender" data-testid="friends"><ScreenHeader title="我認識的朋友" onBack={onBack} /></main>

  const levelOf = (f: Friend) => familiarityOf(stats[f.id])
  const known = FRIENDS.filter((f) => levelOf(f) > 0)
  const n = known.length
  const step = collectionStep()
  const toNext = step - (n % step)
  const open = (f: Friend) => {
    if (levelOf(f) === 0) return
    setView(f)
    // 中文名字唸完，有英文的接著唸英文
    sayText(f.name, { enabled: voiceOn, onEnd: f.en ? () => sayEnglish(f.en as string, { enabled: voiceOn }) : undefined })
  }
  const shown = FRIENDS.filter((f) => f.tab === tab)
  return (
    <main className="screen friends theme-lavender" data-testid="friends">
      <ScreenHeader title="我認識的朋友" onBack={onBack} />
      <p className="friends-progress" data-testid="friends-progress">
        認識 {n} / {FRIENDS.length} 個朋友
        <small>{n >= FRIENDS.length ? '全部都認識了！' : `再認識 ${toNext} 個新朋友，${petName}就送你禮物`}</small>
      </p>
      {badges.length > 0 && (
        <ul className="q7-badges" data-testid="chapter-badges" aria-label="章節徽章">
          {badges.map((b) => (
            <li key={b.chapterId} className="q7-badge" data-chapter={b.chapterId}>
              <span aria-hidden>🏅</span>
              <b>{getChapter(b.chapterId)?.name ?? b.chapterId}</b>
              <small>挑戰徽章</small>
            </li>
          ))}
        </ul>
      )}
      <nav className="q7-ftabs" role="tablist" aria-label="圖鑑分頁">
        {FRIEND_TABS.map((t) => {
          const all = FRIENDS.filter((f) => f.tab === t.id)
          const got = all.filter((f) => levelOf(f) > 0).length
          return (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="q7-ftab" onClick={() => setTab(t.id)} data-testid={`friend-tab-${t.id}`}>
              <span>{t.name}</span>
              <small>{got}/{all.length}</small>
            </button>
          )
        })}
      </nav>
      <ul className="friends-grid" data-testid="friends-grid" data-tab={tab}>
        {shown.map((f) => {
          const level = levelOf(f)
          const isKnown = level > 0
          return (
            <li key={f.id}>
              <button
                className={`friend-cell q7-frame-${FRAME[level]} ${isKnown ? 'known' : 'unknown'}`}
                data-testid="friend"
                data-friend={f.id}
                data-known={isKnown}
                data-level={level}
                onClick={() => open(f)}
                aria-label={isKnown ? `${f.name}，${FAMILIARITY_NAMES[level]}，點一下聽名字` : '還沒認識的朋友'}
              >
                {level === 3 && <span className="q7-sparkle" aria-hidden>✦</span>}
                <FriendPic f={f} className="friend-img" />
                <span className="friend-name">{isKnown ? (f.tab === 'english' ? f.en : f.name) : '？'}</span>
                {level >= 2 && <span className="q7-level" aria-hidden>{level === 3 ? '超級好朋友' : '好朋友'}</span>}
              </button>
            </li>
          )
        })}
      </ul>
      {view && (
        <Modal title={view.name} onClose={() => setView(null)}>
          <div className="friend-view" data-testid="friend-view" data-level={levelOf(view)}>
            <button
              className={`friend-say q7-big-frame q7-frame-${FRAME[levelOf(view)]}`}
              style={{ background: 'none', border: 0, padding: 12 }}
              onClick={() => sayText(view.name, { enabled: voiceOn })}
              aria-label={`再聽一次：${view.name}`}
            >
              <FriendPic f={view} className="friend-big" />
            </button>
            <div className="friend-bigname">{view.name}</div>
            {view.en && (
              <button className="friend-en" style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit', minHeight: 56 }} onClick={() => sayEnglish(view.en!, { enabled: voiceOn })} aria-label={`聽英文：${view.en}`}>
                🔊 {view.en}
              </button>
            )}
            <p className="q7-familiar" data-testid="friend-level">
              <b>{FAMILIARITY_NAMES[levelOf(view)]}</b>
              <small>遇過 {stats[view.id]?.seen ?? 0} 次・答對 {stats[view.id]?.right ?? 0} 次</small>
              <small>{nextGoal(levelOf(view), stats[view.id])}</small>
            </p>
          </div>
          <button className="btn primary" onClick={() => setView(null)}>好</button>
        </Modal>
      )}
    </main>
  )
}
