/**
 * 所有會唸出來的句子，集中在這裡管理：每句一個穩定的 key。
 * 介面呼叫 say(key, text)；之後有預先錄好的音檔（Voicebox 本機生成）就依 key 找檔，沒有才退回 Web Speech。
 * 這個檔案不 import 任何專案模組（只用 import type），讓 scripts/export-speech-lines.mjs 可以直接載入。
 *
 * key 規則：
 *   q.<題目id>.prompt / q.<題目id>.hint   題目與提示
 *   word.<文字>                          題目裡逐個唸的詞（物件名、顏色、數量）
 *   num.<n>                              數數用的數字
 *   其餘是固定台詞，見 STATIC_LINES
 */
import type { Question } from './types'

export interface Line {
  key: string
  text: string
}

const NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十']

export const questionKey = (id: string, part: 'prompt' | 'hint', kid = false): string => `q.${id}.${part}${kid ? '.kid' : ''}`
/**
 * v7（G8）：寵物還是蛋的時候，生活題裡的主角圖片不能說成「阿悟」（圖裡是猴子，蛋還沒孵出來），
 * 改說「小朋友」。只影響生活科目；文字替換，語音 key 加 .kid
 */
export const KID_NAME = '小朋友'
export const kidText = (text: string): string => text.replaceAll('阿悟', KID_NAME)
export const isKidVariant = (q: Pick<Question, 'skill' | 'prompt' | 'hint'>): boolean => q.skill === 'life' && (q.prompt.includes('阿悟') || q.hint.includes('阿悟'))
export const wordKey = (text: string): string => `word.${text}`
export const numberKey = (n: number): string => `num.${n}`
/** 數完之後強調總數：「一共有五個」 */
export const totalKey = (n: number): string => `count.total.${n}`
export const totalText = (n: number): string => `一共有${NUM[n] ?? n}個`

/** 1–30 轉中文數字（唸給孩子聽：一、二、三…；21–30 給連連看的挑戰關） */
export function chineseNumber(n: number): string {
  if (n <= 10) return NUM[n] ?? String(n)
  if (n < 20) return `十${NUM[n - 10]}`
  if (n === 20) return '二十'
  if (n < 30) return `二十${NUM[n - 20]}`
  if (n === 30) return '三十'
  return String(n)
}

