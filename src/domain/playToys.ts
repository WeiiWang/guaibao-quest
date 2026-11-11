import type { PlayGameId } from './playground'

// v8.5 越玩越多：每個遊戲有 2 個「新玩具」，只看玩完幾次（不看分數、不看對錯、不靠機率）。純函式。

/** 玩完第幾次得到第 1、2 個新玩具 */
export const TOY_AT = [1, 3] as const
/** 玩完第幾次格子戴皇冠（純裝飾） */
export const CROWN_AT = 6

export interface PlayToy {
  /** 遊戲內的名稱（跟規格表一樣），完整 id 是 `<game>.<id>` */
  id: string
  label: string
  /** 3D 圖：public/art/<icon>.png */
  icon: string
  /** 圖還沒生好時的退路 */
  emoji: string
  /** 寵物介紹這個玩具的台詞 key（lines.ts） */
  line: string
}

const toy = (game: string, id: string, label: string, icon: string, emoji: string): PlayToy => ({ id, label, icon, emoji, line: `pet.toy.${game}.${id}` })

/** 學我說話沒有新玩具（不鼓勵為了獎勵開麥克風） */
export const PLAY_TOYS: Partial<Record<PlayGameId, readonly [PlayToy, PlayToy]>> = {
  bubbles: [toy('bubbles', 'animals', '動物泡泡', 'obj-bear', '🐻'), toy('bubbles', 'wand', '泡泡棒', 'ui-bubble-wand', '🪄')],
  catch: [toy('catch', 'gold', '金色水果', 'obj-strawberry', '🍓'), toy('catch', 'rain', '水果雨', 'ui-play-basket', '🧺')],
  memory: [toy('memory', 'animals', '動物牌', 'obj-rabbit', '🐰'), toy('memory', 'peek', '魔法棒', 'ui-magic-wand', '🪄')],
  hide: [toy('hide', 'swap', '換你藏', 'ui-hide-ball', '⚽'), toy('hide', 'night', '手電筒', 'ui-hide-flashlight', '🔦')],
  music: [toy('music', 'songs', '新歌', 'ui-game-music', '🎵'), toy('music', 'voices', '喵喵琴', 'ui-music-cat', '🐱')],
  bath: [toy('bath', 'bomb', '沐浴球', 'ui-bath-bomb', '🔮'), toy('bath', 'foamhat', '泡泡造型', 'ui-play-sponge', '🫧')],
  bakery: [toy('bakery', 'bases', '甜甜圈', 'ui-base-donut', '🍩'), toy('bakery', 'piping', '擠花袋', 'ui-top-piping', '🍦')],
  garden: [toy('garden', 'sprinkler', '灑水器', 'ui-garden-sprinkler', '💦'), toy('garden', 'butterfly', '蝴蝶', 'ui-garden-butterfly', '🦋')],
  doctor: [toy('doctor', 'ailments', '冰枕', 'ui-doc-icepack', '🧊'), toy('doctor', 'xray', '照骨頭', 'ui-doc-xray', '🦴')],
  bedtime: [toy('bedtime', 'doll', '抱抱玩偶', 'ui-bed-doll-bear', '🧸'), toy('bedtime', 'projector', '夜燈投影', 'ui-bed-lamp', '🌟')],
  market: [toy('market', 'goods', '新商品', 'ui-mkt-balloon', '🎈'), toy('market', 'boss', '當老闆', 'ui-mkt-register', '🧾')],
  juice: [toy('juice', 'fruits', '草莓和橘子', 'obj-orange', '🍊'), toy('juice', 'deco', '小雨傘', 'ui-juice-umbrella', '⛱️')],
  blocks: [toy('blocks', 'parts', '新積木', 'ui-blk-wheel', '🛞'), toy('blocks', 'tenants', '小住戶', 'obj-chick', '🐥')],
  puzzle: [toy('puzzle', 'pics', '新圖片', 'ui-town-puzzle', '🖼️'), toy('puzzle', 'jigsaw', '拼圖形狀', 'ui-town-puzzle', '🧩')],
  drive: [toy('drive', 'cars', '消防車', 'ui-car-fire-top', '🚒'), toy('drive', 'wash', '洗車站', 'ui-drive-wash', '🫧')],
  photo: [toy('photo', 'friends', '動物朋友', 'obj-cow', '🐮'), toy('photo', 'frames', '相框', 'ui-photo-camera', '🖼️')],
}

/** 這個遊戲算不算次數（有新玩具的才算） */
export const countsPlays = (id: PlayGameId): boolean => PLAY_TOYS[id] !== undefined

const clean = (plays: number | undefined): number => (typeof plays === 'number' && Number.isFinite(plays) && plays > 0 ? Math.floor(plays) : 0)

/** 玩完 plays 次，有幾個新玩具（0–2） */
export function toysUnlocked(plays: number | undefined): 0 | 1 | 2 {
  const n = clean(plays)
  return n >= TOY_AT[1] ? 2 : n >= TOY_AT[0] ? 1 : 0
}

/** 格子上亮幾顆星（0–3）：兩個玩具各一顆，戴皇冠第三顆 */
export function playStars(plays: number | undefined): 0 | 1 | 2 | 3 {
  return clean(plays) >= CROWN_AT ? 3 : toysUnlocked(plays)
}

export const isCrowned = (plays: number | undefined): boolean => clean(plays) >= CROWN_AT

export interface PlayCountResult {
  /** 新的次數表（不算次數的遊戲原樣回傳） */
  counts: Record<string, number>
  /** 這個遊戲現在玩完幾次 */
  plays: number
  /** 這一次剛好得到的新玩具（沒有就是 null） */
  toy: PlayToy | null
  /** 這一次剛好戴上皇冠 */
  crowned: boolean
}

/** 玩完一次：次數加一，回傳這一次剛好得到什麼 */
export function settlePlayCount(counts: Record<string, number> | undefined, gameId: PlayGameId): PlayCountResult {
  const cur = counts ?? {}
  const toys = PLAY_TOYS[gameId]
  if (!toys) return { counts: cur, plays: 0, toy: null, crowned: false }
  const plays = clean(cur[gameId]) + 1
  const at = TOY_AT.indexOf(plays as (typeof TOY_AT)[number])
  return { counts: { ...cur, [gameId]: plays }, plays, toy: at >= 0 ? toys[at] : null, crowned: plays === CROWN_AT }
}
