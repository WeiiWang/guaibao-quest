import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { FOOD_EMOJI } from '../../../art/items'
import { now } from '../../../domain/clock'
import { localDateStr } from '../../../domain/date'
import {
  bossChange,
  bossChangeOptions,
  bossNeed,
  bossOffer,
  bossOrder,
  coinSum,
  countIn,
  isMarketGood,
  marketBill,
  marketCanAdd,
  marketChangeCoins,
  marketCoinsFor,
  marketExtras,
  marketLineDone,
  marketList,
  marketListDone,
  marketPay,
  marketPrice,
  marketShelf,
  type Coin,
  type MarketGood,
  type MarketItem,
} from '../../../domain/market'
import type { AgeBand } from '../../../domain/types'
import { playSound } from '../../../learning/audioEngine'
import { Icon } from '../../components/Icon'
import { Companion, type Pose } from '../adventure/Companion'
import type { GameRootProps } from '../playground/GameScreen'
import { GameShell, type GameProps } from '../playground/GameShell'
import { AgainButton, petHop, reducedMotion, useBand, useFinishLater, useTrackedSay } from '../playground/playU'
import { GestureHint, useTimers } from '../playground/vShared'
import { ArtOr, Check, CoinFace, bop, hitEl, scanBeep, useDragLayer, useFlyers, wiggle } from './yShared'
import '../playground/playU.css'
import './market.css'

// 超市：看圖的購物清單 → 把食物拖進購物車 → 收銀台嗶嗶 → 付玩具硬幣（投多會找零）。
// 扮演而已：買的東西不進背包、不扣任何東西；硬幣是玩具硬幣，不是星星。沒有倒數、投不夠就等著。
// v8.5 新玩具：toys >= 1 貨架和清單多四種不是食物的商品（氣球、皮球、牙刷、肥皂），下一回開始才套用；
//   toys >= 2 右上角多一顆切換按鈕，換成「當老闆」：寵物來買，孩子把東西拖過掃描器、收硬幣，6–7 歲要選對找回去的錢。

type Phase = 'shop' | 'extra' | 'scan' | 'pay' | 'paid' | 'change' | 'done'

/** 收銀台嗶一個的間隔 */
const SCAN_MS = 520
/** 付好錢到說「謝謝光臨」：讓最後一枚硬幣飛進去 */
const PAID_MS = 450
/** 找零的硬幣飛回來、寵物說完 */
const CHANGE_MS = 1900

const GOOD_EMOJI: Record<MarketGood, string> = { balloon: '🎈', ball: '⚽', toothbrush: '🪥', soap: '🧼' }

/** 貨架上一樣東西的圖：食物是 food-*，v8.5 的新商品是 ui-mkt-* */
function Item({ id }: { id: string }) {
  if (isMarketGood(id)) return <Icon name={`ui-mkt-${id}`} emoji={GOOD_EMOJI[id]} alt="" size="100%" />
  return <Icon name={`food-${id}`} emoji={FOOD_EMOJI[id]} alt="" size="100%" />
}

/** 購物車缺圖時的樣子 */
function CartArt() {
  return (
    <svg viewBox="0 0 120 100" aria-hidden>
      <path d="M8 14h14l6 10" fill="none" stroke="#8a5a44" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M24 22h88l-10 44H34z" fill="#ff7a7a" stroke="#d94f5c" strokeWidth="4" strokeLinejoin="round" />
      <path d="M44 24l3 40M64 24v40M84 24l-3 40M28 44h80" stroke="#ffd0d0" strokeWidth="3" />
      <path d="M34 66l-4 12h72" fill="none" stroke="#8a5a44" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="40" cy="88" r="8" fill="#5a4a3f" />
      <circle cx="92" cy="88" r="8" fill="#5a4a3f" />
    </svg>
  )
}

/** 收銀機缺圖時的樣子 */
function RegisterArt() {
  return (
    <svg viewBox="0 0 120 100" aria-hidden>
      <rect x="14" y="40" width="92" height="52" rx="14" fill="#8fd3ff" stroke="#4aa3d8" strokeWidth="4" />
      <rect x="30" y="10" width="60" height="30" rx="8" fill="#dff4ff" stroke="#4aa3d8" strokeWidth="4" />
      <circle cx="38" cy="58" r="6" fill="#ff8fab" />
      <circle cx="56" cy="58" r="6" fill="#ffd257" />
      <circle cx="74" cy="58" r="6" fill="#7ddc8a" />
      <circle cx="38" cy="76" r="6" fill="#b98cff" />
      <circle cx="56" cy="76" r="6" fill="#ff9f5e" />
      <rect x="68" y="70" width="26" height="12" rx="6" fill="#4aa3d8" />
    </svg>
  )
}

