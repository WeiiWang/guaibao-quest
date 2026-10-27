import { ANIMAL_BY_ID } from '../../../learning/lifeNature'
import { getObject } from '../../../learning/objects'

/** 拖曳歸類裡東西的名字：數學的學習物件，或自然科目的動物（牛、熊、章魚） */
export const itemName = (id: string): string => getObject(id)?.name ?? ANIMAL_BY_ID[id]?.name ?? id
