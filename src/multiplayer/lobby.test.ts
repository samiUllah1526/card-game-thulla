import { describe, expect, it } from 'vitest'
import { nextGuestName, parseJoinPath, shouldReconnect } from './lobby'

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

describe('shouldReconnect', () => {
  const seat = { matchID: 'table-1' }

  it('sits back down when the browser reopens the same link', () => {
    expect(shouldReconnect(seat, 'table-1', null)).toBe(true)
  })

  it('sits back down when the app reopens with no link', () => {
    expect(shouldReconnect(seat, null, null)).toBe(true)
  })

  it('does not steal a seat from a watch link', () => {
    expect(shouldReconnect(seat, null, 'table-1')).toBe(false)
  })

  it('leaves a different table on the choice screen', () => {
    expect(shouldReconnect(seat, 'other-table', null)).toBe(false)
    expect(shouldReconnect(null, 'table-1', null)).toBe(false)
  })
})
