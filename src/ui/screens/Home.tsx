import { useEffect, useRef, useState } from 'react'
import { repo } from '../../db/repo'
import { learningSettingsOf } from '../../learning/playtime'
import { sayText } from '../../learning/speech'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { localDateStr } from '../../domain/date'
import { favoriteFoodOf } from '../../domain/favorite'
import { balanceOf } from '../../domain/points'
import { flyStars } from '../fly'
import { SHOP_ITEMS } from '../../domain/constants'
import { moodAt } from '../../domain/pet'
import { visibleToday } from '../../domain/tasks'
import { Art } from '../components/Art'
import { Icon } from '../components/Icon'
import { RoomView } from '../components/RoomView'
import { TrickCelebrate } from '../components/TrickCelebrate'
import { isTrickId, type TrickId } from '../../domain/tricks'
import '../meta.css'
import { usePetFace } from '../components/PetSprite'
import { useBalance } from '../hooks'
import type { Screen } from '../App'
import type { Pet } from '../../domain/types'

interface Props {
  childName: string
  now: number
  go: (s: Screen['name'] | Screen) => void
  initialEdit?: boolean
}

/** 左上角頭像：用寵物臉，缺圖就顯示 emoji */
function Avatar({ pet, now }: { pet: Pet; now: number }) {
  const face = usePetFace(pet, moodAt(pet, now))
  return (
    <span className="avatar" aria-hidden>
      {face ? <Art name={face} className="avatar-img" /> : <span className="avatar-emoji">🐵</span>}
    </span>
  )
}

function NameCapsule({ childName, pet, now }: { childName: string; pet: Pet; now: number }) {
  const balance = useBalance()
  return (
    <div className="hello" aria-label={`${childName}，目前點數 ${balance}`}>
      <Avatar pet={pet} now={now} />
      <span className="hello-name">{childName}</span>
      <span className="hello-sep" aria-hidden />
      <span className="points-inline" data-points-chip>
        <Icon name="ui-star" emoji="⭐" size={30} className="chip-icon" />
        <span className="chip-num">{balance}</span>
      </span>
    </div>
  )
}