/** 價錢小牌：4–5 歲是一個點點、6–7 歲是數字、3 歲沒有 */
function PriceTag({ band, id }: { band: AgeBand; id: MarketItem }) {
  if (band === '3') return null
  return (
    <span className="mkt-tag" data-testid="mkt-tag" aria-label={band === '4-5' ? '1 元' : `${marketPrice(id)} 元`}>
      {band === '4-5' ? <i className="mkt-dot" data-on="1" /> : marketPrice(id)}
    </span>
  )
}

function MarketGame({ band, say: rawSay, finish, toys }: GameProps & { band: AgeBand }) {
  const { rootRef, say } = useTrackedSay(rawSay)
  const finishLater = useFinishLater(finish)
  const later = useTimers()
  const { fly, layer: flyLayer } = useFlyers()
  // 清單依日期輪替：進來那天算（玩到半夜也不會中途換）
  const [date] = useState(() => localDateStr(now()))
  const [round, setRound] = useState(0)
  // 這一回開始時有幾個新玩具：新商品下一回才上架，不在買到一半時換清單
  const [roundToys, setRoundToys] = useState(toys)
  const list = useMemo(() => marketList(date, round, band, roundToys), [date, round, band, roundToys])
  const shelf = marketShelf(band, roundToys)
  const coinKinds = marketCoinsFor(band)

  const [cart, setCart] = useState<MarketItem[]>([])
  // 真正的購物車（多指同時放時，第二根手指要看到第一根的結果，不能等 render）
  const cartNow = useRef<MarketItem[]>([])
  const [phase, setPhase] = useState<Phase>('shop')
  const phaseNow = useRef<Phase>('shop')
  const [scanned, setScanned] = useState(0)
  const [coins, setCoins] = useState<number[]>([])
  const coinsNow = useRef<number[]>([])
  const [bill, setBill] = useState(0)
  const [change, setChange] = useState<Coin[]>([])
  const [pose, setPose] = useState<Pose>('happy')
  const [acted, setActed] = useState(false)
  const [hint, setHint] = useState(false)
  const saidAdd = useRef(false)
  const cartEl = useRef<HTMLDivElement>(null)
  const regEl = useRef<HTMLButtonElement>(null)
  const slotEl = useRef<HTMLDivElement>(null)
  const petEl = useRef<HTMLDivElement>(null)
  const shelfEl = useRef<HTMLDivElement>(null)

  const go = (p: Phase) => {
    phaseNow.current = p
    setPhase(p)
  }
  const putCart = (c: MarketItem[]) => {
    cartNow.current = c
    setCart(c)
  }
  const laugh = () => {
    setPose('laugh')
    later(() => setPose((p) => (p === 'laugh' ? 'happy' : p)), 600)
  }

  // ---------- 放進購物車 ----------
  const addToCart = (id: MarketItem): boolean => {
    if (phaseNow.current !== 'shop') return false
    const before = cartNow.current
    if (!marketCanAdd(band, before, id)) {
      // 放不下：車子晃一下，東西回貨架（不是做錯）
      wiggle(cartEl.current)
      playSound('drop')
      return false
    }
    const after = [...before, id]
    putCart(after)
    setActed(true)
    setHint(false)
    playSound('pop')
    bop(cartEl.current)
    if (!saidAdd.current) {
      saidAdd.current = true
      say('pet.play.market.add')
    }
    const line = list.find((l) => l.id === id)
    if (line && !marketLineDone(line, before) && marketLineDone(line, after)) {
      playSound('sparkle')
      petHop(petEl.current)
    }
    if (!marketListDone(list, before) && marketListDone(list, after)) {
      playSound('correct')
      setPose('cheer')
    } else laugh()
    return true
  }

  const drag = useDragLayer<MarketItem>({
    enabled: () => phaseNow.current === 'shop',
    render: (id) => <Item id={id} />,
    onTap: (id, el) => {
      if (band === '3') {
        // 3 歲點了就飛進車裡
        if (addToCart(id)) fly(<Item id={id} />, el, cartEl.current)
        return
      }
      // 4 歲以上要拖：東西跳一下，手勢再示範一次
      wiggle(el.firstElementChild)
      playSound('tap')
      setHint(true)
    },
    onDrop: (id, x, y) => hitEl(cartEl.current, x, y) && addToCart(id),
  })

  // ---------- 結帳 ----------
  const startScan = (items: MarketItem[]) => {
    putCart(items)
    setBill(marketBill(band, items))
    setScanned(0)
    go('scan')
    setPose('happy')
    const gap = reducedMotion() ? 160 : SCAN_MS
    const beep = (n: number) => {
      setScanned(n)
      // 刷條碼的嗶一聲（合成音；不能出聲時退回原本的點擊聲）
      if (!scanBeep()) playSound('tap')
      if (n < items.length) later(() => beep(n + 1), gap)
      else
        later(() => {
          go('pay')
          say('pet.play.market.pay')
        }, gap)
    }
    later(() => beep(1), gap)
  }

  const checkout = () => {
    if (phaseNow.current !== 'shop') return
    const items = cartNow.current
    if (!items.length) {
      // 車子是空的：車子晃一下、示範拖東西
      wiggle(cartEl.current)
      wiggle(regEl.current)
      setHint(true)
      return
    }
    drag.clear()
    playSound('pop')
    if (marketExtras(list, items).length) {
      go('extra')
      setPose('think')
      say('pet.play.market.extra')
      return
    }
    startScan(items)
  }

  const putBack = () => {
    if (phaseNow.current !== 'extra') return
    const extras = new Set(marketExtras(list, cartNow.current))
    const kept = cartNow.current.filter((_, i) => !extras.has(i))
    playSound('whoosh')
    if (!kept.length) {
      // 全部都放回去了：回去買清單上的
      putCart([])
      go('shop')
      setPose('happy')
      return
    }
    startScan(kept)
  }
  const keep = () => {
    if (phaseNow.current !== 'extra') return
    playSound('pop')
    laugh()
    startScan(cartNow.current)
  }

  // ---------- 付錢 ----------
  const done = () => {
    go('done')
    setPose('cheer')
    playSound('correct')
    say('pet.play.market.done')
    finishLater()
  }

  const insert = (c: Coin, el: HTMLElement) => {
    if (phaseNow.current !== 'pay') return
    const next = [...coinsNow.current, c]
    coinsNow.current = next
    setCoins(next)
    playSound('coin')
    fly(<CoinFace value={c} />, el, slotEl.current, 64)
    const st = marketPay(band, bill, next)
    if (!st.enough) return
    if (st.change > 0) {
      go('change')
      later(() => {
        setChange(marketChangeCoins(st.change))
        setPose('laugh')
        playSound('coin')
        say('pet.play.market.change')
      }, PAID_MS)
      later(done, PAID_MS + CHANGE_MS)
      return
    }
    go('paid')
    later(done, PAID_MS)
  }

  const again = () => {
    setRound((r) => r + 1)
    // 新玩具在這裡才套用：收下新玩具卡之後的下一回
    setRoundToys(toys)
    putCart([])
    coinsNow.current = []
    setCoins([])
    setChange([])
    setScanned(0)
    setBill(0)
    setPose('happy')
    setHint(false)
    saidAdd.current = false
    drag.clear()
    go('shop')
    playSound('pop')
    say('pet.play.market.intro')
  }

  const shelfFirst = useCallback(() => shelfEl.current?.querySelector('button') ?? null, [])
  const cartTarget = useCallback(() => cartEl.current, [])
  const coinFirst = useCallback(() => rootRef.current?.querySelector('[data-testid^=mkt-coin-]') ?? null, [rootRef])
  const slotTarget = useCallback(() => slotEl.current, [])

  const listDone = marketListDone(list, cart)
  const extras = phase === 'extra' ? new Set(marketExtras(list, cart)) : new Set<number>()
  const checking = phase !== 'shop'
  const paid = coinSum(coins)
  const scannedSum = cart.slice(0, scanned).reduce((s, id) => s + marketPrice(id), 0)
  const shownBill = phase === 'scan' ? (band === '6-7' ? scannedSum : scanned) : bill
  const changeSum = coinSum(change)

  return (
    <div
      ref={rootRef}
      className="mkt"
      data-testid="market"
      data-mode="shop"
      data-toggle={toys >= 2 ? '1' : '0'}
      data-band={band}
      data-phase={phase}
      data-round={round}
      data-list={list.map((l) => `${l.id}:${l.qty}`).join(',')}
      data-cart={cart.join(',')}
      data-bill={bill}
      data-paid={paid}
      data-change={changeSum}
    >
      {/* 購物清單：只有圖 */}
      <div className="mkt-list" data-testid="mkt-list" aria-label="購物清單">
        <span className="mkt-list-pin" aria-hidden />
        {list.map((l) => {
          const got = marketLineDone(l, cart)
          return (
            <div key={l.id} className="mkt-line" data-testid="mkt-line" data-id={l.id} data-qty={l.qty} data-done={got ? '1' : '0'} aria-label={`${l.qty} 個`}>
              <span className="mkt-line-pics">
                {Array.from({ length: l.qty }, (_, i) => (
                  <span key={i} className="mkt-line-pic">
                    <Item id={l.id} />
                  </span>
                ))}
              </span>
              <span className="mkt-line-have" aria-hidden>
                {Array.from({ length: l.qty }, (_, i) => (
                  <i key={i} data-on={i < countIn(cart, l.id) ? '1' : '0'} />
                ))}
              </span>
              <Check on={got} />
            </div>
          )
        })}
      </div>

      <div className="mkt-pet" ref={petEl} data-testid="mkt-pet">
        <Companion pose={pose} size="100%" />
      </div>

      {!checking && (
        <>
          <div className="mkt-shelf" ref={shelfEl} data-testid="mkt-shelf" data-count={shelf.length}>
            {shelf.map((id) => (
              <button key={id} type="button" className="mkt-food" data-testid={`mkt-food-${id}`} aria-label={id} {...drag.bind(id)}>
                <span className="mkt-food-pic">
                  <Item id={id} />
                </span>
                <PriceTag band={band} id={id} />
              </button>
            ))}
          </div>

          <div className="mkt-cart" ref={cartEl} data-testid="mkt-cart" data-count={cart.length}>
            <ArtOr name="ui-mkt-cart" fallback={<CartArt />} className="mkt-cart-art" />
            <span className="mkt-cart-pile">
              {cart.map((id, i) => (
                <span key={i} className="mkt-cart-item" data-testid="mkt-cart-item" style={{ '--i': i } as CSSProperties}>
                  <Item id={id} />
                </span>
              ))}
            </span>
          </div>

          <button type="button" className="mkt-reg" ref={regEl} onClick={checkout} data-testid="mkt-register" data-ready={listDone ? '1' : '0'} aria-label="去結帳">
            <span className="mkt-reg-glow" aria-hidden />
            <ArtOr name="ui-mkt-register" fallback={<RegisterArt />} className="mkt-reg-art" />
          </button>
        </>
      )}

      {phase === 'extra' && (
        <div className="mkt-counter mkt-extra" data-testid="mkt-extra">
          <div className="mkt-extra-items">
            {cart.map((id, i) =>
              extras.has(i) ? (
                <span key={i} className="mkt-extra-item" data-testid="mkt-extra-item">
                  <Item id={id} />
                </span>
              ) : null,
            )}
          </div>
          <div className="mkt-extra-btns">
            <button type="button" className="mkt-choice mkt-choice-back" onClick={putBack} data-testid="mkt-extra-back" aria-label="放回去">
              <svg viewBox="0 0 48 48" width="52" height="52" aria-hidden>
                <path d="M18 12L8 22l10 10" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M9 22h20a11 11 0 0 1 0 22h-6" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
              </svg>
              <span>放回去</span>
            </button>
            <button type="button" className="mkt-choice mkt-choice-keep" onClick={keep} data-testid="mkt-extra-keep" aria-label="也要買">
              <svg viewBox="0 0 48 48" width="52" height="52" aria-hidden>
                <path d="M24 41S6 30 6 17a9 9 0 0 1 18-3 9 9 0 0 1 18 3c0 13-18 24-18 24z" fill="currentColor" />
              </svg>
              <span>也要買</span>
            </button>
          </div>
        </div>
      )}

      {checking && phase !== 'extra' && (
        <div className="mkt-counter" data-testid="mkt-counter">
          <div className="mkt-belt" data-testid="mkt-belt">
            <span className="mkt-scanner" key={scanned} data-on={phase === 'scan' && scanned > 0 ? '1' : '0'} aria-hidden />
            {cart.map((id, i) => (
              <span key={i} className="mkt-belt-item" data-testid="mkt-belt-item" data-scanned={i < scanned ? '1' : '0'}>
                <span className="mkt-belt-pic">
                  <Item id={id} />
                </span>
                {i < scanned && <PriceTag band={band} id={id} />}
              </span>
            ))}
          </div>

          <div className="mkt-payrow">
            <div className="mkt-till">
              {/* 要付多少：3 歲一枚硬幣的影子、4–5 歲點點、6–7 歲數字 */}
              <div className="mkt-display" data-testid="mkt-display" aria-label={band === '3' ? '投一枚硬幣' : `${shownBill} 元`}>
                {band === '3' && <span className="mkt-display-coin" data-on={coins.length ? '1' : '0'} />}
                {band === '4-5' &&
                  Array.from({ length: shownBill }, (_, i) => <i key={i} className="mkt-dot mkt-bill-dot" data-testid="mkt-bill-dot" data-on={i < coins.length ? '1' : '0'} />)}
                {band === '6-7' && (
                  <span className="mkt-bill-num" data-testid="mkt-bill-num">
                    {shownBill}
                  </span>
                )}
              </div>
              <div className="mkt-slot" ref={slotEl} data-testid="mkt-slot">
                <ArtOr name="ui-mkt-register" fallback={<RegisterArt />} className="mkt-slot-art" />
              </div>
              <div className="mkt-paid" data-testid="mkt-paid" aria-label={`付了 ${paid} 元`}>
                {coins.map((c, i) => (
                  <span key={i} className="mkt-paid-coin" data-testid="mkt-paid-coin">
                    <CoinFace value={c} />
                  </span>
                ))}
                {band === '6-7' && coins.length > 0 && <b className="mkt-paid-sum">付了 {paid}</b>}
              </div>
            </div>

            {(phase === 'pay' || phase === 'scan') && (
              <div className="mkt-coins" data-testid="mkt-coins" data-ready={phase === 'pay' ? '1' : '0'}>
                {coinKinds.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="mkt-coin"
                    data-testid={`mkt-coin-${c}`}
                    aria-label={`${c} 元硬幣`}
                    disabled={phase !== 'pay'}
                    onPointerDown={(e) => {
                      e.preventDefault()
                      insert(c, e.currentTarget)
                    }}
                    onClick={(e) => {
                      if (e.detail === 0) insert(c, e.currentTarget)
                    }}
                  >
                    <CoinFace value={c} />
                  </button>
                ))}
              </div>
            )}

            {change.length > 0 && (
              <div className="mkt-change" data-testid="mkt-change" aria-label={`找你 ${changeSum} 元`}>
                <span className="mkt-change-coins">
                  {change.map((c, i) => (
                    <span key={i} className="mkt-change-coin" data-testid="mkt-change-coin" style={{ '--i': i } as CSSProperties}>
                      <CoinFace value={c} />
                    </span>
                  ))}
                </span>
                <b>找你 {changeSum}</b>
              </div>
            )}
          </div>

          {phase === 'done' && (
            <div className="mkt-again">
              <AgainButton onClick={again} />
            </div>
          )}
        </div>
      )}

      {phase === 'shop' && (!acted || hint) && <GestureHint from={shelfFirst} to={cartTarget} />}
      {phase === 'pay' && coins.length === 0 && (
        <GestureHint from={coinFirst} to={slotTarget} />
      )}
      {drag.layer}
      {flyLayer}
    </div>
  )
}

