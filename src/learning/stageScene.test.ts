import { describe, expect, it } from 'vitest'
import { CHAPTERS } from './chapter'
import { challengeChapterId, dailyChapterId, replayChapterId, SUBJECTS } from './subject'
import { STAGE_SCENE_KEYS, stageSceneFile, stageSceneKey } from './stageScene'

describe('關卡場景背景對應', () => {
  it('每一個章節都有場景 key，而且是五個之一', () => {
    for (const c of CHAPTERS) expect(STAGE_SCENE_KEYS).toContain(stageSceneKey(c.id))
  })
  it('五個場景都有章節用到', () => {
    expect(new Set(CHAPTERS.map((c) => stageSceneKey(c.id)))).toEqual(new Set(STAGE_SCENE_KEYS))
  })
  it('章節對應', () => {
    expect(stageSceneKey('huaguoshan')).toBe('huaguoshan')
    expect(stageSceneKey('shuiliandong')).toBe('shuiliandong')
    expect(stageSceneKey('english-island')).toBe('english')
    expect(stageSceneKey('life-town')).toBe('life')
    expect(stageSceneKey('nature-forest')).toBe('nature')
  })
  it('每日冒險用該科的場景', () => {
    expect(stageSceneKey(dailyChapterId('math'))).toBe('huaguoshan')
    expect(stageSceneKey(dailyChapterId('english'))).toBe('english')
    expect(stageSceneKey(dailyChapterId('life'))).toBe('life')
    expect(stageSceneKey(dailyChapterId('nature'))).toBe('nature')
    for (const s of SUBJECTS) expect(stageSceneKey(dailyChapterId(s.id))).not.toBeNull()
  })
  it('挑戰站與重玩用原章節的場景', () => {
    expect(stageSceneKey(challengeChapterId('shuiliandong'))).toBe('shuiliandong')
    expect(stageSceneKey(replayChapterId('nature-forest'))).toBe('nature')
  })
  it('不認識的章節沒有場景（畫面退回漸層）', () => {
    expect(stageSceneKey('nowhere')).toBeNull()
    expect(stageSceneKey('daily:nothing')).toBeNull()
  })
  it('檔名', () => {
    expect(stageSceneFile('life')).toBe('art/scene-stage-life.jpg')
  })
})