export function Home({ childName, now, go, initialEdit }: Props) {
  const pet = useLiveQuery(() => db.pets.get('pet'), [])
  const inventory = useLiveQuery(() => db.inventory.toArray(), [])
  const shopItems = useLiveQuery(() => db.shopItems.toArray(), [])
  const placements = useLiveQuery(() => db.placements.toArray(), [])
  const settings = useLiveQuery(() => db.settings.get('main'), [])
  const todo = useLiveQuery(async () => {
    const [tpls, insts] = await Promise.all([db.templates.toArray(), db.instances.toArray()])
    return visibleToday(tpls, insts, localDateStr(now)).filter((i) => i.status === 'todo' || i.status === 'rejected').length
  }, [now])
  const pending = useLiveQuery(() => db.instances.where('status').equals('pending').count(), [])
  const bal = useLiveQuery(async () => balanceOf(await db.ledger.toArray()), [])

  // 家長審核通過後回到首頁：新增的星星從「今日任務」飛進左上的點數膠囊
  useEffect(() => {
    if (bal === undefined) return
    const KEY = 'gq-points-seen'
    let seen: number | null = null
    try {
      const raw = localStorage.getItem(KEY)
      seen = raw === null ? null : Number(raw)
    } catch {
      /* 沒有 localStorage 就不播動畫 */
    }
    const save = () => {
      try {
        localStorage.setItem(KEY, String(bal))
      } catch {
        /* ignore */
      }
    }
    if (seen === null || !Number.isFinite(seen) || bal <= seen) {
      save()
      return
    }
    const id = window.setTimeout(() => {
      save()
      const from = document.querySelector('.candy.butter')?.getBoundingClientRect()
      if (!from) return
      void flyStars(Math.ceil((bal - seen) / 10), { x: from.left + from.width / 2, y: from.top + from.height / 2 })
    }, 600)
    return () => window.clearTimeout(id)
  }, [bal])

  // v5：每次進首頁（跨日也算）：今日小禮物 → 圖鑑滿 6 個的獎勵 → 阿悟學會新招。三件事都只是「發放並排進待展示佇列」，
  // 展示由 RoomView（禮物）與下面的新招慶祝負責，依序出現不會同時跳出
  const today = localDateStr(now)
  useEffect(() => {
    void (async () => {
      await repo.grantDailyGift(now)
      await repo.syncCollection(now)
      await repo.syncTricks()
    })()
    // now 每 15 秒變一次；只在日期變動時重新檢查
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today])

  // 表演請求：「表演」按鈕與新招慶祝時的示範都走這裡（RoomView 看到 seq 變了就請阿悟演）
  const [perform, setPerform] = useState<{ seq: number; trick: TrickId | 'random' }>({ seq: 0, trick: 'random' })
  const askPerform = (trick: TrickId | 'random') => setPerform((p) => ({ seq: p.seq + 1, trick }))
  // 新招慶祝：禮物都收下之後才跳；佈置模式（從背包直接進來）不打斷
  const pendingGifts = settings?.pendingGifts ?? []
  const celebrating = settings?.pendingTricks?.[0]
  const showTrick = !!celebrating && isTrickId(celebrating) && !initialEdit && !!pet && pendingGifts.length === 0
  const demoed = useRef<string | null>(null)
  useEffect(() => {
    if (!showTrick || !celebrating || !isTrickId(celebrating) || demoed.current === celebrating) return
    const t = window.setTimeout(() => {
      demoed.current = celebrating
      askPerform(celebrating)
    }, 1400)
    return () => window.clearTimeout(t)
  }, [showTrick, celebrating])

  // 首次進首頁的引導：冒險地圖按鈕亮起、手指指著它，語音「我們去冒險吧」（只出現一次）
  const showGuide = !!settings && !settings.homeGuideShown && !initialEdit
  const guideVoiceOn = learningSettingsOf(settings).voiceOn
  useEffect(() => {
    if (!showGuide) return
    sayText('我們去冒險吧', { enabled: guideVoiceOn })
    const t = window.setTimeout(() => void repo.markHomeGuideShown(), 15_000)
    return () => window.clearTimeout(t)
    // 只在引導開始時說一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showGuide])
  const nav = (s: Screen['name'] | Screen) => {
    if (showGuide) void repo.markHomeGuideShown()
    go(s)
  }

  // 等資料到齊再一起渲染，避免版面晚出現把下方按鈕往下推
  if (!pet || !inventory || !shopItems || !placements || !settings || todo === undefined || pending === undefined || bal === undefined) return <div className="splash">載入中…</div>

  const qtyOf = (id: string) => inventory.find((v) => v.itemId === id)?.qty ?? 0
  const foods = shopItems.filter((i) => i.kind === 'food').map((f) => ({ item: f, qty: qtyOf(f.id) }))
  const order = (id: string) => SHOP_ITEMS.findIndex((i) => i.id === id)
  const ownedDecor = shopItems.filter((i) => i.kind === 'decor' && qtyOf(i.id) > 0).sort((a, b) => order(a.id) - order(b.id))
  // 食物變 10 種：背包有的排前面，其餘照價格順序
  foods.sort((a, b) => Number(b.qty > 0) - Number(a.qty > 0) || order(a.item.id) - order(b.item.id))

  const edit = !!initialEdit
  const canPerform = pet.stage !== 'egg' && (pet.tricks?.length ?? 0) > 0

  return (
    <main className="home theme-cream">
      <header className="home-top">
        <NameCapsule childName={childName} pet={pet} now={now} />
        <button
          className="parent-lock"
          onClick={() => go('parent')}
          aria-label={pending > 0 ? `家長入口，${pending} 項等待確認` : '家長入口'}
          title="家長入口"
        >
          <Icon name="ui-lock" emoji="🔒" size={34} />
          {pending > 0 && <b className="badge lock-badge">{pending}</b>}
        </button>
      </header>

      <div className="side-tools">
        {canPerform && (
          <button className="mini-candy mint" onClick={() => askPerform('random')} data-testid="perform-btn" aria-label={`表演：叫${pet.name}表演一招`}>
            <span className="mini-emoji" aria-hidden>🎪</span>
            <span>表演</span>
          </button>
        )}
        <button className="mini-candy butter" onClick={() => go('workshop')} data-gift-target="material">
          <Icon name="ui-workshop" emoji="🔨" size={34} />
          <span>工坊</span>
        </button>
        <button className="mini-candy bubblegum" onClick={() => go('bag')} data-gift-target="bag">
          <Icon name="ui-bag" emoji="🎒" size={34} />
          <span>背包</span>
        </button>
        <button className="mini-candy lavender" onClick={() => go('friends')} data-testid="friends-btn">
          <span className="mini-emoji" aria-hidden>📖</span>
          <span>朋友</span>
        </button>
      </div>

      <RoomView
        pet={pet}
        now={now}
        foods={foods}
        ownedDecor={ownedDecor}
        placements={placements}
        feedHintShown={!!settings.feedHintShown}
        initialEdit={edit}
        childName={childName}
        favoriteFoodId={favoriteFoodOf(localDateStr(now))}
        goShop={() => go('shop')}
        gifts={pendingGifts}
        perform={perform}
      />
      {showTrick && celebrating && (
        <TrickCelebrate
          trickId={celebrating}
          petName={pet.name}
          voiceOn={guideVoiceOn}
          soundOn={learningSettingsOf(settings).soundOn}
          onReplay={() => askPerform(celebrating as TrickId)}
          onClose={() => {
            demoed.current = null
            void repo.popPendingTrick()
          }}
        />
      )}

      <nav className="main-nav" aria-label="主選單">
        <button className={`candy mint ${showGuide ? 'guide' : ''}`} onClick={() => nav('map')} data-testid="candy-map">
          <Icon name="ui-map" emoji="🗺️" className="candy-icon" />
          <span className="candy-label">冒險地圖</span>
          {showGuide && <span className="guide-hand" data-testid="home-guide" aria-hidden>👇</span>}
        </button>
        <button className="candy butter" onClick={() => nav('tasks')}>
          <Icon name="ui-tasks" emoji="📝" className="candy-icon" />
          <span className="candy-label">今日任務</span>
          {todo > 0 && <b className="badge">{todo}</b>}
        </button>
        <button className="candy peach" onClick={() => nav('shop')}>
          <Icon name="ui-shop" emoji="🛒" className="candy-icon" />
          <span className="candy-label">商店</span>
        </button>
        <button className="candy lavender" onClick={() => nav('coloring')}>
          <Icon name="ui-coloring" emoji="🎨" className="candy-icon" />
          <span className="candy-label">著色本</span>
        </button>
      </nav>
    </main>
  )
}