// ======================= v8.5 當老闆 =======================

/** scan 把東西拖過掃描器 → pay 收寵物的硬幣 → change 找錢（只有 6–7 歲）→ done */
type BossPhase = 'scan' | 'pay' | 'change' | 'done'

/** 全部刷完到寵物拿出硬幣 */
const BOSS_PAY_MS = 650
/** 找對錢、硬幣飛給寵物之後說謝謝 */
const BOSS_THANKS_MS = 550

/**
 * 當老闆：寵物來買東西，東西已經在櫃台上。孩子把每一樣拖過掃描器（嗶），再把寵物給的硬幣收進收銀機。
 * 3 歲收一枚就好；4–5 歲價錢是點點，一枚對一個點，數到剛好就夠；6–7 歲寵物多給，要選對找回去的硬幣。
 * 選錯只是寵物搖頭、可以再選。沒有倒數、不扣任何東西。
 */
function BossGame({ band, say: rawSay, finish, toys }: GameProps & { band: AgeBand }) {
  const { rootRef, say } = useTrackedSay(rawSay)
  const finishLater = useFinishLater(finish)
  const later = useTimers()
  const { fly, layer: flyLayer } = useFlyers()
  const [date] = useState(() => localDateStr(now()))
  const [round, setRound] = useState(0)
  const [roundToys, setRoundToys] = useState(toys)
  const items = useMemo(() => bossOrder(date, round, band, roundToys), [date, round, band, roundToys])
  const bill = marketBill(band, items)
  const offer = useMemo(() => bossOffer(band, bill), [band, bill])
  const need = bossNeed(band, bill)
  const change = bossChange(band, bill)
  const options = useMemo(() => bossChangeOptions(change, round), [change, round])

  const [phase, setPhase] = useState<BossPhase>('scan')
  const phaseNow = useRef<BossPhase>('scan')
  /** 刷過的東西（items 的索引，照刷的順序） */
  const [scanned, setScanned] = useState<number[]>([])
  const scannedNow = useRef<number[]>([])
  /** 收下的硬幣（offer 的索引） */
  const [taken, setTaken] = useState<number[]>([])
  const takenNow = useRef<number[]>([])
  /** 找回去的錢（選對之後） */
  const [given, setGiven] = useState<number | null>(null)
  const [pose, setPose] = useState<Pose>('happy')
  const [hint, setHint] = useState(false)
  const scanEl = useRef<HTMLDivElement>(null)
  const beltEl = useRef<HTMLDivElement>(null)
  const bagEl = useRef<HTMLDivElement>(null)
  const slotEl = useRef<HTMLDivElement>(null)
  const petEl = useRef<HTMLDivElement>(null)

  const go = (p: BossPhase) => {
    phaseNow.current = p
    setPhase(p)
  }

  // 一換成當老闆，寵物就說要買什麼
  useEffect(() => {
    later(() => say('pet.play.market.boss.want'), 300)
  }, [later, say])

  // ---------- 刷條碼 ----------
  const scan = (i: number): boolean => {
    if (phaseNow.current !== 'scan' || scannedNow.current.includes(i)) return false
    const next = [...scannedNow.current, i]
    scannedNow.current = next
    setScanned(next)
    setHint(false)
    if (!scanBeep()) playSound('tap')
    bop(scanEl.current)
    if (next.length >= items.length)
      later(() => {
        go('pay')
        playSound('coin')
        say('pet.play.market.boss.pay')
      }, reducedMotion() ? 200 : BOSS_PAY_MS)
    return true
  }

  /** 放開的位置算不算「拖過掃描器」：在掃描器上或它的右邊（袋子那一側），上下不要離輸送帶太遠 */
  const pastScanner = (x: number, y: number): boolean => {
    const s = scanEl.current?.getBoundingClientRect()
    const b = beltEl.current?.getBoundingClientRect()
    if (!s || !b) return false
    return x >= s.left - 36 && y >= b.top - 60 && y <= b.bottom + 60
  }

  const drag = useDragLayer<number>({
    enabled: (i) => phaseNow.current === 'scan' && !scannedNow.current.includes(i),
    render: (i) => <Item id={items[i]} />,
    onTap: (i, el) => {
      if (band === '3') {
        // 3 歲點了就自己滑過掃描器
        if (scan(i)) fly(<Item id={items[i]} />, el, bagEl.current)
        return
      }
      // 4 歲以上要拖：東西跳一下，手勢再示範一次
      wiggle(el.firstElementChild)
      playSound('tap')
      setHint(true)
    },
    onDrop: (i, x, y) => pastScanner(x, y) && scan(i),
  })

  // ---------- 收錢、找錢 ----------
  const done = () => {
    go('done')
    setPose('cheer')
    playSound('correct')
    petHop(petEl.current)
    say('pet.play.market.boss.thanks')
    finishLater()
  }

  const take = (i: number, el: HTMLElement) => {
    if (phaseNow.current !== 'pay' || takenNow.current.includes(i) || takenNow.current.length >= need) return
    const next = [...takenNow.current, i]
    takenNow.current = next
    setTaken(next)
    playSound('coin')
    fly(<CoinFace value={offer[i]} />, el, slotEl.current, 64)
    if (next.length < need) return
    if (change > 0) {
      // 寵物多給了：要找錢
      go('change')
      setPose('think')
      later(() => say('pet.play.market.boss.change'), PAID_MS)
      return
    }
    go('change')
    later(done, PAID_MS)
  }

  const choose = (amount: number, el: HTMLElement) => {
    if (phaseNow.current !== 'change' || given !== null || change <= 0) return
    if (amount !== change) {
      // 選錯：寵物搖搖頭，可以再選（不扣任何東西）
      wiggle(petEl.current)
      wiggle(el)
      playSound('pop')
      return
    }
    setGiven(amount)
    setPose('happy')
    playSound('coin')
    fly(<CoinFace value={marketChangeCoins(amount)[0]} />, el, petEl.current, 64)
    later(done, reducedMotion() ? 200 : BOSS_THANKS_MS)
  }

  const again = () => {
    setRound((r) => r + 1)
    setRoundToys(toys)
    scannedNow.current = []
    setScanned([])
    takenNow.current = []
    setTaken([])
    setGiven(null)
    setPose('happy')
    setHint(false)
    drag.clear()
    go('scan')
    playSound('pop')
    say('pet.play.market.boss.want')
  }

  const itemFirst = useCallback(() => rootRef.current?.querySelector('[data-testid=mkt-boss-item]') ?? null, [rootRef])
  const scanTarget = useCallback(() => scanEl.current, [])
  const coinFirst = useCallback(() => rootRef.current?.querySelector('[data-testid=mkt-give-coin]') ?? null, [rootRef])
  const slotTarget = useCallback(() => slotEl.current, [])

  const got = coinSum(taken.map((i) => offer[i]))
  const scannedSum = scanned.reduce((s, i) => s + marketPrice(items[i]), 0)
  const paying = phase === 'pay'

  return (
    <div
      ref={rootRef}
      className="mkt mkt-boss"
      data-testid="market"
      data-mode="boss"
      data-toggle="1"
      data-band={band}
      data-phase={phase}
      data-round={round}
      data-order={items.join(',')}
      data-scanned={scanned.length}
      data-bill={bill}
      data-need={need}
      data-got={got}
      data-change={change}
      data-given={given ?? ''}
    >
      {/* 寵物拿出來的硬幣：一顆對話泡泡，點硬幣就收進收銀機 */}
      <div className="mkt-hand" data-testid="mkt-hand" data-on={paying ? '1' : '0'} aria-label="寵物給的硬幣">
        {paying &&
          offer.map((c, i) => (
            <button
              key={i}
              type="button"
              className="mkt-coin mkt-give"
              data-testid="mkt-give-coin"
              data-value={c}
              data-taken={taken.includes(i) ? '1' : '0'}
              aria-label={`${c} 元硬幣`}
              disabled={taken.includes(i)}
              onPointerDown={(e) => {
                e.preventDefault()
                take(i, e.currentTarget)
              }}
              onClick={(e) => {
                if (e.detail === 0) take(i, e.currentTarget)
              }}
            >
              <CoinFace value={c} />
            </button>
          ))}
      </div>

      <div className="mkt-pet" ref={petEl} data-testid="mkt-pet">
        <Companion pose={pose} size="100%" />
      </div>

      <div className="mkt-counter mkt-bcounter" data-testid="mkt-counter">
        <div className="mkt-belt mkt-bbelt" ref={beltEl} data-testid="mkt-belt">
          <div className="mkt-bwait" data-testid="mkt-wait">
            {items.map((id, i) =>
              scanned.includes(i) ? null : (
                <button key={i} type="button" className="mkt-bitem" data-testid="mkt-boss-item" data-id={id} aria-label={id} {...drag.bind(i)}>
                  <span className="mkt-belt-pic">
                    <Item id={id} />
                  </span>
                </button>
              ),
            )}
          </div>
          <div className="mkt-bscan" ref={scanEl} data-testid="mkt-scan" aria-hidden>
            <span className="mkt-bscan-light" key={scanned.length} data-on={scanned.length > 0 ? '1' : '0'} />
          </div>
          <div className="mkt-bbag" ref={bagEl} data-testid="mkt-bag">
            {scanned.map((i) => (
              <span key={i} className="mkt-belt-item" data-testid="mkt-belt-item" data-scanned="1">
                <span className="mkt-belt-pic">
                  <Item id={items[i]} />
                </span>
                <PriceTag band={band} id={items[i]} />
              </span>
            ))}
          </div>
        </div>

        <div className="mkt-payrow">
          <div className="mkt-till">
            {/* 要收多少：3 歲一枚硬幣的影子、4–5 歲點點（刷一樣多一個點）、6–7 歲數字 */}
            <div className="mkt-display" data-testid="mkt-display" aria-label={band === '3' ? '收一枚硬幣' : `${band === '6-7' ? scannedSum : scanned.length} 元`}>
              {band === '3' && <span className="mkt-display-coin" data-on={taken.length ? '1' : '0'} />}
              {band === '4-5' && scanned.map((i, k) => <i key={i} className="mkt-dot mkt-bill-dot" data-testid="mkt-bill-dot" data-on={k < taken.length ? '1' : '0'} />)}
              {band === '6-7' && (
                <span className="mkt-bill-num" data-testid="mkt-bill-num">
                  {scannedSum}
                </span>
              )}
            </div>
            <div className="mkt-slot" ref={slotEl} data-testid="mkt-slot">
              <ArtOr name="ui-mkt-register" fallback={<RegisterArt />} className="mkt-slot-art" />
            </div>
            <div className="mkt-paid" data-testid="mkt-paid" aria-label={`收了 ${got} 元`}>
              {taken.map((i) => (
                <span key={i} className="mkt-paid-coin" data-testid="mkt-paid-coin">
                  <CoinFace value={offer[i]} />
                </span>
              ))}
              {band === '6-7' && taken.length > 0 && <b className="mkt-paid-sum">收了 {got}</b>}
            </div>
          </div>

          {phase === 'change' && change > 0 && given === null && (
            <div className="mkt-opts" data-testid="mkt-opts" aria-label="要找多少錢">
              {options.map((a) => (
                <button key={a} type="button" className="mkt-opt" data-testid="mkt-opt" data-amount={a} aria-label={`找 ${a} 元`} onClick={(e) => choose(a, e.currentTarget)}>
                  {marketChangeCoins(a).map((c, k) => (
                    <span key={k} className="mkt-opt-coin">
                      <CoinFace value={c} />
                    </span>
                  ))}
                </button>
              ))}
            </div>
          )}

          {given !== null && (
            <div className="mkt-change" data-testid="mkt-change" aria-label={`找 ${given} 元`}>
              <span className="mkt-change-coins">
                {marketChangeCoins(given).map((c, i) => (
                  <span key={i} className="mkt-change-coin" data-testid="mkt-change-coin" style={{ '--i': i } as CSSProperties}>
                    <CoinFace value={c} />
                  </span>
                ))}
              </span>
              <b>找 {given}</b>
            </div>
          )}
        </div>

        {phase === 'done' && (
          <div className="mkt-again">
            <AgainButton onClick={again} />
          </div>
        )}
      </div>

      {phase === 'scan' && (scanned.length === 0 || hint) && <GestureHint from={itemFirst} to={scanTarget} />}
      {paying && taken.length === 0 && <GestureHint from={coinFirst} to={slotTarget} />}
      {drag.layer}
      {flyLayer}
    </div>
  )
}

