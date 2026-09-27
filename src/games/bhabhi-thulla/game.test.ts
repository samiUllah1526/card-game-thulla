import { INVALID_MOVE } from 'boardgame.io/core'
import { describe, expect, it } from 'vitest'
import { createDealtState, createWaitingState, BhabhiThulla } from './game'
import { finishIfNeeded, hasAceOfSpades } from './rules'
import type { BhabhiState, Card } from './types'

const hand = (...ids: string[]): Card[] =>
  ids.map((id) => {
    const [suit, rank] = id.split('-') as [Card['suit'], string]
    return { id, suit, rank: Number(rank) as Card['rank'] }
  })

function finishedState(overrides: Partial<BhabhiState> = {}): BhabhiState {
  return {
    hands: {
      '0': hand('S-14', 'H-3', 'C-2'),
      '1': [],
      '2': [],
    },
    handCounts: { '0': 3, '1': 0, '2': 0 },
    waste: [],
    wasteCount: 0,
    trick: [],
    ledSuit: null,
    pickupCount: 0,
    trickCount: 4,
    active: ['0'],
    gotAway: ['1', '2'],
    leader: '0',
    turnPlayer: '0',
    firstLeader: '1',
    firstTrick: false,
    started: true,
    hostID: '0',
    phase: 'finished',
    events: [{ id: 1, type: 'bhabhi', player: '0' }],
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
    takeRequiresPermission: true,
    takeCount: 2,
    peekers: { '1': true },
    dealHistory: [
      { deal: 1, bhabhi: '0', gotAway: ['1', '2'], at: 1_700_000_000_000 },
    ],
    bhabhi: '0',
    lastPickup: {
      id: 1,
      giver: '2',
      receiver: '0',
      ledSuit: 'S',
      thullaCard: { id: 'H-3', suit: 'H', rank: 3 },
      cards: hand('S-10', 'H-3'),
      dismissed: true,
    },
    ...overrides,
  }
}

function seededRandom(seed = 0.42): { Number: () => number } {
  let value = seed
  return {
    Number: () => {
      value = (value * 9301 + 49297) % 233280
      return value / 233280
    },
  }
}

function callPlayAgain(G: BhabhiState, playerID: string, numPlayers = 3) {
  const move = BhabhiThulla.moves?.playAgain
  if (!move || typeof move === 'function') throw new Error('playAgain should be a long-form move')
  return move.move(
    {
      G,
      playerID,
      ctx: { numPlayers } as never,
      random: seededRandom(),
    } as never,
  )
}

describe('createDealtState', () => {
  it('deals a full deck and waits for the host by default', () => {
    const G = createDealtState({ numPlayers: 4, random: seededRandom() })
    expect(Object.values(G.hands).flat()).toHaveLength(52)
    expect(G.active).toEqual(['0', '1', '2', '3'])
    expect(G.started).toBe(false)
    expect(G.phase).toBe('waiting')
    expect(G.dealHistory).toEqual([])
    expect(hasAceOfSpades(G.hands[G.firstLeader])).toBe(true)
  })

  it('auto-starts a rematch deal when requested', () => {
    const history = [{ deal: 1, bhabhi: '2', gotAway: ['0', '1'], at: 99 }]
    const G = createDealtState({
      numPlayers: 3,
      random: seededRandom(0.1),
      dealHistory: history,
      peekers: { '0': true },
      autoStart: true,
      setupData: { takeRequiresPermission: true, shuffleScale: 5 },
    })
    expect(G.started).toBe(true)
    expect(G.phase).toBe('preTrick')
    expect(G.turnPlayer).toBe(G.firstLeader)
    expect(G.dealHistory).toEqual(history)
    expect(G.peekers).toEqual({ '0': true })
    expect(G.takeRequiresPermission).toBe(true)
    expect(G.events.at(-1)).toMatchObject({ type: 'firstLead', player: G.firstLeader })
  })
})

