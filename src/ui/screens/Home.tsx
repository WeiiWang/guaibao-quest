import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { localDateStr } from '../../domain/date'
import { balanceOf } from '../../domain/points'
import { flyStars } from '../fly'
import { SHOP_ITEMS } from '../../domain/constants'
import { moodAt } from '../../domain/pet'
import { visibleToday } from '../../domain/tasks'
import { Art } from '../components/Art'
import { Icon } from '../components/Icon'
import { RoomView } from '../components/RoomView'
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

  // 等資料到齊再一起渲染，避免版面晚出現把下方按鈕往下推
  if (!pet || !inventory || !shopItems || !placements || !settings || todo === undefined || pending === undefined || bal === undefined) return <div className="splash">載入中…</div>

  const qtyOf = (id: string) => inventory.find((v) => v.itemId === id)?.qty ?? 0
  const foods = shopItems.filter((i) => i.kind === 'food').map((f) => ({ item: f, qty: qtyOf(f.id) }))
  const order = (id: string) => SHOP_ITEMS.findIndex((i) => i.id === id)
  const ownedDecor = shopItems.filter((i) => i.kind === 'decor' && qtyOf(i.id) > 0).sort((a, b) => order(a.id) - order(b.id))
  foods.sort((a, b) => order(a.item.id) - order(b.item.id))

  const edit = !!initialEdit

  return (
    <main className="home theme-cream">
      <header className="home-top">
        <NameCapsule childName={childName} pet={pet} now={now} />
        <button
          className="lock-btn"
          onClick={() => go('parent')}
          aria-label={pending > 0 ? `家長入口，${pending} 項等待確認` : '家長入口'}
          title="家長入口"
        >
          <Icon name="ui-lock" emoji="🔒" size={34} />
          {pending > 0 && <b className="badge lock-badge">{pending}</b>}
        </button>
      </header>

      <div className="side-tools">
        <button className="mini-candy butter" onClick={() => go('workshop')}>
          <Icon name="ui-workshop" emoji="🔨" size={34} />
          <span>工坊</span>
        </button>
        <button className="mini-candy bubblegum" onClick={() => go('bag')}>
          <Icon name="ui-bag" emoji="🎒" size={34} />
          <span>背包</span>
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
        goShop={() => go('shop')}
      />

      <nav className="main-nav" aria-label="主選單">
        <button className="candy mint" onClick={() => go('map')}>
          <Icon name="ui-map" emoji="🗺️" className="candy-icon" />
          <span className="candy-label">冒險地圖</span>
        </button>
        <button className="candy butter" onClick={() => go('tasks')}>
          <Icon name="ui-tasks" emoji="📝" className="candy-icon" />
          <span className="candy-label">今日任務</span>
          {todo > 0 && <b className="badge">{todo}</b>}
        </button>
        <button className="candy peach" onClick={() => go('shop')}>
          <Icon name="ui-shop" emoji="🛒" className="candy-icon" />
          <span className="candy-label">商店</span>
        </button>
        <button className="candy lavender" onClick={() => go('coloring')}>
          <Icon name="ui-coloring" emoji="🎨" className="candy-icon" />
          <span className="candy-label">著色本</span>
        </button>
      </nav>
    </main>
  )
}
