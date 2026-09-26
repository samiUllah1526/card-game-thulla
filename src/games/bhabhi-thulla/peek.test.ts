import { afterEach, describe, expect, it } from 'vitest'
import { INVALID_MOVE } from 'boardgame.io/core'
import { config } from '../../config'
import { BhabhiThulla } from './game'
import { filterPlayerView, peekPassword } from './peek'
import type { BhabhiState, Card } from './types'

const hand = (...ids: string[]): Card[] =>
  ids.map((id) => {
    const [suit, rank] = id.split('-') as [Card['suit'], string]
    return { id, suit, rank: Number(rank) as Card['rank'] }
  })

function baseState(): BhabhiState {
  return {
    hands: {
      '0': hand('S-14', 'H-3'),
      '1': hand('C-5', 'D-9'),
      '2': hand('S-2'),
    },
    handCounts: { '0': 2, '1': 2, '2': 1 },
    waste: [],
    wasteCount: 0,
    trick: [],
    ledSuit: null,
    pickupCount: 0,
    trickCount: 0,
    active: ['0', '1', '2'],
    gotAway: [],
    leader: '0',
    turnPlayer: '0',
    firstLeader: '0',
    firstTrick: true,
    started: true,
    hostID: '0',
    phase: 'preTrick',
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
    peekers: {},
  }
}

function callUnlock(G: BhabhiState, playerID: string, password: string) {
  const move = BhabhiThulla.moves?.unlockPeek
  if (!move || typeof move === 'function') throw new Error('unlockPeek missing')
  const longForm = move as {
    move: (context: { G: BhabhiState; playerID: string }, password: string) => unknown
  }
  return longForm.move({ G, playerID }, password)
}

describe('peekPassword', () => {
  afterEach(() => {
    delete process.env[config.peek.envKey]
  })

  it('reads the configured env key', () => {
    process.env[config.peek.envKey] = '  secret-table  '
    expect(peekPassword()).toBe('secret-table')
  })
})

describe('filterPlayerView', () => {
  it('hides other hands for normal seats', () => {
    const G = baseState()
    const view = filterPlayerView(G, '0')
    expect(view.hands['0']).toHaveLength(2)
    expect(view.hands['1']).toEqual([])
    expect(view.hands['2']).toEqual([])
    expect(view.peekers).toBeUndefined()
  })

  it('reveals every hand to an unlocked peeker and only self in peekers', () => {
    const G = baseState()
    G.peekers = { '0': true, '1': true }
    const view = filterPlayerView(G, '0')
    expect(view.hands['0']).toHaveLength(2)
    expect(view.hands['1']).toHaveLength(2)
    expect(view.hands['2']).toHaveLength(1)
    expect(view.peekers).toEqual({ '0': true })
  })
})

describe('unlockPeek', () => {
  afterEach(() => {
    delete process.env[config.peek.envKey]
  })

  it('rejects when password env is unset', () => {
    delete process.env[config.peek.envKey]
    const G = baseState()
    expect(callUnlock(G, '0', 'anything')).toBe(INVALID_MOVE)
    expect(G.peekers?.['0']).toBeFalsy()
  })

  it('rejects a wrong password', () => {
    process.env[config.peek.envKey] = 'correct'
    const G = baseState()
    expect(callUnlock(G, '0', 'wrong')).toBe(INVALID_MOVE)
    expect(G.peekers?.['0']).toBeFalsy()
  })

  it('sets peeker flag on match', () => {
    process.env[config.peek.envKey] = 'correct'
    const G = baseState()
    expect(callUnlock(G, '0', 'correct')).not.toBe(INVALID_MOVE)
    expect(G.peekers?.['0']).toBe(true)
  })
})
