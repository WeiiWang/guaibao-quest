import { describe, expect, it } from 'vitest'
import { STATIC_LINES } from '../../learning/lines'
import { firstVisit, type PlaceId } from './Place'

describe('v8.2 走進地方的招呼', () => {
  it('一次開啟每個地方只招呼一次，各地方互不影響', () => {
    expect(firstVisit('shop')).toBe(true)
    expect(firstVisit('shop')).toBe(false)
    expect(firstVisit('album')).toBe(true)
  })
  it('每個地方都有一句台詞', () => {
    const places: PlaceId[] = ['shop', 'workshop', 'bag', 'tasks', 'art', 'gallery', 'friends', 'album']
    for (const p of places) expect(typeof STATIC_LINES[`pet.place.${p}`]).toBe('string')
  })
})
