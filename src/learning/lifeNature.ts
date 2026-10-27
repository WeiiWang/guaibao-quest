/**
 * v6 線 B：生活與禮儀、自然常識兩個科目的內容表（素材對照、情境、步驟、事實）。
 * 這個檔案不 import 任何專案模組，讓 scripts/gen-questions.mjs 可以直接載入；
 * 題庫（content/life.json、nature.json）由產生器依這些表做出來，單元測試再用另一份獨立的對照表驗證。
 *
 * 語氣原則：不說「壞孩子」，不嚇小孩。「不好」的情境用「阿悟這樣好不好呢？」來問，提示說明「為什麼」。
 */

// ---------- 素材對照：每張圖實際畫了什麼 ----------

export interface WorldArt {
  /** 圖的實際內容（螢幕閱讀器的替代文字；也是「圖與題意對應表」的依據） */
  alt: string
  /** 缺圖時的備援 emoji */
  emoji: string
  /**
   * 這張圖畫得符合預定的題意嗎？false = 不用在題目裡（見 SPEC-v6 線 B：圖畫得不符合題意就不要用）。
   * 題庫產生器與單元測試都只認 ok 的圖。
   */
  ok: boolean
  /** 不能用或只能部分使用的原因 */
  note?: string
}

export const WORLD_ART: Record<string, WorldArt> = {
  // 生活：成對情境
  'life-wash-hands': { alt: '阿悟在洗手，手上有好多泡泡', emoji: '🧼', ok: true },
  'life-dirty-hands': { alt: '阿悟的手沾滿巧克力髒髒的，旁邊有一塊餅乾', emoji: '🍪', ok: true },
  'life-tidy-toys': { alt: '阿悟把積木收進玩具箱', emoji: '🧸', ok: true },
  'life-messy-toys': { alt: '阿悟抓著頭，地上散落著好多積木', emoji: '🧸', ok: true },
  'life-queue': { alt: '阿悟和小雞、小兔子站在一起', emoji: '🧍', ok: true, note: '只表現三個朋友站成一排，沒有畫出隊伍的方向；只和插隊那張成對使用' },
  'life-cut-line': { alt: '阿悟衝到前面插隊，後面的小兔子和小雞很難過', emoji: '🏃', ok: true },
  'life-thank-you': { alt: '小兔子送禮物給阿悟，阿悟開心地收下', emoji: '🎁', ok: true },
  'life-grab': { alt: '阿悟抱著球不放，小雞在旁邊難過地哭', emoji: '⚽', ok: true },
  'life-cross-green': { alt: '綠燈亮了，阿悟牽著媽媽的手走在斑馬線上', emoji: '🚶', ok: true },
  'life-wait-red': { alt: '紅燈亮著，阿悟站在斑馬線前乖乖等', emoji: '🚦', ok: true },
  'life-trash': { alt: '阿悟把香蕉皮丟進綠色的垃圾桶', emoji: '🗑️', ok: true },
  'life-litter': { alt: '阿悟把香蕉皮丟在地上', emoji: '🚮', ok: true },
  // 生活：單張
  'life-brush-teeth': { alt: '阿悟在刷牙，手裡拿著漱口杯', emoji: '🪥', ok: true },
  'life-eat-veg': { alt: '阿悟在吃青菜', emoji: '🥦', ok: true },
  'life-cover-cough': { alt: '阿悟用手臂遮住嘴巴咳嗽', emoji: '🤧', ok: true },
  'life-bedtime': { alt: '阿悟蓋著星星被子，在床上睡著了', emoji: '🛏️', ok: true },
  // 自然：天氣
  'nat-sunny': { alt: '晴天，笑瞇瞇的太陽公公從雲後面出來了', emoji: '☀️', ok: true },
  'nat-rainy': { alt: '下雨天，烏雲掉下雨滴，下面有一把彩色雨傘', emoji: '🌧️', ok: true },
  'nat-snowy': { alt: '下雪天，戴著帽子和圍巾的雪人', emoji: '❄️', ok: true },
  'nat-windy': { alt: '刮大風，大樹被風吹彎了，葉子飛起來', emoji: '🌬️', ok: true },
  // 自然：四季
  'nat-spring': { alt: '春天，開滿粉紅花朵的樹', emoji: '🌸', ok: true },
  'nat-summer': { alt: '夏天，葉子綠油油的大樹', emoji: '🌞', ok: true },
  'nat-autumn': { alt: '秋天，葉子變黃變橘的樹', emoji: '🍂', ok: true },
  'nat-winter': { alt: '冬天，樹枝光禿禿的，上面積著白雪', emoji: '⛄', ok: true },
  // 自然：動物的家
  'nat-sea': { alt: '大海，藍藍的海浪和沙灘', emoji: '🌊', ok: true },
  'nat-forest': { alt: '森林，高高的松樹和紅色小蘑菇', emoji: '🌲', ok: true },
  'nat-farm': { alt: '農場', emoji: '🚜', ok: true },
  // 自然：植物生長
  'nat-seed': { alt: '一顆小種子', emoji: '🌰', ok: true },
  'nat-sprout': { alt: '種子發芽了，長出小綠芽', emoji: '🌱', ok: true },
  'nat-bloom': { alt: '開花了', emoji: '🌷', ok: true },
  // 動物（新舊素材）
  'obj-fish': { alt: '小魚', emoji: '🐟', ok: true },
  'obj-chick': { alt: '小雞', emoji: '🐥', ok: true },
  'obj-rabbit': { alt: '小兔子', emoji: '🐰', ok: true },
  'obj-cow': { alt: '牛', emoji: '🐮', ok: true },
  'obj-bear': { alt: '熊', emoji: '🐻', ok: true },
  'obj-octopus': { alt: '章魚', emoji: '🐙', ok: true },
}