/** 固定台詞。陣列的句子用 `<key>.<序號>` 當 key（從 1 起算），輪流取用 */
export const STATIC_LINES: Record<string, string | string[]> = {
  // 答對
  praise: ['答對了！', '好棒喔！', '太厲害了！', '你真聰明！', '你好會想！', '哇，答對了！', '我也想到了！'],
  'praise.gentle': ['哇，你好棒！', '答對了，好厲害喔！', '太棒了，阿悟好開心！'],
  // 答錯與提示
  'hint.answer': '答案在這裡，點點看。',
  'gentle.wrong': ['沒關係喔，我們一起看看。', '不要緊，阿悟陪你一起想。', '沒關係，我們再看一次。'],
  'gentle.answer': '你看，答案在這裡，點點看。',
  // 關卡
  'station.done': '這一站過關了！',
  // 每日冒險
  'daily.done': '今天的冒險完成了！',
  'daily.badge': '今天的冒險完成了，拿到今日徽章囉！',
  'chapter.done': '太棒了，這一章全部通關了！',
  'station.loading': '阿悟正在準備題目。',
  // 離開關卡
  'leave.ask': '要先休息一下嗎？阿悟會記得你玩到哪裡喔。',
  'leave.stay': '好，我們繼續玩！',
  // 拿給我 N 個
  'give.more': '再拿一個喔。',
  'give.less': '多拿了一個，放回去一個喔。',
  'give.count': '我們一起數數看。',
  'give.tap.hint': '點一下東西，就會放進籃子裡。',
  // 拖曳歸類
  'bins.hint': '把東西放進對的籃子裡。',
  'bins.wrong': '這個不是這一籃喔，再試試看。',
  'bins.done': '都放好了！',
  // 步驟排序（生活、自然）
  'order.hint': '照順序，一個一個放進格子裡。',
  'order.wrong': '這個還不是喔，再想想看。',
  'order.done': '順序都排對了！',
  // v6 比大小排序（水簾洞）：把大小不同的東西排進格子。步驟排序的台詞是上面的 order.*
  'sizeorder.wrong': '這一格不是它喔，再想一想。',
  'sizeorder.done': '排好了！',
  // v6 放到某個位置
  'place.wrong': '不是這裡喔，再試試看。',
  'place.done': '放好了！',
  // v6 記憶翻牌
  'flip.match': ['一樣！找到了！', '配對成功！', '哇，一樣的！'],
  'flip.miss': '不一樣喔，記住它們在哪裡。',
  'flip.done': '全部都找到了！',
  'audio.test': '數一數，有幾根香蕉？',
  'lock.sleepy': '我想睡覺了，明天再一起冒險吧',
  'ceremony.done': '今天的冒險完成了！',
  // v7 挑戰站、快速分級、站末結算
  'challenge.open': '挑戰站！連續答對，看看你能連對幾題。',
  'challenge.done': '挑戰完成了！',
  'challenge.badge': '你拿到挑戰徽章了！',
  'placement.ask': '先玩三題，阿悟看看從哪裡開始。',
  'placement.done': '阿悟知道了，我們出發吧！',
  'result.food': '哇，有好吃的！',
  'tutorial.skip': '好，我們直接開始。',
  'tutorial.again': '換你試試看！',
  'tutorial.done': '你學會了！',
  // 阿悟的台詞：開場
  'companion.open': ['今天要去哪裡呢？', '出發囉！', '我準備好了！'],
  'companion.open.tutorial': ['看我做一次喔。', '換你試試看。'],
  'companion.correct': ['你好會想！', '哇，答對了！', '我也想到了！'],
  'companion.hint': ['我們一起想想。', '再看仔細一點點。'],
  'companion.wrong2': ['沒關係，我們看這裡。', '這個有點難，對吧？'],
  'companion.combo2': ['連續答對了！', '你好穩喔！'],
  'companion.combo3': ['三連擊！', '哇，連續三題！'],
  'companion.combo5': ['全部都對！好厲害！', '五題都自己想出來了！'],
  'companion.wrapup': ['這一站我們好棒！', '肚子餓了，想吃桃子。'],
  'companion.boss.open': ['最後一關！大家都在等我們。', '這一站要全部一起加油！'],
  'companion.boss.done': ['我們一起完成了！', '好多好多星星！'],
  // v7.4 H1 重玩已通關的站：開場、完成（阿悟說的話，key 以 companion. 開頭）
  'companion.replay.open': ['再玩一次吧，這次是新的題目！', '這一站我們再走一遍！'],
  'companion.replay.done': '再玩一次，也好棒喔！',
  'companion.tutorial.give': ['看我拿一個，再拿一個。', '拿到剛好，就按好了。'],
  'companion.tutorial.bins': ['看我把它放進籃子裡。', '你也來試試看。'],
  'companion.tutorial.order': ['看我把最小的放在第一格。', '你也來排排看。'],
  'companion.tutorial.place': ['看我把它放到亮亮的位置。', '你也來試試看。'],
  'companion.tutorial.flip': ['看我翻開兩張牌。', '你也來翻翻看。'],
  // 介面旁白（非阿悟）：成功回饋、首頁引導、地圖提示、著色本價格。用 sayText(文字) 依文字找音檔
  'ui.feedback': ['買到囉！', '做好了！', '好棒喔！', '乾淨了！', '放好了！', '好，退回囉'],
  'ui.home.guide': '我們去冒險吧',
  // 阿悟頭上的泡泡台詞（阿悟聲；sayRecorded('pet.', 文字) 播放，沒有預錄就不出聲）
  'pet.bubble': ['嘻嘻', '哈哈哈！', '哈啾！', '哈～', '嗝～', '好睏喔…', '好舒服～', '我吃飽了～', '好飽喔，但是好開心！', '肚子撐撐的，明天再吃好不好？', '整理好囉！', '最喜歡了！', '耶！', '臭臭～', '謝謝你！', '不要再轉了啦～', 'Hello!'],
  'ui.map': ['這一站過關囉，好棒！', '還沒到喔，先去前面的站', '寶箱還鎖著，通關五站就能打開喔'],
  // v6 章節選擇
  'ui.chapter': ['水簾洞還沒開，先通關花果山喔', '水簾洞開門囉！'],
  'ui.coloring.price': ['這張要用30顆星星，在商店換喔', '這張要用40顆星星，在商店換喔', '這張要用50顆星星，在商店換喔'],
  // v7 繪圖板：選筆刷、換畫紙背景
  // v7.4：填色桶、形狀章、新貼紙（接在後面，舊句子的順序不變）
  'ui.paint': ['選一支筆', '換個背景吧', '擦掉不要的地方', '再畫一點好嗎？', '點一下圈起來的地方，就會塗滿', '選一個形狀，點一下就蓋上去', '有新的貼紙喔！'],
  // v5 禮物：阿悟拿出禮物時說的話（句型見 src/domain/giftLines.ts，兩邊要一字不差，gifts.test.ts 會檢查）
  'ui.gift.daily': '今天的小禮物！',
  'ui.gift.collect': '你認識好多朋友，這個送給你！',
  'ui.gift.food': [
    '我在路上撿到一根胡蘿蔔，送給你！',
    '我在路上撿到一片餅乾，送給你！',
    '我在路上撿到一根香蕉，送給你！',
    '我在路上撿到一顆蘋果，送給你！',
    '我在路上撿到一串葡萄，送給你！',
    '我在路上撿到一瓶牛奶，送給你！',
    '我在路上撿到一顆桃子，送給你！',
    '我在路上撿到一個飯糰，送給你！',
    '我在路上撿到一塊西瓜，送給你！',
  ],
  // v5 新招：學會時的慶祝句（預設名字「阿悟」）
  'ui.trick.learn': [
    '阿悟學會了新本領：數香蕉！',
    '阿悟學會了新本領：整理房間！',
    '阿悟學會了新本領：節奏舞！',
    '阿悟學會了新本領：說 Hello！',
    '阿悟學會了新本領：翻筋斗！',
    '阿悟學會了新本領：有禮貌地鞠躬！',
    '阿悟學會了新本領：量身高！',
    '阿悟學會了新本領：捉迷藏！',
    '阿悟學會了新本領：記憶魔術！',
  ],
  // v6 新招表演時阿悟說的話（pet/plan.ts 的 voice，兩邊要一字不差，有單元測試）
  'ui.trick.say': ['矮矮的', '高高！', '我躲起來囉', '找到我了！', '記住囉', '是香蕉！'],
  // v5 圖鑑：點一下唸名字（物件名稱；英文名稱等英文科目上線後再加）
  'ui.friend.name': ['香蕉', '桃子', '蘋果', '葡萄', '小魚', '小雞', '小兔子', '花', '貝殼', '星星', '汽車', '火箭', '皮球', '恐龍', '鋼琴', '章魚', '熊', '牛', '紅蘿蔔', '蛋糕', '餅乾', '牛奶', '西瓜', '床', '時鐘', '燈', '帳篷', '箱子', '桌子', '沙發', '晴天', '下雨天', '下雪天', '刮風天', '春天', '夏天', '秋天', '冬天', '大海', '森林', '農場', '種子', '發芽', '開花', '洗手', '髒髒的手', '亂亂的玩具', '搶玩具', '亂丟垃圾', '收玩具', '排隊', '插隊', '說謝謝', '丟垃圾', '等紅燈', '過馬路', '刷牙', '吃青菜', '遮住嘴巴咳嗽', '睡覺', '紅色', '黃色', '藍色', '綠色', '粉紅色', '紫色', '數字一', '數字二', '數字三', '數字四', '數字五', '數字六', '數字七', '數字八', '數字九', '數字十'],
  // v5 結束儀式：遊玩時間剩 2 分鐘
  'ui.timewarn': '再玩一下下就要睡覺囉',
  // v6 帽子衣櫃：買到、戴上、拿下（句型見 src/domain/hats.ts，兩邊要一字不差，hats.test.ts 會檢查）
  'ui.hat.buy': ['買到派對帽囉！', '買到棒球帽囉！', '買到花花帽囉！', '買到草帽囉！', '買到廚師帽囉！', '買到皇冠囉！'],
  'ui.hat.wear': ['阿悟戴上了派對帽！', '阿悟戴上了棒球帽！', '阿悟戴上了花花帽！', '阿悟戴上了草帽！', '阿悟戴上了廚師帽！', '阿悟戴上了皇冠！'],
  'ui.hat.off': '好，帽子拿下來囉',
  'ui.hat.egg': '阿悟還在蛋裡，孵出來才能戴帽子',
  'ui.hat.empty': '還沒有帽子，去商店的衣櫃買一頂吧',
  // v7 線 C：禮物袋、佈置、onboarding 年齡頁、歡迎禮物、成長里程碑（句子來源在 src/domain/home7.ts 的 HOME_LINES，
  // 兩邊要一字不差，home7.test.ts 會檢查；阿悟說的話 key 以 pet. 開頭，語音生成工具用阿悟聲）
  'pet.gift.thanks': ['哇，好多禮物！', '謝謝你，我最喜歡了！'],
  'ui.gift.bag': '禮物都收下囉！',
  'ui.gift.bagHint': '點一下，收下禮物',
  'ui.edit.workshop': '去工坊做家具吧',
  'ui.edit.allPlaced': '家具都擺好了，去工坊再做一些吧',
  'ui.edit.tint': '換個顏色吧',
  'ui.edit.full': '這個最多擺三個喔',
  'ui.onboard.age': '你幾歲了？',
  'ui.onboard.age3': '三歲',
  'ui.onboard.age45': '四到五歲',
  'ui.onboard.age67': '六到七歲',
  'pet.welcome': '歡迎你！這是給你的禮物！',
  'pet.milestone': '我又長大一點了，送你一個小禮物！',
  'ui.workshop.more': '再做一個',
  // v7.1 畫框收藏：完成慶祝解鎖新畫框、點到還沒解鎖的畫框（句子來源在 src/domain/frames.ts 的 FRAME_LINES，兩邊要一字不差，frames.test.ts 會檢查）
  'ui.frame.unlock': '解鎖新畫框！',
  'ui.frame.locked': '再多畫幾幅，這個畫框就是你的了',
  'ui.frame.pick': '幫這幅畫選一個畫框',
  // v7.2 連連看（點點連線）：開場提示、換到新頁、連完阿悟說的話（句子來源在 src/art/dots/dots.ts 的 DOTS_LINES，兩邊要一字不差，dots.test.ts 會檢查）
  'ui.dots.start': '從數字一開始，一個一個連起來',
  'ui.dots.startAbc': '從字母 A 開始，一個一個連起來',
  'ui.dots.price': '這張要用20顆星星換喔',
  'ui.dots.opened': '換到囉，開始連吧！',
  'pet.dots.done': ['哇，是星星！你連出來了！', '哇，是小魚！你連出來了！', '哇，是香蕉！你連出來了！', '哇，是蘋果！你連出來了！', '哇，是小兔子！你連出來了！', '哇，是小雞！你連出來了！', '哇，是小熊！你連出來了！', '哇，是章魚！你連出來了！', '哇，是西瓜！你連出來了！', '哇，是花！你連出來了！', '哇，是蛋糕！你連出來了！', '哇，是阿悟！你連出來了！'],
  // v7.3 繪圖板：還沒塗的地方、全部塗滿、完成獎勵（句子來源在 src/domain/paintReward.ts 的 PAINT_LINES，兩邊要一字不差，paintReward.test.ts 會檢查；阿悟說的話 key 以 pet. 開頭）
  'pet.paint.more': '還有這些地方喔',
  'pet.paint.full': '全部塗滿了！',
  'pet.paint.stars': '得到五顆星星囉！',
  // v7.4 線 J：隔天回來阿悟餓了的第一句話、「我的東西」各分頁與成長相簿的空狀態（句子來源在 src/domain/home74.ts 的 J74_LINES，兩邊要一字不差，home74.test.ts 會檢查；阿悟說的話 key 以 pet. 開頭）
  'pet.hungry.back': '你回來了！我肚子有點餓餓的',
  'pet.empty.food': '還沒有食物，我們去冒險找吧！',
  'pet.empty.material': '還沒有材料，我們去冒險找材料吧！',
  'pet.empty.sticker': '還沒有貼紙，去畫畫、收小禮物就會有喔',
  'pet.empty.album': '我們一起去冒險，回憶卡就會出現囉',
  // v8.2 線 S：走進每個地方時寵物說的第一句（一次開啟每個地方只說一次，見 src/ui/components/Place.tsx）
  'pet.place.shop': '歡迎光臨！今天想吃什麼呢？',
  'pet.place.workshop': '叮叮咚咚，我們來做東西！',
  'pet.place.bag': '來看看我們有什麼寶貝！',
  'pet.place.tasks': '今天要做哪一件事呢？',
  'pet.place.art': '拿起畫筆，我們來畫畫！',
  'pet.place.gallery': '這裡是你的美術館喔！',
  'pet.place.friends': '這些都是我們認識的朋友！',
  'pet.place.album': '這是我們的回憶喔！',
  // v8.3 遊樂場：寵物的台詞（三種寵物各錄一次）
  'pet.place.playground': '哇，遊樂場！你想玩什麼呢？',
  'pet.play.reward': '這個送給你，謝謝你陪我玩！',
  'pet.play.bubbles.intro': '戳戳泡泡，看看裡面有什麼！',
  'pet.play.bubbles.big': '哇，好大的彩虹泡泡！',
  'pet.play.bubbles.done': '泡泡派對好好玩！',
  'pet.play.catch.intro': '幫我把水果接住！',
  'pet.play.catch.more': '比上次接到更多耶！',
  'pet.play.catch.done': '哇，接到好多水果！',
  'pet.play.memory.intro': '翻翻看，找出一樣的！',
  'pet.play.memory.match': '一樣的！你好厲害！',
  'pet.play.memory.miss': '不一樣耶，再看一次喔。',
  'pet.play.memory.done': '全部都找到了！',
  'pet.play.hide.intro': '我要躲起來囉，快來找我！',
  'pet.play.hide.count': '一，二，三，來找我！',
  'pet.play.hide.empty': '不在這裡喔，再找找看！',
  'pet.play.hide.found': '被你找到了！',
  'pet.play.hide.again': '再玩一次！我要換地方躲囉！',
  'pet.play.music.intro': '按按看，我來跳舞！',
  'pet.play.music.song': '這首歌好好聽！',
  'pet.play.bath.intro': '我要洗澎澎！幫我抹泡泡！',
  'pet.play.bath.rinse': '好舒服！現在沖沖水！',
  'pet.play.bath.dry': '幫我擦乾乾！',
  'pet.play.bath.done': '我變得香香的了！',
  'pet.play.talk.intro': '跟我說話，我會學你喔！',
  'pet.play.talk.again': '再跟我說一句！',
  'pet.play.bakery.intro': '我們來做點心！先選一個！',
  'pet.play.bakery.decorate': '放上你喜歡的東西！',
  'pet.play.bakery.give': '做好了嗎？送給我吃！',
  'pet.play.bakery.yum': '哇，這是我吃過最好吃的！',
  'pet.play.garden.intro': '我們來種東西！選一種種子！',
  'pet.play.garden.water': '幫它澆澆水！',
  'pet.play.garden.grow': '它長大了一點點！',
  'pet.play.garden.tomorrow': '它要睡覺了，明天再來看它！',
  'pet.play.garden.ready': '可以採收囉！',
  'pet.play.garden.harvest': '好棒，收到背包了！',
  // v8.4 快樂小街（程式裡叫 town）：扮家家酒的 8 個地方
  'pet.place.town': '這裡是快樂小街！你想去哪裡呢？',
  'pet.play.town.hint': '要不要搭公車，去快樂小街玩？',
  'pet.play.doctor.intro': '我有點不舒服，醫生幫我看看！',
  'pet.play.doctor.sneeze': '哈啾！我一直打噴嚏。',
  'pet.play.doctor.tummy': '我的肚子咕嚕咕嚕叫。',
  'pet.play.doctor.knee': '我跌倒了，膝蓋擦破一點點。',
  'pet.play.doctor.throat': '我的喉嚨癢癢的。',
  'pet.play.doctor.thermo': '量體溫，沒有發燒喔！',
  'pet.play.doctor.heart': '咚咚咚，這是我的心跳聲！',
  'pet.play.doctor.ahh': '啊，你看到我的喉嚨了嗎？',
  'pet.play.doctor.bandage': '貼上去了，不痛了！',
  'pet.play.doctor.medicine': '甜甜的，好好喝！',
  'pet.play.doctor.wrong': '好癢喔，不是這裡啦！',
  'pet.play.doctor.done': '謝謝醫生，我好多了！',
  'pet.play.bedtime.intro': '天黑了，我們準備睡覺吧！',
  'pet.play.bedtime.brush': '刷刷牙，上面刷刷，下面刷刷。',
  'pet.play.bedtime.brushed': '牙齒亮晶晶！',
  'pet.play.bedtime.pajamas': '幫我換上睡衣好嗎？',
  'pet.play.bedtime.story': '要聽故事，還是唱歌呢？',
  'pet.play.bedtime.sleepy': '我好想睡喔。',
  'pet.play.bedtime.light': '幫我把燈關掉好嗎？',
  'pet.play.bedtime.night': '晚安，明天見。',
  'pet.play.bedtime.dream': '嘻嘻，我夢到好多好吃的。',
  'pet.play.market.intro': '我們去買東西！看看清單要買什麼。',
  'pet.play.market.add': '放進購物車！',
  'pet.play.market.extra': '這個也想要嗎？',
  'pet.play.market.pay': '要付錢囉，把硬幣放進去！',
  'pet.play.market.change': '給太多了，找你錢！',
  'pet.play.market.done': '買好了，謝謝光臨！',
  'pet.play.juice.intro': '有客人來了！幫他做果汁吧！',
  'pet.play.juice.peek': '客人想要什麼呢？點點他看看。',
  'pet.play.juice.blend': '轉轉轉，打果汁囉！',
  'pet.play.juice.yum': '好好喝！客人好開心！',
  'pet.play.juice.funny': '咦，味道好特別喔！再做一杯好嗎？',
  'pet.play.juice.done': '每位客人都喝到果汁了！',
  'pet.play.blocks.intro': '我們來蓋積木！要蓋得高高的嗎？',
  'pet.play.blocks.top': '我爬到最上面了！',
  'pet.play.blocks.crash': '轟隆！哈哈哈，倒下來了！',
  'pet.play.blocks.copy': '照著藍圖，蓋一個一樣的吧！',
  'pet.play.blocks.match': '一模一樣！你好厲害！',
  'pet.play.puzzle.intro': '來拼拼圖！選一張圖吧。',
  'pet.play.puzzle.mine': '這是你畫的圖耶！',
  'pet.play.puzzle.snap': '拼上去了！',
  'pet.play.puzzle.done': '拼好了！好漂亮！',
  'pet.play.drive.intro': '上車囉！我們去兜風！',
  'pet.play.drive.red': '紅燈了，停下來等一等。',
  'pet.play.drive.green': '綠燈了，可以走囉！',
  'pet.play.drive.cross': '有小動物要過馬路，等他們過去。',
  'pet.play.drive.rider': '有朋友要搭車！',
  'pet.play.drive.where': '他想去那個顏色的房子。',
  'pet.play.drive.arrive': '到了！謝謝你載我！',
  'pet.play.photo.intro': '來拍照！選一個你喜歡的地方。',
  'pet.play.photo.pose': '我要站在哪裡呢？',
  'pet.play.photo.ready': '準備好了嗎？一，二，三！',
  'pet.play.photo.saved': '拍好了！放進畫廊囉！',
  'pet.play.photo.full': '照片放滿了，請爸爸媽媽幫忙整理。',
  // v8.5 越玩越多：玩完就有的新玩具（pet.toy.<遊戲>.<玩具>）與新玩法的台詞
  'pet.play.newtoy': '哇，有新玩具了！',
  'pet.play.crown': '你玩了好多次，送你一頂皇冠！',
  'pet.toy.bubbles.animals': '有小動物躲在泡泡裡面耶！',
  'pet.toy.bubbles.wand': '用泡泡棒可以吹出好多泡泡！',
  'pet.toy.catch.gold': '有草莓和橘子了，還有金色的水果喔！',
  'pet.toy.catch.rain': '最後會下水果雨喔！',
  'pet.toy.memory.animals': '有動物的牌可以選了！',
  'pet.toy.memory.peek': '按魔法棒，可以偷看一下喔！',
  'pet.toy.hide.swap': '下次換你藏，我來找！',
  'pet.toy.hide.night': '晚上也可以玩，用手電筒照照看！',
  'pet.toy.music.songs': '有兩首新歌可以彈了！',
  'pet.toy.music.voices': '可以換聲音了，喵喵喵！',
  'pet.toy.bath.bomb': '丟一顆沐浴球，水會變顏色喔！',
  'pet.toy.bath.foamhat': '點我頭上的泡泡，幫我做造型！',
  'pet.toy.bakery.bases': '可以做甜甜圈和杯子蛋糕了！',
  'pet.toy.bakery.piping': '用擠花袋畫奶油！',
  'pet.toy.garden.sprinkler': '有灑水器了，一次全部澆水！',
  'pet.toy.garden.butterfly': '蝴蝶會來我們的菜園玩喔！',
  'pet.toy.doctor.ailments': '下次我可能會發燒，也可能一直打嗝。',
  'pet.toy.doctor.xray': '用這個可以照到我的骨頭喔！',
  'pet.toy.bedtime.doll': '我想抱一個玩偶睡覺！',
  'pet.toy.bedtime.projector': '關燈以後點夜燈，天花板會變漂亮喔！',
  'pet.toy.market.goods': '超市有新東西了！',
  'pet.toy.market.boss': '換你當老闆，我來買東西！',
  'pet.toy.juice.fruits': '有草莓和橘子可以打果汁了！',
  'pet.toy.juice.deco': '果汁可以加吸管和小雨傘了！',
  'pet.toy.blocks.parts': '有輪子、窗戶和旗子可以蓋了！',
  'pet.toy.blocks.tenants': '蓋高一點，小動物會來住喔！',
  'pet.toy.puzzle.pics': '有新的圖片可以拼了！',
  'pet.toy.puzzle.jigsaw': '拼圖有新的形狀了！',
  'pet.toy.drive.cars': '可以開消防車和冰淇淋車了！',
  'pet.toy.drive.wash': '路上有洗車站了，去洗一洗吧！',
  'pet.toy.photo.friends': '可以找動物朋友一起拍照了！',
  'pet.toy.photo.frames': '照片可以加相框了！',
  'pet.play.bubbles.animal': '小動物跑出來了！',
  'pet.play.catch.gold': '金色的！好厲害！',
  'pet.play.catch.rain': '水果雨來囉！',
  'pet.play.memory.peek': '偷看一下，記起來喔！',
  'pet.play.hide.swap.ask': '把球藏起來，我不偷看！',
  'pet.play.hide.swap.count': '一，二，三，我來找囉！',
  'pet.play.hide.swap.miss': '咦，不在這裡。',
  'pet.play.hide.swap.found': '找到了！你好會藏喔！',
  'pet.play.hide.night': '好暗喔，用手電筒照一照！',
  'pet.play.music.meow': '喵喵喵，好好笑！',
  'pet.play.bath.bomb': '哇，水變顏色了！',
  'pet.play.bakery.piping': '擠一擠，畫出奶油！',
  'pet.play.garden.sprinkler': '下雨囉，大家喝水！',
  'pet.play.doctor.fever': '我的頭熱熱的。',
  'pet.play.doctor.hiccup': '嗝！我一直打嗝。',
  'pet.play.doctor.icepack': '冰冰的，好舒服。',
  'pet.play.doctor.water': '咕嚕咕嚕，不打嗝了！',
  'pet.play.doctor.xray': '哇，看到我的骨頭了！',
  'pet.play.bedtime.doll': '抱著玩偶，好舒服。',
  'pet.play.market.boss.want': '老闆，我要買這些。',
  'pet.play.market.boss.pay': '給你錢！',
  'pet.play.market.boss.change': '要找錢給我喔。',
  'pet.play.market.boss.thanks': '謝謝老闆！',
  'pet.play.juice.deco': '要不要加一支吸管？',
  'pet.play.blocks.tenant': '有小動物搬進來了！',
  'pet.play.drive.fire': '喔咿喔咿，消防車出動！',
  'pet.play.drive.ice': '冰淇淋車來囉！',
  'pet.play.drive.wash': '刷刷刷，洗乾淨了！',
  'pet.play.photo.friend': '一起拍照，笑一個！',
  'pet.paint.free': '再多畫幾筆，或貼一張貼紙吧',
  'pet.gallery.empty': '還沒有畫畫喔，我們去畫一張吧',
  // v6 成長相簿：回憶卡上的一句話（句型見 src/domain/album.ts；學會新招那張和 ui.trick.learn 同一句，不重複列）
  'ui.album.card': [
    '阿悟孵出來了！',
    '阿悟長大了！',
    '我們一起通關了花果山！',
    '我們一起通關了英文小島！',
    '我們一起通關了水簾洞！',
    '我們一起通關了生活小鎮！',
    '我們一起通關了自然森林！',
    '阿悟有第一頂帽子了：派對帽！',
    '阿悟有第一頂帽子了：棒球帽！',
    '阿悟有第一頂帽子了：花花帽！',
    '阿悟有第一頂帽子了：草帽！',
    '阿悟有第一頂帽子了：廚師帽！',
    '阿悟有第一頂帽子了：皇冠！',
  ],
  // v8.1 線 P：有聲繪本「小星的故事」的旁白（媽媽聲）。文字照 SPEC-v8 台詞表，一字不改；頁面、圖、演出在 src/learning/story.ts
  'story.prologue': ['有一天晚上，一顆小星星從天上掉了下來。', '她叫小星。小星的光不見了，回不了家。阿悟說：別怕，我陪你找回來！'],
  'story.huaguoshan.open': ['花果山的桃樹都睡著了，一朵花也沒開。', '小星的粉紅色光，就藏在山路上。我們一站一站去找！'],
  'story.huaguoshan.close': ['找到了！粉紅色的光回來了，桃花一朵一朵開了。', '小星亮了一點點。花果山的大家都說：謝謝你們！'],
  'story.shuiliandong.open': ['瀑布後面有一個山洞，裡面黑黑的，大家都不敢進去。', '水滴裡有藍色的光在閃。阿悟牽著小星，勇敢走進去。'],
  'story.shuiliandong.close': ['藍色的光回來了，整個山洞都亮晶晶。', '原來山洞一點也不可怕。小星又亮了一點點！'],
  'story.english.open': ['海上漂來好多瓶子，瓶子裡的字，大家都看不懂。', '小星的黃色光，就在燈塔裡。學會這些英文，就能把燈塔點亮！'],
  'story.english.close': ['燈塔亮了！小船都平平安安回家了。', '小星又亮了一點點，海鷗也開心得轉圈圈。'],
  'story.life.open': ['生活小鎮今天亂糟糟，大家都忘了好習慣。', '小星的橘色光，躲在小鎮裡。我們幫大家想起來吧！'],
  'story.life.close': ['廣場乾乾淨淨，大家排隊、洗手、說謝謝。', '橘色的光回來了。小鎮的每一扇窗都亮起來了。'],
  'story.nature.open': ['森林裡好安靜，小動物都躲起來了。', '綠色的光像螢火蟲，飛進了森林深處。我們去認識森林的朋友！'],
  'story.nature.close': ['小鳥唱歌，小鹿跑跑跳跳，森林醒過來了！', '綠色的光回來了。小星又亮了一點點！'],
  'story.finale': ['粉紅、藍色、黃色、橘色、綠色，小星的光全部回來了！', '小星飛回天上，變成最亮的那一顆。每天晚上，她都會對阿悟眨眨眼。'],
}

