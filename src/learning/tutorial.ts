import type { Interaction, Question } from './types'

/** 需要教學示範的互動（每種互動第一次出現時，阿悟先示範一次；不計分、不寫作答紀錄） */
export const TUTORIAL_INTERACTIONS: Interaction[] = ['tapN', 'dragSort', 'dragOrder', 'place', 'flip']
export const needsTutorial = (it: Interaction | undefined, seen: ReadonlySet<string>): it is Interaction =>
  !!it && TUTORIAL_INTERACTIONS.includes(it) && !seen.has(it)

/** 教學用的練習題（不在題庫裡，id 以 tutorial- 開頭，不會被記錄） */
/** petName：v7.5 陪你冒險的寵物名字（「請拿一根香蕉給兔兔。」）；預設阿悟 */
export function tutorialQuestion(it: Interaction, petName = '阿悟'): Question {
  if (it === 'tapN') {
    return {
      id: 'tutorial-tapN',
      skill: 'number',
      difficulty: 1,
      type: 'give',
      interaction: 'tapN',
      prompt: `請拿一根香蕉給${petName}。`,
      items: [],
      choices: [],
      answer: '1',
      hint: '點一下香蕉，放進籃子，再按「好了」。',
      params: { n: 1, pool: 3, obj: 'obj-banana' },
      version: 1,
    }
  }
  if (it === 'dragOrder') {
    // 三顆蘋果，大小不同：由小排到大。items 洗過牌，order = 每格該放第幾個
    return {
      id: 'tutorial-dragOrder',
      skill: 'measure',
      difficulty: 1,
      type: 'order',
      interaction: 'dragOrder',
      prompt: '由小排到大。',
      items: [
        { obj: 'obj-apple', scale: 1 },
        { obj: 'obj-apple', scale: 0.5 },
        { obj: 'obj-apple', scale: 0.75 },
      ],
      choices: [],
      answer: 'sorted',
      hint: '最小的放第一格。',
      params: { dim: 'size', dir: 'asc', itemOrder: [1, 2, 0] },
      version: 1,
    }
  }
  if (it === 'place') {
    return {
      id: 'tutorial-place',
      skill: 'space',
      difficulty: 1,
      type: 'place',
      interaction: 'place',
      prompt: '把小雞放到箱子的上面。',
      items: [],
      choices: [],
      answer: 'sorted',
      hint: '上面，就是在箱子的頭頂上。',
      params: {
        anchors: ['decor-crate'],
        subject: 'obj-chick',
        zones: [
          { id: 'z1', rel: 'above', of: 0 },
          { id: 'z2', rel: 'below', of: 0 },
        ],
        target: 'z1',
        rel: 'above',
        of: 0,
      },
      version: 1,
    }
  }
  if (it === 'flip') {
    return {
      id: 'tutorial-flip',
      skill: 'observe',
      difficulty: 1,
      type: 'flip',
      interaction: 'flip',
      prompt: '翻開牌，找出一樣的兩張。',
      items: [{ obj: 'obj-apple' }, { obj: 'obj-fish' }, { obj: 'obj-fish' }, { obj: 'obj-apple' }],
      choices: [],
      answer: 'matched',
      hint: '先翻開一張，再翻開另一張，一樣的就會留下來。',
      params: { cols: 2, rows: 2 },
      version: 1,
    }
  }
  return {
    id: 'tutorial-dragSort',
    skill: 'classify',
    difficulty: 2,
    type: 'bins',
    interaction: 'dragSort',
    prompt: '把水果和動物分開，放進對的籃子裡。',
    items: [{ obj: 'obj-apple' }, { obj: 'obj-fish' }],
    choices: [],
    answer: 'sorted',
    hint: '蘋果是水果，小魚是動物。',
    params: {
      bins: [
        { id: 'b1', label: '水果', obj: 'obj-peach' },
        { id: 'b2', label: '動物', obj: 'obj-rabbit' },
      ],
      targets: ['b1', 'b2'],
    },
    version: 1,
  }
}
export const isTutorialId = (id: string): boolean => id.startsWith('tutorial-')
