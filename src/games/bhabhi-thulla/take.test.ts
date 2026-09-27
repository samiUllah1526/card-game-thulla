import { INVALID_MOVE } from 'boardgame.io/core'
import { describe, expect, it } from 'vitest'
import { BhabhiThulla } from './game'
import { actionBlocked, executeTake, takePending, takeRejectPending } from './rules'
import type { BhabhiState, Card } from './types'

const hand = (...ids: string[]): Card[] =>
  ids.map((id) => {
    const [suit, rank] = id.split('-') as [Card['suit'], string]
    return { id, suit, rank: Number(rank) as Card['rank'] }
  })

function preTrickState(overrides: Partial<BhabhiState> = {}): BhabhiState {
  return {
    hands: {
      '0': hand('S-14', 'H-3'),
      '1': hand('C-5', 'D-9', 'H-7'),
      '2': hand('S-2', 'C-10'),
    },
    handCounts: { '0': 2, '1': 3, '2': 2 },
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
    firstTrick: false,
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
    dealHistory: [],
    ...overrides,
  }
}

function callMove(
  name: 'takeLeftHand' | 'respondTake' | 'dismissTakeReject' | 'playCard',
  G: BhabhiState,
  playerID: string,
  ...args: unknown[]
) {
  const move = BhabhiThulla.moves?.[name]
  if (!move || typeof move !== 'function') throw new Error(`missing move ${name}`)
  return (move as (context: { G: BhabhiState; playerID: string }, ...rest: unknown[]) => unknown)(
    { G, playerID },
    ...args,
  )
}

describe('take cards', () => {
  it('free mode empties the next player immediately', () => {
    const G = preTrickState({ takeRequiresPermission: false })
    const victimHand = [...G.hands['1']]

    expect(callMove('takeLeftHand', G, '0')).not.toBe(INVALID_MOVE)
    expect(G.hands['1']).toEqual([])
    expect(G.hands['0']).toEqual(expect.arrayContaining(victimHand))
    expect(G.gotAway).toContain('1')
    expect(G.active).toEqual(['0', '2'])
    expect(G.events.at(-1)).toMatchObject({ type: 'took', taker: '0', victim: '1', count: 3 })
    expect(G.pendingTake).toBeUndefined()
  })

  it('permission mode only sets pendingTake until accept', () => {
    const G = preTrickState({ takeRequiresPermission: true })
    const victimBefore = [...G.hands['1']]

    expect(callMove('takeLeftHand', G, '0')).not.toBe(INVALID_MOVE)
    expect(G.pendingTake).toMatchObject({ from: '0', to: '1' })
    expect(G.hands['1']).toEqual(victimBefore)
    expect(G.turnPlayer).toBe('1')
    expect(takePending(G)).toBe(true)
    expect(actionBlocked(G)).toBe(true)
    expect(G.events.at(-1)).toMatchObject({ type: 'takeAsked', from: '0', to: '1' })

    expect(callMove('playCard', G, '0', 'S-14')).toBe(INVALID_MOVE)
    expect(callMove('respondTake', G, '0', true)).toBe(INVALID_MOVE)

    expect(callMove('respondTake', G, '1', true)).not.toBe(INVALID_MOVE)
    expect(G.pendingTake).toBeUndefined()
    expect(G.hands['1']).toEqual([])
    expect(G.gotAway).toContain('1')
    expect(G.events.at(-1)).toMatchObject({
      type: 'takeAccepted',
      from: '0',
      to: '1',
      count: 3,
    })
  })

  it('permission reject roasts the requester until they dismiss', () => {
    const G = preTrickState({ takeRequiresPermission: true })
    const victimBefore = [...G.hands['1']]

    callMove('takeLeftHand', G, '0')
    expect(callMove('respondTake', G, '1', false)).not.toBe(INVALID_MOVE)

    expect(G.pendingTake).toBeUndefined()
    expect(G.hands['1']).toEqual(victimBefore)
    expect(G.lastTakeReject).toMatchObject({ from: '0', to: '1', dismissed: false })
    expect(takeRejectPending(G)).toBe(true)
    expect(actionBlocked(G)).toBe(true)
    expect(G.turnPlayer).toBe('0')
    expect(G.events.at(-1)).toMatchObject({ type: 'takeRejected', from: '0', to: '1' })

    expect(callMove('dismissTakeReject', G, '1')).toBe(INVALID_MOVE)
    expect(callMove('takeLeftHand', G, '0')).toBe(INVALID_MOVE)
    expect(callMove('playCard', G, '0', 'S-14')).toBe(INVALID_MOVE)

    expect(callMove('dismissTakeReject', G, '0')).not.toBe(INVALID_MOVE)
    expect(G.lastTakeReject?.dismissed).toBe(true)
    expect(takeRejectPending(G)).toBe(false)
    expect(actionBlocked(G)).toBe(false)
  })

  it('executeTake records free vs accepted events', () => {
    const free = preTrickState()
    executeTake(free, '0', '1', 'free')
    expect(free.events.at(-1)?.type).toBe('took')

    const accepted = preTrickState()
    executeTake(accepted, '0', '1', 'accepted')
    expect(accepted.events.at(-1)?.type).toBe('takeAccepted')
  })
})