/** 取出固定台詞的所有句子：key → 文字 */
export function staticLineList(): Line[] {
  const out: Line[] = []
  for (const [k, v] of Object.entries(STATIC_LINES)) {
    if (Array.isArray(v)) v.forEach((text, i) => out.push({ key: `${k}.${i + 1}`, text }))
    else out.push({ key: k, text: v })
  }
  return out
}

/** 從固定台詞輪流取一句（i 由呼叫端決定，例如題號）。回傳 key 與文字 */
export function pickLine(group: string, i = 0): Line {
  const v = STATIC_LINES[group]
  if (Array.isArray(v)) {
    const n = ((i % v.length) + v.length) % v.length
    return { key: `${group}.${n + 1}`, text: v[n] }
  }
  return { key: group, text: v ?? '' }
}

/**
 * 幼幼模式答錯時，提示前面加的一句鼓勵（固定文字，讓每題的提示音檔 key 穩定）。
 * v7.5：不提寵物的名字（以前是「沒關係喔，有阿悟陪你。」），三種寵物共用同一批音檔，之後加物種也不用重錄
 */
export const GENTLE_PREFIX = '沒關係喔，我陪你一起看。'
export const gentleHintKey = (id: string): string => `q.${id}.hint.gentle`
export const gentleHintText = (hint: string): string => `${GENTLE_PREFIX}${hint}答案在這裡，點點看。`

