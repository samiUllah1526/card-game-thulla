import { describe, expect, it } from 'vitest'
import { botDisplayName, seatsToFill } from './plan'

describe('seatsToFill', () => {
  it('fills a count, everyone but the host, or nobody', () => {
    expect(seatsToFill(4, '0')).toEqual([])
    expect(seatsToFill(4, '2')).toEqual(['1', '2'])
    expect(seatsToFill(4, 'rest')).toEqual(['1', '2', '3'])
    expect(seatsToFill(4, '9')).toEqual(['1', '2', '3'])
    expect(seatsToFill(3, 'nope')).toEqual([])
  })
})

describe('botDisplayName', () => {
  it('uses the name list and skips a name already at the table', () => {
    expect(botDisplayName('1', [])).toBe('Rafi')
    expect(botDisplayName('2', [])).toBe('Meera')
    expect(botDisplayName('1', ['Rafi'])).toBe('Rafi 2')
  })
})
