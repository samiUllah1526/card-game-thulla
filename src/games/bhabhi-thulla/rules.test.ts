import { describe, expect, it } from 'vitest'
import { config } from '../../config'
import {
  addEvent,
  createDeck,
  deal,
  forfeitPlayer,
  highestLedSuit,
  isLegalPlay,
  legalCards,
  nextActive,
  pickupPending,
  resolveTrick,
} from './rules'
import type { BhabhiState, Card } from './types'

function stateWithTrick(): BhabhiState {
  return {
    hands: { '0': [], '1': [{ id: 'C-5', suit: 'C', rank: 5 }], '2': [{ id: 'D-9', suit: 'D', rank: 9 }] },
    handCounts: { '0': 0, '1': 1, '2': 1 },
    waste: [],
    wasteCount: 0,
    trick: [
      { playerID: '0', card: { id: 'S-10', suit: 'S', rank: 10 } },
      { playerID: '1', card: { id: 'S-12', suit: 'S', rank: 12 } },
      { playerID: '2', card: { id: 'H-3', suit: 'H', rank: 3 } },
    ],
    ledSuit: 'S',
    pickupCount: 0,
    trickCount: 0,
    active: ['0', '1', '2'],
    gotAway: [],
    leader: '0',
    turnPlayer: '2',
    firstLeader: '0',
    firstTrick: false,
    started: true,
    hostID: '0',
    phase: 'follow',
    events: [],
    shuffleReport: {
      algorithm: 'blendRandom',
      algorithmLabel: 'Blend to random',
      scale: 10,
      alpha: 1,
      orderScore: 0,
      clumpScore: 0,
      verdict: 'random',
      verdictLabel: 'Random',
    },
    takeRequiresPermission: false,
    takeCount: 0,
    dealHistory: [],
  }
}

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

  it('records who gave and who received a Thulla for the pickup animation', () => {
    const state = stateWithTrick()
    const leader = resolveTrick(state, true)

    expect(leader).toBe('1')
    expect(state.hands['1'].map((card) => card.id)).toEqual(['C-5', 'S-10', 'S-12', 'H-3'])
    expect(state.trick).toEqual([])
    expect(state.lastPickup).toMatchObject({
      id: 1,
      giver: '2',
      receiver: '1',
      ledSuit: 'S',
      thullaCard: { id: 'H-3' },
      dismissed: false,
    })
    expect(state.lastPickup?.cards.map((card) => card.id)).toEqual(['S-10', 'S-12', 'H-3'])
    expect(pickupPending(state)).toBe(true)
    expect(state.events.at(-1)).toMatchObject({ type: 'thulla', giver: '2', receiver: '1', count: 3 })
  })

  it('keeps the last completed trick visible with its winner when everyone followed suit', () => {
    const state = stateWithTrick()
    state.trick[2] = { playerID: '2', card: { id: 'S-2', suit: 'S', rank: 2 } }
    resolveTrick(state, false)

    expect(state.lastPickup).toBeUndefined()
    expect(state.wasteCount).toBe(3)
    expect(state.trick).toEqual([])
    expect(state.lastTrick).toMatchObject({ id: 1, winner: '1', ledSuit: 'S' })
    expect(state.lastTrick?.plays.map((play) => play.card.id)).toEqual(['S-10', 'S-12', 'S-2'])
    expect(state.events.at(-1)).toMatchObject({ type: 'trickWon', winner: '1' })
  })

  it('keeps only the configured number of events, newest last', () => {
    const state = stateWithTrick()
    for (let index = 0; index < config.game.eventHistory + 3; index += 1) {
      addEvent(state, { type: 'trickWon', winner: '0' })
    }
    expect(state.events).toHaveLength(config.game.eventHistory)
    expect(state.events.at(-1)?.id).toBe(config.game.eventHistory + 3)
  })

  it('rotates clockwise over eliminated seats', () => {
    expect(nextActive(['0', '2', '4'], '0')).toBe('2')
    expect(nextActive(['0', '2', '4'], '4')).toBe('0')
    expect(nextActive(['0', '4'], '2')).toBe('4')
  })
})

function liveTable(overrides: Partial<BhabhiState> = {}): BhabhiState {
  const base = stateWithTrick()
  return {
    ...base,
    hands: {
      '0': [{ id: 'S-14', suit: 'S', rank: 14 }, { id: 'H-4', suit: 'H', rank: 4 }],
      '1': [{ id: 'C-5', suit: 'C', rank: 5 }],
      '2': [{ id: 'D-9', suit: 'D', rank: 9 }, { id: 'C-3', suit: 'C', rank: 3 }],
    },
    handCounts: { '0': 2, '1': 1, '2': 2 },
    trick: [],
    ledSuit: null,
    waste: [],
    wasteCount: 0,
    phase: 'preTrick',
    turnPlayer: '0',
    leader: '0',
    active: ['0', '1', '2'],
    gotAway: [],
    events: [],
    ...overrides,
  }
}