describe('finishIfNeeded deal history', () => {
  it('appends one DealResult when the deal ends', () => {
    const G = finishedState({
      phase: 'preTrick',
      bhabhi: undefined,
      dealHistory: [],
      events: [],
    })
    expect(finishIfNeeded(G)).toBe(true)
    expect(G.phase).toBe('finished')
    expect(G.bhabhi).toBe('0')
    expect(G.dealHistory).toHaveLength(1)
    expect(G.dealHistory[0]).toMatchObject({
      deal: 1,
      bhabhi: '0',
      gotAway: ['1', '2'],
    })
    expect(typeof G.dealHistory[0].at).toBe('number')
  })

  it('does not duplicate history on a second call', () => {
    const G = finishedState({
      phase: 'preTrick',
      bhabhi: undefined,
      dealHistory: [],
      events: [],
    })
    expect(finishIfNeeded(G)).toBe(true)
    expect(finishIfNeeded(G)).toBe(true)
    expect(G.dealHistory).toHaveLength(1)
  })
})

describe('playAgain', () => {
  it('rejects non-host and non-finished tables', () => {
    const finished = finishedState()
    expect(callPlayAgain(finished, '1')).toBe(INVALID_MOVE)

    const playing = finishedState({ phase: 'preTrick', bhabhi: undefined })
    expect(callPlayAgain(playing, '0')).toBe(INVALID_MOVE)
  })

  it('redeals, auto-starts, and keeps deal history and peekers', () => {
    const G = finishedState()
    const priorHistory = [...G.dealHistory]

    expect(callPlayAgain(G, '0')).not.toBe(INVALID_MOVE)

    expect(Object.values(G.hands).flat()).toHaveLength(52)
    expect(G.active).toEqual(['0', '1', '2'])
    expect(G.gotAway).toEqual([])
    expect(G.bhabhi).toBeUndefined()
    expect(G.phase).toBe('preTrick')
    expect(G.started).toBe(true)
    expect(G.turnPlayer).toBe(G.firstLeader)
    expect(G.firstTrick).toBe(true)
    expect(G.dealHistory).toEqual(priorHistory)
    expect(G.peekers).toEqual({ '1': true })
    expect(G.takeRequiresPermission).toBe(true)
    expect(G.lastPickup).toBeUndefined()
    expect(G.lastTrick).toBeUndefined()
    expect(hasAceOfSpades(G.hands[G.firstLeader])).toBe(true)
  })

  it('does not deal a player who already left', () => {
    const G = finishedState()
    G.left = ['2']
    expect(callPlayAgain(G, '0')).not.toBe(INVALID_MOVE)
    expect(G.hands['2']).toEqual([])
    expect(G.active).toEqual(['0', '1'])
    expect(G.left).toEqual(['2'])
    expect(Object.values(G.hands).flat()).toHaveLength(52)
    expect(hasAceOfSpades(G.hands[G.firstLeader])).toBe(true)
  })

  it('refuses a rematch when fewer than two players remain', () => {
    const G = finishedState()
    G.left = ['1', '2']
    expect(callPlayAgain(G, '0')).toBe(INVALID_MOVE)
  })
})

describe('leaveGame', () => {
  function callLeave(G: BhabhiState, playerID: string) {
    const move = BhabhiThulla.moves?.leaveGame
    if (!move || typeof move === 'function') throw new Error('leaveGame should be a long-form move')
    let ended = false
    const result = move.move({
      G,
      playerID,
      events: { endTurn: () => { ended = true } },
    } as never)
    return { result, ended }
  }

  it('rejects a leave before the deal starts', () => {
    const G = createDealtState({ numPlayers: 3, random: seededRandom() })
    const hand = G.hands['1'].map((card) => card.id)
    const { result, ended } = callLeave(G, '1')
    expect(result).toBe(INVALID_MOVE)
    expect(ended).toBe(false)
    expect(G.hands['1'].map((card) => card.id)).toEqual(hand)
  })

  it('discards cards and ends the turn when the player to move leaves', () => {
    const G = createDealtState({ numPlayers: 3, random: seededRandom(), autoStart: true })
    const leaver = G.turnPlayer
    const count = G.hands[leaver].length
    const { result, ended } = callLeave(G, leaver)
    expect(result).not.toBe(INVALID_MOVE)
    expect(ended).toBe(true)
    expect(G.hands[leaver]).toEqual([])
    expect(G.waste).toHaveLength(count)
    expect(G.left).toContain(leaver)
    expect(G.gotAway).not.toContain(leaver)
  })

  it('lets the new host deal again without the player who left', () => {
    const G = finishedState()
    G.left = ['0']
    G.hostID = '1'
    expect(callPlayAgain(G, '0')).toBe(INVALID_MOVE)
    expect(callPlayAgain(G, '1')).not.toBe(INVALID_MOVE)
    expect(G.hostID).toBe('1')
    expect(G.hands['0']).toEqual([])
    expect(G.active).toEqual(['1', '2'])
  })
})

