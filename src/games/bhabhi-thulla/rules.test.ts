import { describe, expect, it } from 'vitest'
import {
  createDeck,
  deal,
  highestLedSuit,
  isLegalPlay,
  legalCards,
  nextActive,
} from './rules'
import type { Card } from './types'

const cards: Card[] = [
  { id: 'S-14', suit: 'S', rank: 14 },
  { id: 'S-2', suit: 'S', rank: 2 },
  { id: 'H-13', suit: 'H', rank: 13 },
]

describe('Bhabhi Thulla rules', () => {
  it('creates and evenly deals a standard deck', () => {
    const deck = createDeck()
    const hands = deal(deck, 5)
    expect(deck).toHaveLength(52)
    expect(Object.values(hands).flat()).toHaveLength(52)
    expect(Math.max(...Object.values(hands).map((hand) => hand.length))).toBe(11)
    expect(Math.min(...Object.values(hands).map((hand) => hand.length))).toBe(10)
  })

  it('forces a player to follow suit when possible', () => {
    expect(legalCards(cards, 'S').map((card) => card.id)).toEqual(['S-14', 'S-2'])
    expect(isLegalPlay(cards, 'H-13', 'S')).toBe(false)
  })

  it('allows any card when the player cannot follow suit', () => {
    expect(legalCards([cards[2]], 'S')).toEqual([cards[2]])
    expect(isLegalPlay([cards[2]], 'H-13', 'S')).toBe(true)
  })

  it('finds the highest card in the led suit only', () => {
    const winner = highestLedSuit(
      [
        { playerID: '0', card: cards[1] },
        { playerID: '1', card: cards[2] },
        { playerID: '2', card: cards[0] },
      ],
      'S',
    )
    expect(winner.playerID).toBe('2')
  })

  it('rotates clockwise over eliminated seats', () => {
    expect(nextActive(['0', '2', '4'], '0')).toBe('2')
    expect(nextActive(['0', '2', '4'], '4')).toBe('0')
    expect(nextActive(['0', '4'], '2')).toBe('4')
  })
})