export const artEmojiOf = (name: string): string | undefined => WORLD_ART[name]?.emoji
export const artAltOf = (name: string): string => WORLD_ART[name]?.alt ?? name
/** 能用在題目裡的圖 */
export const artOk = (name: string): boolean => WORLD_ART[name]?.ok === true

// ---------- 動物（自然科目） ----------

export interface Animal {
  id: string
  name: string
  /** 住哪裡：nat-sea / nat-forest / nat-farm（小兔子有人說森林有人說農場，所以不放進「動物的家」） */
  home?: 'nat-sea' | 'nat-forest' | 'nat-farm'
  /** 住的地方的說明（提示用） */
  homeHint?: string
}

export const ANIMALS: Animal[] = [
  { id: 'obj-fish', name: '小魚', home: 'nat-sea', homeHint: '小魚住在水裡，大海是牠的家。' },
  { id: 'obj-octopus', name: '章魚', home: 'nat-sea', homeHint: '章魚住在海裡，有八隻腳。' },
  { id: 'obj-bear', name: '熊', home: 'nat-forest', homeHint: '熊住在森林裡，那裡有很多大樹。' },
  { id: 'obj-cow', name: '牛', home: 'nat-farm', homeHint: '牛住在農場，吃青草，還會給我們牛奶。' },
  { id: 'obj-chick', name: '小雞', home: 'nat-farm', homeHint: '小雞住在農場，跟雞媽媽在一起。' },
  { id: 'obj-rabbit', name: '小兔子' },
]
export const ANIMAL_BY_ID: Record<string, Animal> = Object.fromEntries(ANIMALS.map((a) => [a.id, a]))

/** 動物的家（場景） */
export const HOMES: { art: string; label: string }[] = [
  { art: 'nat-sea', label: '大海' },
  { art: 'nat-forest', label: '森林' },
  { art: 'nat-farm', label: '農場' },
]
export const HOME_LABEL: Record<string, string> = Object.fromEntries(HOMES.map((h) => [h.art, h.label]))

/** 動物的特徵：題目問「哪一個…？」，答案是 who，其餘選項都不能符合這個特徵 */
export interface Trait {
  id: string
  /** 題目（{prompt} 變化，三種問法） */
  asks: string[]
  /** 符合這個特徵的動物（只有一個是答案；其他選項不能在這裡面） */
  who: string[]
  hint: string
}
export const TRAITS: Trait[] = [
  { id: 'moo', asks: ['哪一個會發出「哞哞」的叫聲呢？', '「哞～哞～」是誰在叫呢？', '聽到「哞哞」，是哪一個動物呢？'], who: ['obj-cow'], hint: '牛會「哞哞」叫，農場裡常常聽得到。' },
  { id: 'peep', asks: ['哪一個會發出「啾啾」的叫聲呢？', '「啾啾啾」是誰在叫呢？', '聽到「啾啾」，是哪一個動物呢？'], who: ['obj-chick'], hint: '小雞毛茸茸的，會「啾啾」叫。' },
  { id: 'ears', asks: ['哪一個有長長的耳朵呢？', '誰的耳朵長長的、愛一跳一跳呢？', '找找看，哪一個有長長的耳朵？'], who: ['obj-rabbit'], hint: '小兔子有一對長長的耳朵，還會一跳一跳。' },
  { id: 'legs8', asks: ['哪一個有八隻腳呢？', '誰有八隻長長的腳呢？', '找找看，哪一個有八隻腳？'], who: ['obj-octopus'], hint: '章魚有八隻長長的腳，住在海裡。' },
  { id: 'milk', asks: ['哪一個可以給我們牛奶呢？', '我們喝的牛奶，是誰給我們的呢？', '找找看，哪一個會給我們牛奶？'], who: ['obj-cow'], hint: '牛可以給我們牛奶，牛奶喝了身體會壯壯。' },
  { id: 'honey', asks: ['哪一個最愛吃蜂蜜呢？', '誰最喜歡吃甜甜的蜂蜜呢？', '找找看，哪一個愛吃蜂蜜？'], who: ['obj-bear'], hint: '熊最愛吃甜甜的蜂蜜。' },
  { id: 'water', asks: ['哪一個住在水裡，會游來游去呢？', '誰的家在水裡，會游來游去呢？', '找找看，哪一個住在水裡？'], who: ['obj-fish', 'obj-octopus'], hint: '魚和章魚的家都在水裡，會游來游去。' },
]

// ---------- 生活：情境圖 ----------

export interface LifePic {
  art: string
  /** 這張圖畫的是不是好的做法 */
  good: boolean
  /** 「哪一張是在…？」的片語（只放能從圖裡看出來的動作） */
  see?: string
  /** 「阿悟…。阿悟這樣好不好呢？」前面那句（描述圖裡的事；每張圖兩種說法） */
  okay: string[]
  /** 說明為什麼好、為什麼不好（答錯時的提示；語氣溫和） */
  why: string
}