describe('flexible seats', () => {
  function callMove(name: 'startGame' | 'addSeat' | 'markSeated', G: BhabhiState, playerID: string) {
    const move = BhabhiThulla.moves?.[name]
    if (!move) throw new Error(name)
    const args = {
      G,
      playerID,
      ctx: { numPlayers: 8 } as never,
      random: seededRandom(),
    }
    if (typeof move === 'function') return move(args as never)
    return move.move(args as never)
  }

  it('deals only the four players who sat at a six-seat table', () => {
    const G = createWaitingState({ numPlayers: 8, setupData: { seatCount: 6 } })
    expect(callMove('markSeated', G, '6')).toBe(INVALID_MOVE)
    for (const id of ['0', '1', '2', '3']) {
      expect(callMove('markSeated', G, id)).not.toBe(INVALID_MOVE)
    }
    expect(callMove('startGame', G, '0')).not.toBe(INVALID_MOVE)
    expect(G.started).toBe(true)
    expect(G.active).toEqual(['0', '1', '2', '3'])
    expect(G.dealtSeats).toEqual(['0', '1', '2', '3'])
    expect(G.hands['4']).toEqual([])
    expect(G.hands['5']).toEqual([])
    expect(Object.values(G.hands).flat()).toHaveLength(52)
  })

  it('rejects a start when only two people have sat', () => {
    const G = createWaitingState({ numPlayers: 8, setupData: { seatCount: 4 } })
    callMove('markSeated', G, '0')
    callMove('markSeated', G, '1')
    expect(callMove('startGame', G, '0')).toBe(INVALID_MOVE)
    expect(G.started).toBe(false)
  })

  it('adds one seat and stops at eight', () => {
    const G = createWaitingState({ numPlayers: 8, setupData: { seatCount: 7 } })
    expect(callMove('addSeat', G, '1')).toBe(INVALID_MOVE)
    expect(callMove('addSeat', G, '0')).not.toBe(INVALID_MOVE)
    expect(G.seatCount).toBe(8)
    expect(callMove('addSeat', G, '0')).toBe(INVALID_MOVE)
    expect(G.seatCount).toBe(8)
  })

  it('rejects adding or marking a seat after the deal starts', () => {
    const G = createWaitingState({ numPlayers: 8, setupData: { seatCount: 4 } })
    for (const id of ['0', '1', '2']) callMove('markSeated', G, id)
    expect(callMove('startGame', G, '0')).not.toBe(INVALID_MOVE)
    expect(callMove('addSeat', G, '0')).toBe(INVALID_MOVE)
    expect(callMove('markSeated', G, '3')).toBe(INVALID_MOVE)
    expect(G.seatCount).toBe(4)
    expect(G.seated?.['3']).toBeUndefined()
  })

  it('does not deal an empty seat again on play again', () => {
    const G = createWaitingState({ numPlayers: 8, setupData: { seatCount: 6 } })
    for (const id of ['0', '1', '2', '3']) callMove('markSeated', G, id)
    expect(callMove('startGame', G, '0')).not.toBe(INVALID_MOVE)
    G.phase = 'finished'
    G.turnPlayer = '0'
    expect(callPlayAgain(G, '0', 8)).not.toBe(INVALID_MOVE)
    expect(G.active).toEqual(['0', '1', '2', '3'])
    expect(G.hands['4']).toEqual([])
    expect(G.hands['5']).toEqual([])
    expect(G.hands['6']).toEqual([])
    expect(Object.values(G.hands).flat()).toHaveLength(52)
  })
})
