import { describe, expect, it } from 'vitest'
import { nextGuestName, parseJoinPath } from './lobby'

describe('nextGuestName', () => {
  it('starts at guest1 on an empty table', () => {
    expect(nextGuestName([{ id: 0 }, { id: 1 }, { id: 2 }])).toBe('guest1')
  })

  it('uses guest2 when guest1 is taken', () => {
    expect(
      nextGuestName([
        { id: 0, name: 'guest1' },
        { id: 1 },
        { id: 2 },
      ]),
    ).toBe('guest2')
  })

  it('ignores unrelated names', () => {
    expect(
      nextGuestName([
        { id: 0, name: 'Ali' },
        { id: 1, name: 'Bea' },
        { id: 2 },
      ]),
    ).toBe('guest1')
  })

  it('skips guest names case-insensitively and fills gaps', () => {
    expect(
      nextGuestName([
        { id: 0, name: 'Guest2' },
        { id: 1, name: 'GUEST1' },
        { id: 2, name: 'Cam' },
      ]),
    ).toBe('guest3')
  })
})

describe('parseJoinPath', () => {
  it('reads /join/:code', () => {
    expect(parseJoinPath('/join/abc123')).toBe('abc123')
  })

  it('rejects other paths', () => {
    expect(parseJoinPath('/')).toBeNull()
    expect(parseJoinPath('/join')).toBeNull()
    expect(parseJoinPath('/join/abc/extra')).toBeNull()
  })
})