export const LIFE_PICS: LifePic[] = [
  {
    art: 'life-wash-hands',
    good: true,
    see: '在洗手',
    okay: ['阿悟用肥皂把手洗得乾乾淨淨', '要吃東西了，阿悟先到水龍頭前洗手'],
    why: '手上有看不見的細菌，用肥皂洗乾淨再吃東西，肚子才不會痛喔。',
  },
  {
    art: 'life-dirty-hands',
    good: false,
    see: '手髒髒的',
    okay: ['阿悟的手髒髒的，就要拿餅乾來吃', '阿悟手上沾了好多巧克力，沒有洗手就想吃東西'],
    why: '手髒髒會有細菌跑進肚子，先洗手再吃喔。',
  },
  {
    art: 'life-messy-toys',
    good: false,
    see: '玩具散了一地',
    okay: ['阿悟玩完玩具，積木散落在地上，卻不收拾', '玩具掉得滿地都是，阿悟看了看，就走開了'],
    why: '玩具丟在地上，別人會踩到，下次也找不到。玩完要收好喔。',
  },
  {
    art: 'life-grab',
    good: false,
    see: '抱著球，小雞在哭',
    okay: ['阿悟把球搶過來抱著不放，小雞難過得哭了', '阿悟抱著球不肯給小雞玩，小雞哭了'],
    why: '搶別人的東西，朋友會很難過。想玩的話，要先說「請借我」。',
  },
  {
    art: 'life-litter',
    good: false,
    see: '把香蕉皮丟在地上',
    okay: ['阿悟吃完香蕉，把香蕉皮丟在地上', '阿悟隨手把香蕉皮丟在地上，就走開了'],
    why: '香蕉皮丟在地上，別人會滑倒，地方也會髒髒的。要丟進垃圾桶喔。',
  },
  {
    art: 'life-tidy-toys',
    good: true,
    see: '在收玩具',
    okay: ['玩完玩具，阿悟把積木一個一個收進玩具箱', '阿悟玩好了，自己把玩具收回箱子裡'],
    why: '玩具收好，下次才找得到，也不會被踩到喔。',
  },
  {
    art: 'life-queue',
    good: true,
    okay: ['阿悟和朋友們一起站好，輪流等一等', '大家都要玩，阿悟和朋友們好好地排隊'],
    why: '大家排好隊、一個一個輪流，才不會推來推去，每個人都輪得到。',
  },
  {
    art: 'life-cut-line',
    good: false,
    see: '衝到前面插隊',
    okay: ['大家都在排隊，阿悟跑到最前面插隊', '朋友們在等著輪流，阿悟卻衝到前面去'],
    why: '插隊的話，後面的朋友會很難過。排在後面等一等，就會輪到你囉。',
  },
  {
    art: 'life-thank-you',
    good: true,
    see: '在收朋友送的禮物',
    okay: ['小兔子送禮物給阿悟，阿悟開心地收下，還說謝謝', '朋友把禮物送給阿悟，阿悟用兩隻手接過來，說了謝謝'],
    why: '別人送我們東西，要說謝謝，對方會很開心喔。',
  },
  {
    art: 'life-trash',
    good: true,
    see: '在把垃圾丟進垃圾桶',
    okay: ['吃完香蕉，阿悟把香蕉皮丟進垃圾桶', '阿悟找到垃圾桶，把垃圾丟進去'],
    why: '垃圾丟進垃圾桶，地方才會乾乾淨淨，大家都開心。',
  },
  {
    art: 'life-wait-red',
    good: true,
    see: '在等紅燈',
    okay: ['紅燈亮了，阿悟站在旁邊乖乖等', '要過馬路了，阿悟看到紅燈，就停下來等'],
    why: '紅燈亮了，車子正在走，要停下來等，等到綠燈才安全喔。',
  },
  {
    art: 'life-cross-green',
    good: true,
    see: '牽著媽媽的手過馬路',
    okay: ['綠燈亮了，阿悟牽著媽媽的手走過斑馬線', '要過馬路了，阿悟等到綠燈，牽好媽媽的手慢慢走'],
    why: '綠燈亮了才可以過馬路，牽著大人的手慢慢走，比較安全喔。',
  },
  {
    art: 'life-brush-teeth',
    good: true,
    see: '在刷牙',
    okay: ['阿悟拿著牙刷，把牙齒刷得乾乾淨淨', '睡覺前，阿悟認真地刷牙'],
    why: '天天刷牙，牙齒才不會被蛀蟲咬壞，吃東西才不會痛痛。',
  },
  {
    art: 'life-eat-veg',
    good: true,
    see: '在吃青菜',
    okay: ['阿悟把盤子裡的青菜吃得乾乾淨淨', '阿悟開心地吃著綠綠的青菜'],
    why: '青菜裡有很多營養，吃了身體才會長得壯壯的喔。',
  },
  {
    art: 'life-cover-cough',
    good: true,
    see: '用手臂遮住嘴巴咳嗽',
    okay: ['阿悟咳嗽的時候，用手臂遮住嘴巴', '要咳嗽了，阿悟趕快用手臂把嘴巴遮起來'],
    why: '咳嗽時遮住嘴巴，細菌就不會飛到別人身上，大家都不會生病。',
  },
  {
    art: 'life-bedtime',
    good: true,
    see: '在床上睡覺',
    okay: ['天黑了，阿悟乖乖躺在床上睡覺', '到了睡覺時間，阿悟蓋好被子，早早睡著了'],
    why: '早早睡覺，睡飽了身體才會長高，明天才有精神玩。',
  },
]
export const LIFE_PIC_BY_ART: Record<string, LifePic> = Object.fromEntries(LIFE_PICS.map((p) => [p.art, p]))

/** 成對的情境：好的做法對上不好的做法（兩張圖的情境一樣）。問法比較具體 */
export interface LifePair {
  good: string
  bad: string
  /** 三種問法 */
  asks: string[]
}
export const LIFE_PAIRS: LifePair[] = [
  { good: 'life-wash-hands', bad: 'life-dirty-hands', asks: ['要吃東西了，手髒髒的，哪一個是對的做法呢？', '吃東西以前，哪一個是好習慣呢？', '阿悟的手髒髒的，要怎麼做才好呢？'] },
  { good: 'life-tidy-toys', bad: 'life-messy-toys', asks: ['玩完玩具了，哪一個是對的做法呢？', '玩具玩好了，哪一個做法比較好呢？', '哪一個是玩完玩具以後的好習慣呢？'] },
  { good: 'life-thank-you', bad: 'life-grab', asks: ['和朋友在一起，哪一個是有禮貌的做法呢？', '哪一個做法會讓朋友開心呢？', '和朋友相處，哪一個是好的做法呢？'] },
  { good: 'life-trash', bad: 'life-litter', asks: ['吃完東西了，哪一個是對的做法呢？', '垃圾要怎麼處理才對呢？', '哪一個會讓環境乾乾淨淨呢？'] },
  { good: 'life-queue', bad: 'life-cut-line', asks: ['大家都想玩，哪一個是對的做法呢？', '要等一等的時候，哪一個做法比較好呢？', '有很多小朋友在等，哪一個是好的做法呢？'] },
]
/** 兩張圖不成對時用的問法（不提情境，只問哪一個好） */
export const RIGHT_ASKS = ['哪一個是好的做法呢？', '阿悟想一想，哪一個做法比較好呢？', '哪一個是好習慣呢？']
/** 「哪一張是在…？」的問法 */
export const SEE_ASKS = [(a: string) => `哪一張是阿悟${a}呢？`, (a: string) => `找找看，哪一張是${a}？`, (a: string) => `阿悟${a}，是哪一張呢？`]
/** 「阿悟這樣好不好呢？」 */
export const OKAY_TAIL = '阿悟這樣好不好呢？'