/** 切換按鈕上的小箭頭（換一換） */
function SwapBadge() {
  return (
    <span className="mkt-mode-swap" aria-hidden>
      <svg viewBox="0 0 24 24" width="100%" height="100%">
        <path d="M5 9h12l-3.500-3.500M19 15H7l3.500 3.500" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

/** 超市的兩種玩法：自己買（shop）與當老闆（boss，toys >= 2 才有）。切換按鈕只有圖：收銀機 = 換我當老闆、購物車 = 換我去買 */
function MarketModes(p: GameProps & { band: AgeBand }) {
  const [mode, setMode] = useState<'shop' | 'boss'>('shop')
  const canBoss = p.toys >= 2
  const boss = canBoss && mode === 'boss'
  return (
    <>
      {boss ? <BossGame {...p} /> : <MarketGame {...p} />}
      {canBoss && (
        <button
          type="button"
          className="mkt-mode"
          data-testid="mkt-mode"
          data-mode={boss ? 'boss' : 'shop'}
          aria-label={boss ? '換我去買東西' : '換我當老闆'}
          onClick={() => {
            playSound('pop')
            setMode(boss ? 'shop' : 'boss')
          }}
        >
          {boss ? <ArtOr name="ui-mkt-cart" fallback={<CartArt />} className="mkt-mode-art" /> : <ArtOr name="ui-mkt-register" fallback={<RegisterArt />} className="mkt-mode-art" />}
          <SwapBadge />
        </button>
      )}
    </>
  )
}

export default function Market({ onExit }: GameRootProps) {
  const band = useBand()
  return (
    <GameShell id="market" scene="scene-town-market" intro="pet.play.market.intro" onExit={onExit}>
      {(p) => <MarketModes key={band} band={band} {...p} />}
    </GameShell>
  )
}
