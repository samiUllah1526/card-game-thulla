import { describe, expect, it } from 'vitest'
import { listBotActions } from './botActions'
import type { BhabhiState, Card } from './types'

const card = (id: string): Card => {
  const [suit, rank] = id.split('-') as [Card['suit'], string]
  return { id, suit, rank: Number(rank) as Card['rank'] }
}

function view(partial: Partial<BhabhiState>): BhabhiState {
  return {
    hands: { '0': [], '1': [], '2': [] },
    handCounts: { '0': 0, '1': 0, '2': 0 },
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
    ...partial,
  }
}

describe('listBotActions', () => {
  it('offers nothing before the deal and nothing to a seat that is waiting', () => {
    const waiting = view({ started: false, phase: 'waiting' })
    expect(listBotActions(waiting, '0')).toEqual([])
    const follow = view({
      phase: 'follow',
      ledSuit: 'S',
      turnPlayer: '1',
      trick: [{ playerID: '0', card: card('S-10') }],
      hands: { '0': [], '1': [card('S-2')], '2': [] },
    })
    expect(listBotActions(follow, '2')).toEqual([])
  })

  it('opens with the ace of spades, and a take, on the first lead', () => {
    const state = view({
      firstTrick: true,
      hands: { '0': [card('S-14'), card('H-2'), card('C-9')], '1': [], '2': [] },
    })
    expect(listBotActions(state, '0')).toEqual([
      { type: 'playCard', cardID: 'S-14' },
      { type: 'takeLeftHand' },
    ])
  })

  it('follows suit and does not offer a take mid-trick', () => {
    const state = view({
      phase: 'follow',
      turnPlayer: '1',
      ledSuit: 'H',
      trick: [{ playerID: '0', card: card('H-4') }],
      hands: { '0': [], '1': [card('H-9'), card('S-2'), card('D-3')], '2': [] },
    })
    expect(listBotActions(state, '1')).toEqual([{ type: 'playCard', cardID: 'H-9' }])
  })

  it('allows any card when the seat is void', () => {
    const state = view({
      phase: 'follow',
      turnPlayer: '1',
      ledSuit: 'H',
      trick: [{ playerID: '0', card: card('H-4') }],
      hands: { '0': [], '1': [card('S-2'), card('D-3')], '2': [] },
    })
    expect(listBotActions(state, '1')).toEqual([
      { type: 'playCard', cardID: 'S-2' },
      { type: 'playCard', cardID: 'D-3' },
    ])
  })

  it('asks only the requested player to accept or reject', () => {
    const state = view({
      pendingTake: { id: 1, from: '0', to: '1' },
      turnPlayer: '1',
    })
    expect(listBotActions(state, '1')).toEqual([
      { type: 'respondTake', accept: true },
      { type: 'respondTake', accept: false },
    ])
    expect(listBotActions(state, '0')).toEqual([])
  })

  it('asks only the receiver to dismiss a Thulla', () => {
    const state = view({
      lastPickup: {
        id: 1,
        giver: '2',
        receiver: '1',
        ledSuit: 'S',
        thullaCard: card('H-3'),
        cards: [card('H-3')],
        dismissed: false,
      },
    })
    expect(listBotActions(state, '1')).toEqual([{ type: 'dismissPickup' }])
    expect(listBotActions(state, '2')).toEqual([])
  })

  it('asks only the rejected player to dismiss the roast', () => {
    const state = view({
      lastTakeReject: { id: 2, from: '0', to: '1', dismissed: false },
      turnPlayer: '0',
    })
    expect(listBotActions(state, '0')).toEqual([{ type: 'dismissTakeReject' }])
    expect(listBotActions(state, '1')).toEqual([])
  })
})