/** 只有文字的情境（沒有可用的圖）：用一個大 emoji 當題幹。為什麼好或不好寫在 why */
export interface LifeStory {
  emoji: string
  text: string
  good: boolean
  why: string
}
export const LIFE_STORIES: LifeStory[] = [
  { emoji: '🍬', text: '阿悟吃完糖果，把包裝紙丟在公園的草地上', good: false, why: '包裝紙留在草地上，公園會變髒。放進垃圾桶，公園才會漂亮。' },
  { emoji: '🤧', text: '阿悟打噴嚏的時候，對著朋友的臉打', good: false, why: '細菌會飛到朋友身上，朋友會生病。打噴嚏要遮住嘴巴和鼻子。' },
  { emoji: '🍚', text: '阿悟吃飯的時候，把飯粒灑得桌上到處都是', good: false, why: '飯粒灑出來桌子會髒髒的。慢慢吃，用湯匙好好吃，吃乾淨喔。' },
  { emoji: '🙏', text: '阿悟想玩朋友的球，先說了「請借我玩一下」', good: true, why: '想要別人的東西，先有禮貌地說「請」，朋友就會很樂意借你。' },
  { emoji: '🚰', text: '阿悟洗完手，把水龍頭關緊', good: true, why: '水很珍貴，用完把水龍頭關好，才不會浪費水喔。' },
  { emoji: '👴', text: '爺爺走過來，阿悟開心地說「爺爺好」', good: true, why: '看到大家打招呼，有禮貌，大家都會很開心。' },
  { emoji: '🚏', text: '阿悟在公車站，看到老奶奶就讓位子給她坐', good: true, why: '把座位讓給需要的人，是很溫暖的好事。' },
  { emoji: '🗑️', text: '阿悟看到地上有別人丟的紙屑，把它撿起來丟進垃圾桶', good: true, why: '把垃圾撿起來丟進垃圾桶，地方就會變乾淨，大家都開心。' },
  { emoji: '🧩', text: '阿悟玩完拼圖，把每一片都放回盒子裡', good: true, why: '拼圖收好，下次才不會少一片，找得到、也不會弄丟。' },
  { emoji: '🗣️', text: '老師正在說話，阿悟沒聽完就大聲插嘴', good: false, why: '別人說話的時候，先聽完再說，這樣才有禮貌喔。' },
]

// ---------- 生活：說什麼（謝謝、對不起、請、不客氣） ----------

export interface SayWord {
  id: 'thanks' | 'sorry' | 'please' | 'welcome'
  text: string
  emoji: string
}
export const SAY_WORDS: SayWord[] = [
  { id: 'thanks', text: '謝謝', emoji: '🙏' },
  { id: 'sorry', text: '對不起', emoji: '🙇' },
  { id: 'please', text: '請', emoji: '🤲' },
  { id: 'welcome', text: '不客氣', emoji: '😊' },
]
export const SAY_BY_ID: Record<string, SayWord> = Object.fromEntries(SAY_WORDS.map((w) => [w.id, w]))