describe('forfeitPlayer', () => {
  it('discards the hand, skips the turn, and does not count as got away', () => {
    const state = liveTable()
    expect(forfeitPlayer(state, '0')).toEqual({ endTurn: true })
    expect(state.hands['0']).toEqual([])
    expect(state.waste.map((card) => card.id)).toEqual(['S-14', 'H-4'])
    expect(state.left).toEqual(['0'])
    expect(state.gotAway).not.toContain('0')
    expect(state.active).toEqual(['1', '2'])
    expect(state.hostID).toBe('1')
    expect(state.turnPlayer).toBe('1')
    expect(state.leader).toBe('1')
    expect(state.events.at(-1)).toMatchObject({ type: 'left', player: '0' })
  })

  it('finishes the deal when one player remains', () => {
    const state = liveTable({
      active: ['0', '1'],
      gotAway: ['2'],
      hands: {
        '0': [{ id: 'S-14', suit: 'S', rank: 14 }],
        '1': [{ id: 'C-5', suit: 'C', rank: 5 }],
        '2': [],
      },
    })
    forfeitPlayer(state, '0')
    expect(state.phase).toBe('finished')
    expect(state.bhabhi).toBe('1')
    expect(state.waste.map((card) => card.id)).toEqual(['S-14'])
    expect(state.gotAway).toEqual(['2'])
    expect(state.left).toEqual(['0'])
  })

  it('keeps an in-progress trick going for the players still in it', () => {
    const state = liveTable({
      phase: 'follow',
      ledSuit: 'S',
      leader: '0',
      turnPlayer: '1',
      trick: [{ playerID: '0', card: { id: 'S-10', suit: 'S', rank: 10 } }],
      hands: {
        '0': [],
        '1': [{ id: 'S-12', suit: 'S', rank: 12 }, { id: 'H-2', suit: 'H', rank: 2 }],
        '2': [{ id: 'S-3', suit: 'S', rank: 3 }],
      },
    })
    expect(forfeitPlayer(state, '1')).toEqual({ endTurn: true })
    expect(state.trick.map((play) => play.card.id)).toEqual(['S-10'])
    expect(state.turnPlayer).toBe('2')
    expect(state.waste.map((card) => card.id)).toEqual(['S-12', 'H-2'])
    expect(state.active).toEqual(['0', '2'])
    expect(state.phase).toBe('follow')
  })

  it('resolves the trick when everyone still seated has played', () => {
    const state = liveTable({
      phase: 'follow',
      ledSuit: 'S',
      leader: '0',
      turnPlayer: '2',
      trick: [
        { playerID: '0', card: { id: 'S-10', suit: 'S', rank: 10 } },
        { playerID: '1', card: { id: 'S-12', suit: 'S', rank: 12 } },
      ],
      hands: {
        '0': [],
        '1': [],
        '2': [{ id: 'D-9', suit: 'D', rank: 9 }],
      },
    })
    forfeitPlayer(state, '2')
    expect(state.trick).toEqual([])
    expect(state.phase).toBe('preTrick')
    expect(state.waste.map((card) => card.id)).toEqual(['D-9', 'S-10', 'S-12'])
    expect(state.turnPlayer).toBe('1')
  })

  it('cancels a pending take and a pickup the leaver was stuck in', () => {
    const state = liveTable({
      turnPlayer: '1',
      pendingTake: { id: 1, from: '0', to: '1' },
      lastTakeReject: { id: 2, from: '0', to: '1', dismissed: false },
      lastPickup: {
        id: 1,
        giver: '2',
        receiver: '1',
        ledSuit: 'S',
        thullaCard: { id: 'H-3', suit: 'H', rank: 3 },
        cards: [{ id: 'H-3', suit: 'H', rank: 3 }],
        dismissed: false,
      },
      hands: {
        '0': [{ id: 'S-14', suit: 'S', rank: 14 }],
        '1': [{ id: 'H-3', suit: 'H', rank: 3 }, { id: 'S-10', suit: 'S', rank: 10 }],
        '2': [{ id: 'D-9', suit: 'D', rank: 9 }],
      },
    })
    forfeitPlayer(state, '1')
    expect(state.pendingTake).toBeUndefined()
    expect(state.lastPickup?.dismissed).toBe(true)
    expect(state.lastTakeReject?.dismissed).toBe(false)
    expect(state.waste.map((card) => card.id)).toEqual(['H-3', 'S-10'])
    expect(state.turnPlayer).toBe('0')
  })

  it('dismisses a reject roast when the requester leaves', () => {
    const state = liveTable({
      turnPlayer: '0',
      lastTakeReject: { id: 1, from: '0', to: '1', dismissed: false },
    })
    forfeitPlayer(state, '0')
    expect(state.lastTakeReject?.dismissed).toBe(true)
  })
})
