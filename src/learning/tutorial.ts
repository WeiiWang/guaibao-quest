import type { Interaction, Question } from './types'

/** 需要教學示範的互動（每種互動第一次出現時，阿悟先示範一次；不計分、不寫作答紀錄） */
export const TUTORIAL_INTERACTIONS: Interaction[] = ['tapN', 'dragSort']
export const needsTutorial = (it: Interaction | undefined, seen: ReadonlySet<string>): it is Interaction =>
  !!it && TUTORIAL_INTERACTIONS.includes(it) && !seen.has(it)

/** 教學用的練習題（不在題庫裡，id 以 tutorial- 開頭，不會被記錄） */
export function tutorialQuestion(it: Interaction): Question {
  if (it === 'tapN') {
    return {
      id: 'tutorial-tapN',
      skill: 'number',
      difficulty: 1,
      type: 'give',
      interaction: 'tapN',
      prompt: '請拿一根香蕉給阿悟。',
      items: [],
      choices: [],
      answer: '1',
      hint: '點一下香蕉，放進籃子，再按「好了」。',
      params: { n: 1, pool: 3, obj: 'obj-banana' },
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