export interface SayScene {
  /** 正確要說的話 */
  say: SayWord['id']
  /** 情境（唸給孩子聽，後面接「要說什麼呢？」） */
  text: string
  /** 題幹的圖（沒有就用 emoji） */
  art?: string
  emoji: string
  hint: string
}
export const SAY_SCENES: SayScene[] = [
  { say: 'thanks', text: '小兔子送了一個禮物給阿悟', art: 'life-thank-you', emoji: '🎁', hint: '別人送我們東西，要說「謝謝」，對方會很開心。' },
  { say: 'thanks', text: '媽媽幫阿悟倒了一杯水', emoji: '🥛', hint: '別人幫了我們，要說「謝謝」。' },
  { say: 'thanks', text: '老師送給阿悟一張貼紙', emoji: '⭐', hint: '收到別人給的東西，要說「謝謝」。' },
  { say: 'thanks', text: '爺爺給阿悟一顆糖果', emoji: '🍬', hint: '爺爺給我們東西，要說「謝謝」。' },
  { say: 'thanks', text: '朋友撿起阿悟掉在地上的鉛筆，還給阿悟', emoji: '✏️', hint: '朋友幫了我們的忙，要說「謝謝」。' },
  { say: 'thanks', text: '阿姨幫阿悟把門打開', emoji: '🚪', hint: '別人幫我們開門，要說「謝謝」。' },
  { say: 'sorry', text: '阿悟不小心踩到小雞的腳', emoji: '🐥', hint: '不小心弄痛別人，要說「對不起」。' },
  { say: 'sorry', text: '阿悟玩的時候，不小心把朋友的積木推倒了', emoji: '🧱', hint: '不小心弄壞別人的東西，要說「對不起」。' },
  { say: 'sorry', text: '阿悟跑步的時候，不小心撞到了小兔子', emoji: '🏃', hint: '不小心撞到別人，要說「對不起」。' },
  { say: 'sorry', text: '阿悟不小心把牛奶打翻在桌子上', emoji: '🥛', hint: '做錯事或不小心弄髒了，要說「對不起」。' },
  { say: 'sorry', text: '阿悟不小心把朋友的畫弄皺了', emoji: '🖼️', hint: '不小心弄壞朋友的東西，要說「對不起」。' },
  { say: 'please', text: '阿悟想玩朋友手上的玩具', emoji: '🧸', hint: '想要別人的東西，要先說「請」，像是「請借我玩」。' },
  { say: 'please', text: '阿悟想請媽媽幫忙拿高高的杯子', emoji: '🥤', hint: '請別人幫忙的時候，要說「請」。' },
  { say: 'please', text: '阿悟想請朋友把球傳過來', emoji: '⚽', hint: '想請別人做事，要先說「請」。' },
  { say: 'please', text: '阿悟想請老師再講一次故事', emoji: '📖', hint: '請老師或大人幫忙，要說「請」。' },
  { say: 'welcome', text: '朋友對阿悟說「謝謝你借我玩具」', emoji: '😊', hint: '別人跟我們說謝謝，我們可以回答「不客氣」。' },
  { say: 'welcome', text: '奶奶對阿悟說「謝謝你幫我拿東西」', emoji: '🛍️', hint: '別人謝謝我們，可以說「不客氣」。' },
  { say: 'welcome', text: '小朋友對阿悟說「謝謝你扶我起來」', emoji: '🤝', hint: '別人跟我們說謝謝，要說「不客氣」。' },
  { say: 'welcome', text: '媽媽對阿悟說「謝謝你幫忙擺碗筷」', emoji: '🥢', hint: '聽到別人說謝謝，可以笑笑地說「不客氣」。' },
]
export const SAY_ASKS = ['這時候，阿悟要說什麼呢？', '阿悟要說什麼才有禮貌呢？', '要說哪一句話才有禮貌呢？']

// ---------- 生活：紅綠燈 ----------

export interface LightQ {
  /** 'red' 紅燈、'green' 綠燈 */
  color: 'red' | 'green'
  swatch: string
  prompt: string
  /** 正確選項 */
  right: { id: string; text: string; emoji: string }
  /** 另一個選項 */
  other: { id: string; text: string; emoji: string }
  hint: string
}
export const LIGHT_QS: LightQ[] = [
  {
    color: 'red',
    swatch: '#ef4b3f',
    prompt: '紅燈亮了，我們要停下來等，還是往前走呢？',
    right: { id: 'stop', text: '停下來等', emoji: '✋' },
    other: { id: 'go', text: '往前走', emoji: '🚶' },
    hint: '紅燈的意思是請停下來。車子正在走，等一等才安全喔。',
  },
  {
    color: 'red',
    swatch: '#ef4b3f',
    prompt: '馬路上的燈是紅色的，阿悟要怎麼做呢？',
    right: { id: 'stop', text: '停下來等', emoji: '✋' },
    other: { id: 'go', text: '跑過去', emoji: '🏃' },
    hint: '看到紅燈，要停下來等。跑過去很危險喔。',
  },
  {
    color: 'green',
    swatch: '#3fae5a',
    prompt: '綠燈亮了，可以走，還是要停呢？',
    right: { id: 'go', text: '可以走', emoji: '🚶' },
    other: { id: 'stop', text: '要停', emoji: '✋' },
    hint: '綠燈亮了，才可以過馬路。走之前，還是要先看看左右喔。',
  },
  {
    color: 'green',
    swatch: '#3fae5a',
    prompt: '馬路上的燈變成綠色了，阿悟可以怎麼做呢？',
    right: { id: 'go', text: '慢慢走過去', emoji: '🚶' },
    other: { id: 'stop', text: '一直站著不動', emoji: '🧍' },
    hint: '綠燈就是可以走了。看看左右沒有車，就慢慢走過去。',
  },
]
/** 圖片版：現在是紅燈／綠燈，哪一張是對的做法 */
export const LIGHT_PIC_QS: { prompt: string; right: string; other: string; hint: string }[] = [
  { prompt: '現在是紅燈，哪一個是對的做法呢？', right: 'life-wait-red', other: 'life-cross-green', hint: '紅燈要停下來等，像阿悟這樣乖乖站好。' },
  { prompt: '紅燈亮著，阿悟要怎麼做才對呢？', right: 'life-wait-red', other: 'life-cross-green', hint: '紅燈亮著不能走，要停下來等一等。' },
  { prompt: '綠燈亮了，哪一個是對的做法呢？', right: 'life-cross-green', other: 'life-wait-red', hint: '綠燈亮了就可以走，牽好大人的手，慢慢走過去。' },
]

// ---------- 步驟（洗手、刷牙、過馬路…） ----------