/** 一題會唸到的所有句子 */
export function questionLines(q: Pick<Question, 'id' | 'skill' | 'prompt' | 'hint' | 'params'>): Line[] {
  const out: Line[] = [
    { key: questionKey(q.id, 'prompt'), text: q.prompt },
    { key: questionKey(q.id, 'hint'), text: q.hint },
    { key: gentleHintKey(q.id), text: gentleHintText(q.hint) },
  ]
  if (isKidVariant(q)) {
    out.push({ key: questionKey(q.id, 'prompt', true), text: kidText(q.prompt) })
    out.push({ key: questionKey(q.id, 'hint', true), text: kidText(q.hint) })
    out.push({ key: `${gentleHintKey(q.id)}.kid`, text: gentleHintText(kidText(q.hint)) })
  }
  for (const w of q.params?.words ?? []) if (w) out.push({ key: wordKey(w), text: w })
  return out
}

/** 全部句子（題庫 + 固定台詞 + 數字），key 唯一 */
export function allLines(bank: Pick<Question, 'id' | 'skill' | 'prompt' | 'hint' | 'params'>[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const l of staticLineList()) out[l.key] = l.text
  for (let n = 0; n <= 30; n++) out[numberKey(n)] = chineseNumber(n)
  for (let n = 1; n <= 20; n++) out[totalKey(n)] = totalText(n)
  out[wordKey('空格')] = '空格'
  out['gentle.prefix'] = GENTLE_PREFIX
  for (const q of bank) for (const l of questionLines(q)) out[l.key] = l.text
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)))
}