export interface Step {
  id: string
  text: string
  emoji: string
  /** 卡片上的圖（有的話優先於 emoji） */
  art?: string
}
export interface Routine {
  id: string
  /** 「洗手」「刷牙」 */
  title: string
  steps: Step[]
}
export const ROUTINES: Routine[] = [
  {
    id: 'wash',
    title: '洗手',
    steps: [
      { id: 'wet', text: '把手弄濕', emoji: '💦' },
      { id: 'soap', text: '擦上肥皂', emoji: '🧼' },
      { id: 'rub', text: '搓出泡泡', emoji: '🫧' },
      { id: 'rinse', text: '用水沖乾淨', emoji: '🚿' },
      { id: 'dry', text: '用毛巾擦乾', emoji: '🧻' },
    ],
  },
  {
    id: 'teeth',
    title: '刷牙',
    steps: [
      { id: 'paste', text: '擠一點點牙膏', emoji: '🪥' },
      { id: 'brush', text: '把牙齒刷乾淨', emoji: '😁', art: 'life-brush-teeth' },
      { id: 'gargle', text: '用水漱口', emoji: '💧' },
      { id: 'wipe', text: '擦擦嘴巴', emoji: '🧻' },
    ],
  },
  {
    id: 'street',
    title: '過馬路',
    steps: [
      { id: 'stop', text: '先停下來', emoji: '✋' },
      { id: 'look', text: '看看左右', emoji: '👀' },
      { id: 'listen', text: '聽聽有沒有車', emoji: '👂' },
      { id: 'walk', text: '牽好手慢慢走', emoji: '🚶', art: 'life-cross-green' },
    ],
  },
  {
    id: 'bed',
    title: '睡覺前',
    steps: [
      { id: 'bath', text: '洗香香', emoji: '🛁' },
      { id: 'teeth', text: '刷牙', emoji: '🪥' },
      { id: 'pajama', text: '換上睡衣', emoji: '👕' },
      { id: 'sleep', text: '上床睡覺', emoji: '🛏️', art: 'life-bedtime' },
    ],
  },
  {
    id: 'meal',
    title: '吃飯',
    steps: [
      { id: 'wash', text: '先洗手', emoji: '🧼', art: 'life-wash-hands' },
      { id: 'sit', text: '坐好', emoji: '🪑' },
      { id: 'thanks', text: '說「我開動了」', emoji: '🙏' },
      { id: 'eat', text: '慢慢吃飯', emoji: '🍚' },
    ],
  },
]
export const ROUTINE_BY_ID: Record<string, Routine> = Object.fromEntries(ROUTINES.map((r) => [r.id, r]))

// ---------- 生活：為什麼 ----------

export interface WhyItem {
  id: string
  ask: string
  /** 正確的理由 */
  right: { text: string; emoji: string }
  /** 明顯不對的理由（搞笑沒關係） */
  wrong: { text: string; emoji: string }[]
  hint: string
}
export const WHYS: WhyItem[] = [
  {
    id: 'wash',
    ask: '為什麼吃東西以前要先洗手呢？',
    right: { text: '把細菌洗掉，肚子才不會痛', emoji: '🧼' },
    wrong: [
      { text: '這樣手會變成藍色的', emoji: '💙' },
      { text: '因為水龍頭想跟我們玩', emoji: '🚰' },
      { text: '這樣吃東西會變得比較大聲', emoji: '📢' },
    ],
    hint: '手上有看不見的細菌，洗乾淨再吃東西，肚子才不會痛喔。',
  },
  {
    id: 'queue',
    ask: '為什麼要排隊呢？',
    right: { text: '一個一個輪流，才不會擠來擠去', emoji: '🧍' },
    wrong: [
      { text: '這樣可以變得比較高', emoji: '📏' },
      { text: '因為站在最前面最帥', emoji: '😎' },
      { text: '這樣大家就可以一起睡覺', emoji: '😴' },
    ],
    hint: '排隊輪流，大家都輪得到，也不會推來推去受傷喔。',
  },
  {
    id: 'teeth',
    ask: '為什麼要天天刷牙呢？',
    right: { text: '牙齒才不會被蛀蟲咬壞', emoji: '🦷' },
    wrong: [
      { text: '這樣牙齒會長得很長', emoji: '📏' },
      { text: '這樣可以吃更多糖果', emoji: '🍬' },
      { text: '因為牙刷想要唱歌', emoji: '🎤' },
    ],
    hint: '刷牙可以把食物渣渣刷掉，牙齒才不會痛痛。',
  },
  {
    id: 'trash',
    ask: '為什麼垃圾要丟進垃圾桶呢？',
    right: { text: '這樣地方才會乾乾淨淨', emoji: '✨' },
    wrong: [
      { text: '因為垃圾桶肚子餓了', emoji: '🍽️' },
      { text: '這樣垃圾會長大', emoji: '🌱' },
      { text: '因為垃圾想要睡覺', emoji: '😴' },
    ],
    hint: '垃圾放進垃圾桶，地方才不會髒髒臭臭，大家都舒服。',
  },
  {
    id: 'cough',
    ask: '咳嗽的時候，為什麼要遮住嘴巴呢？',
    right: { text: '不讓細菌飛到別人身上', emoji: '🤧' },
    wrong: [
      { text: '這樣咳嗽的聲音會變很大', emoji: '📢' },
      { text: '這樣嘴巴會變成方形的', emoji: '🔲' },
      { text: '因為手想要說話', emoji: '🖐️' },
    ],
    hint: '遮住嘴巴，細菌就不會跑到朋友身上，大家都不會生病。',
  },
  {
    id: 'veg',
    ask: '為什麼要吃青菜呢？',
    right: { text: '身體才會長得壯壯的', emoji: '💪' },
    wrong: [
      { text: '這樣耳朵會變成綠色的', emoji: '🟢' },
      { text: '吃了就可以馬上飛起來', emoji: '🪽' },
      { text: '因為青菜會唱歌', emoji: '🎵' },
    ],
    hint: '青菜裡有很多營養，吃了身體才會健康、長得壯壯的。',
  },
  {
    id: 'sleep',
    ask: '晚上為什麼要早早睡覺呢？',
    right: { text: '睡飽了身體才會長高，白天才有精神', emoji: '🌙' },
    wrong: [
      { text: '這樣明天就不用起床了', emoji: '🙈' },
      { text: '因為星星會生氣', emoji: '⭐' },
      { text: '這樣枕頭才不會逃走', emoji: '🛏️' },
    ],
    hint: '睡覺的時候，身體在長大。睡飽飽，明天才有力氣玩。',
  },
  {
    id: 'red',
    ask: '紅燈亮了，為什麼要停下來等呢？',
    right: { text: '車子正在走，停下來才安全', emoji: '🚗' },
    wrong: [
      { text: '因為紅色是我的幸運色', emoji: '❤️' },
      { text: '因為可以在路上睡覺', emoji: '😴' },
      { text: '因為紅燈會請我們吃糖', emoji: '🍬' },
    ],
    hint: '紅燈的時候車子在走，我們停下來等，就不會被撞到。',
  },
  {
    id: 'thanks',
    ask: '別人幫了我們，為什麼要說謝謝呢？',
    right: { text: '讓對方知道我們很開心、很感謝', emoji: '🥰' },
    wrong: [
      { text: '這樣他就不會再幫我們了', emoji: '🙅' },
      { text: '因為謝謝是魔法，會變出糖果', emoji: '🪄' },
      { text: '因為這樣可以跑得比較快', emoji: '💨' },
    ],
    hint: '說謝謝，對方會知道我們很感謝他，大家心裡都暖暖的。',
  },
  {
    id: 'toys',
    ask: '玩完玩具，為什麼要收好呢？',
    right: { text: '下次才找得到，也不會被踩到', emoji: '🧸' },
    wrong: [
      { text: '因為玩具想要睡覺了', emoji: '😴' },
      { text: '這樣玩具會長得很大', emoji: '📏' },
      { text: '因為地板不喜歡玩具', emoji: '🙅' },
    ],
    hint: '玩具收進箱子，房間乾乾淨淨，下次想玩馬上找得到。',
  },
]

// ---------- 自然：天氣、四季、植物 ----------

export interface Weather {
  id: 'sun' | 'rain' | 'snow' | 'wind'
  art: string
  /** 「晴天」「下雨天」 */
  name: string
  /** 「哪一張是…？」 */
  asks: string[]
  hint: string
}
export const WEATHERS: Weather[] = [
  { id: 'sun', art: 'nat-sunny', name: '晴天', asks: ['哪一張是晴天呢？', '太陽公公出來了，是哪一張呢？', '找找看，哪一張是大太陽的晴天？'], hint: '晴天的時候，天空有大大的太陽，暖暖亮亮的。' },
  { id: 'rain', art: 'nat-rainy', name: '下雨天', asks: ['哪一張是下雨天呢？', '滴答滴答下雨了，是哪一張呢？', '找找看，哪一張是下雨天？'], hint: '下雨天，天空會掉下一滴一滴的雨水。' },
  { id: 'snow', art: 'nat-snowy', name: '下雪天', asks: ['哪一張是下雪天呢？', '白白的雪花飄下來了，是哪一張呢？', '找找看，哪一張是下雪天？'], hint: '下雪的時候，天空會飄下白白的雪花，天氣好冷。' },
  { id: 'wind', art: 'nat-windy', name: '刮風天', asks: ['哪一張是刮大風呢？', '呼呼呼，風好大，是哪一張呢？', '找找看，哪一張是刮風天？'], hint: '刮大風的時候，風呼呼地吹，把東西都吹得飄起來。' },
]
export const WEATHER_BY_ID: Record<string, Weather> = Object.fromEntries(WEATHERS.map((w) => [w.id, w]))

export interface Gear {
  id: 'umbrella' | 'shades' | 'jacket'
  text: string
  emoji: string
}
export const GEARS: Gear[] = [
  { id: 'umbrella', text: '雨傘', emoji: '☂️' },
  { id: 'shades', text: '太陽眼鏡', emoji: '🕶️' },
  { id: 'jacket', text: '外套', emoji: '🧥' },
]
export const GEAR_BY_ID: Record<string, Gear> = Object.fromEntries(GEARS.map((g) => [g.id, g]))
/** 天氣要帶什麼：三種裝備各對應一種情況，彼此不會混 */
export interface BringQ {
  cond: 'rain' | 'sun' | 'cold'
  /** 題幹的天氣圖（沒有就用 emoji） */
  art?: string
  emoji: string
  prompts: string[]
  gear: Gear['id']
  hint: string
}
export const BRING_QS: BringQ[] = [
  { cond: 'rain', art: 'nat-rainy', emoji: '🌧️', prompts: ['下雨了，出門要帶什麼呢？', '外面下著雨，阿悟要帶什麼呢？', '滴答滴答下雨天，要帶什麼才不會淋濕呢？'], gear: 'umbrella', hint: '下雨的時候，撐起雨傘，頭和衣服就不會被雨淋濕了。' },
  { cond: 'sun', art: 'nat-sunny', emoji: '☀️', prompts: ['太陽好大，眼睛瞇瞇的，要戴什麼呢？', '大太陽出來了，出門要戴什麼保護眼睛呢？', '外面太陽好亮好刺眼，要戴什麼呢？'], gear: 'shades', hint: '太陽很大很亮的時候，戴上太陽眼鏡，眼睛就不會被刺到。' },
  { cond: 'cold', art: 'nat-snowy', emoji: '❄️', prompts: ['天氣好冷好冷，要穿什麼呢？', '下雪了好冷，出門要穿什麼呢？', '外面冷颼颼的，阿悟要穿什麼才暖和呢？'], gear: 'jacket', hint: '天氣很冷的時候，穿上厚厚的外套，身體就會暖暖的。' },
]

export interface Season {
  id: 'spring' | 'summer' | 'autumn' | 'winter'
  art: string
  name: string
  emoji: string
  /** 看圖說季節時的提示（說明圖裡看得到的線索） */
  picHint: string
}
export const SEASONS: Season[] = [
  { id: 'spring', art: 'nat-spring', name: '春天', emoji: '🌸', picHint: '樹上開滿了粉紅色的花，天氣暖暖的，是春天喔。' },
  { id: 'summer', art: 'nat-summer', name: '夏天', emoji: '☀️', picHint: '樹上的葉子綠油油的，長得好茂盛，天氣很熱，是夏天喔。' },
  { id: 'autumn', art: 'nat-autumn', name: '秋天', emoji: '🍂', picHint: '樹葉變成黃色和橘色，快要掉下來了，是秋天喔。' },
  { id: 'winter', art: 'nat-winter', name: '冬天', emoji: '⛄', picHint: '樹葉都掉光了，樹枝上積著白白的雪，天氣好冷，是冬天喔。' },
]
export const SEASON_BY_ID: Record<string, Season> = Object.fromEntries(SEASONS.map((s) => [s.id, s]))
/** 季節的特徵（台灣孩子熟悉的說法）。每個特徵只屬於一個季節 */
export interface SeasonFact {
  id: string
  season: Season['id']
  /** 問法（三種） */
  asks: string[]
  hint: string
}
export const SEASON_FACTS: SeasonFact[] = [
  { id: 'bloom', season: 'spring', asks: ['小草發芽、花兒開了，是哪一個季節呢？', '哪一個季節，天氣暖暖的、花都開了呢？', '花開了、小鳥唱歌，是什麼季節呢？'], hint: '春天天氣暖暖的，小草發芽，花兒也一朵一朵開了。' },
  { id: 'hot', season: 'summer', asks: ['天氣最熱、可以游泳吃冰的，是哪一個季節呢？', '哪一個季節最熱，我們會想吃冰呢？', '太陽很大、汗流不停，是什麼季節呢？'], hint: '夏天最熱，太陽好大，我們會想游泳、吃冰涼的冰。' },
  { id: 'leaves', season: 'autumn', asks: ['樹葉變黃、一片一片掉下來，是哪一個季節呢？', '哪一個季節，天氣涼涼的、樹葉會掉下來呢？', '風涼涼的、落葉滿地，是什麼季節呢？'], hint: '秋天天氣涼涼的，樹葉變黃了，會一片一片飄下來。' },
  { id: 'cold', season: 'winter', asks: ['天氣最冷、要穿厚外套的，是哪一個季節呢？', '哪一個季節最冷，我們要穿得暖暖的呢？', '冷颼颼、要穿毛衣和外套，是什麼季節呢？'], hint: '冬天最冷，我們要穿厚厚的外套和毛衣。' },
]
/** 什麼季節會下雪（台灣平地不下雪，要說「很冷的地方」） */
export const SNOW_ASKS = ['在很冷很冷的地方，什麼季節會下雪呢？', '很冷的地方，哪一個季節會飄下白白的雪花呢？', '下雪的季節是哪一個呢？（在很冷的地方喔）']
export const SNOW_HINT = '冬天最冷，在很冷的地方會下雪。台灣的平地不太會下雪喔。'
export const SEASON_PIC_ASKS = ['這是哪一個季節呢？', '看看圖，這是什麼季節呢？', '阿悟看到這樣的風景，是哪一個季節呢？']
export const SEASON_NAME_ASKS = [(s: string) => `哪一張是${s}呢？`, (s: string) => `找找看，哪一張是${s}？`, (s: string) => `${s}的風景，是哪一張呢？`]

export interface PlantStage {
  id: 'seed' | 'sprout' | 'bloom'
  art: string
  name: string
  emoji: string
  asks: string[]
  hint: string
}
export const PLANT_STAGES: PlantStage[] = [
  { id: 'seed', art: 'nat-seed', name: '種子', emoji: '🌰', asks: ['哪一張是小種子呢？', '找找看，哪一張是種子？', '植物最開始是一顆小小的，是哪一張呢？'], hint: '種子是植物最開始的樣子，小小的、圓圓的。' },
  { id: 'sprout', art: 'nat-sprout', name: '發芽', emoji: '🌱', asks: ['哪一張是種子發芽了呢？', '小綠芽冒出來了，是哪一張呢？', '找找看，哪一張是發芽？'], hint: '種子喝了水，就會冒出綠綠的小芽。' },
  { id: 'bloom', art: 'nat-bloom', name: '開花', emoji: '🌷', asks: ['哪一張是開花了呢？', '漂亮的花開了，是哪一張呢？', '找找看，哪一張是開花？'], hint: '小芽慢慢長大，就會開出漂亮的花。' },
]
export const PLANT_ORDER_ASKS = ['種子慢慢長大，請把植物生長的順序排好。', '請把小種子長成花的順序排好。', '植物是怎麼長大的呢？請依順序排好。']
export const SEASON_ORDER_ASKS = ['一年有四個季節，請從春天開始，依順序排好。', '請把四個季節，依春夏秋冬的順序排好。', '季節會一個接著一個來，請依順序排好。']
export const PLANT_ORDER_HINT = '先有小種子，種子發芽，最後長大開花。'
export const SEASON_ORDER_HINT = '一年的季節是春天、夏天、秋天、冬天，一個接著一個來。'

/** 植物需要什麼：只有「水和陽光」是對的 */
export const PLANT_NEEDS: { ask: string; right: { text: string; emoji: string }; wrong: { text: string; emoji: string }[]; hint: string }[] = [
  {
    ask: '小種子要長大，需要什麼呢？',
    right: { text: '陽光和水', emoji: '☀️' },
    wrong: [
      { text: '糖果和餅乾', emoji: '🍬' },
      { text: '玩具和積木', emoji: '🧸' },
      { text: '電視和遊戲', emoji: '📺' },
    ],
    hint: '植物要曬太陽、喝水，才會長高長大。',
  },
  {
    ask: '想讓小花園裡的花長得好，要怎麼照顧呢？',
    right: { text: '澆水、曬太陽', emoji: '🚿' },
    wrong: [
      { text: '把它放進黑黑的櫃子', emoji: '🗄️' },
      { text: '每天給它吃蛋糕', emoji: '🍰' },
      { text: '用力把它拔一拔', emoji: '💪' },
    ],
    hint: '花需要水和陽光，天天照顧它，才會開得漂漂亮亮。',
  },
]
