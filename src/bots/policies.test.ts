import { describe, expect, it } from 'vitest'
import { config } from '../config'
import { listBotActions } from '../games/bhabhi-thulla/botActions'
import type { BhabhiState, Card } from '../games/bhabhi-thulla/types'
import { rookie } from './policies/rookie'
import { shark } from './policies/shark'
import { mastermind } from './policies/mastermind'
import { botPauseMs, BotRunner } from './runner'
import type { BotAction, BotConnection, BotSnapshot } from './types'

const card = (id: string): Card => {
  const [suit, rank] = id.split('-') as [Card['suit'], string]
  return { id, suit, rank: Number(rank) as Card['rank'] }
}

function view(partial: Partial<BhabhiState>): BhabhiState {
  return {
    hands: { '0': [], '1': [card('S-4'), card('S-12'), card('H-2')], '2': [] },
    handCounts: { '0': 0, '1': 3, '2': 0 },
    waste: [],
    wasteCount: 0,
    trick: [{ playerID: '0', card: card('S-9') }],
    ledSuit: 'S',
    pickupCount: 0,
    trickCount: 0,
    active: ['0', '1', '2'],
    gotAway: [],
    leader: '0',
    turnPlayer: '1',
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
    takeRequiresPermission: true,
    takeCount: 0,
    dealHistory: [],
    ...partial,
  }
}

describe('bot policies', () => {
  const actions: BotAction[] = [
    { type: 'playCard', cardID: 'S-4' },
    { type: 'playCard', cardID: 'S-12' },
    { type: 'takeLeftHand' },
  ]

  it('picks only a listed action on rookie', () => {
    for (let index = 0; index < 20; index += 1) {
      const rng = () => index / 20
      const choice = rookie.choose(view({}), '1', actions, rng)
      expect(actions).toContainEqual(choice)
    }
  })

  it('sheds the lowest card and accepts a take on shark', () => {
    const state = view({})
    expect(shark.choose(state, '1', actions, () => 0)).toEqual({ type: 'playCard', cardID: 'S-4' })
    const asked: BotAction[] = [
      { type: 'respondTake', accept: true },
      { type: 'respondTake', accept: false },
    ]
    expect(shark.choose(state, '1', asked, () => 0)).toEqual({ type: 'respondTake', accept: true })
    expect(shark.choose(state, '1', [{ type: 'takeLeftHand' }], () => 0)).toEqual({
      type: 'takeLeftHand',
    })
  })

  it('ducks while someone can still play, and wins when last', () => {
    const state = view({})
    const plays: BotAction[] = [
      { type: 'playCard', cardID: 'S-4' },
      { type: 'playCard', cardID: 'S-12' },
    ]
    expect(mastermind.choose(state, '1', plays, () => 0)).toEqual({ type: 'playCard', cardID: 'S-4' })
    const last = view({ active: ['0', '1'] })
    expect(mastermind.choose(last, '1', plays, () => 0)).toEqual({ type: 'playCard', cardID: 'S-12' })
  })

  it('leads low from a long suit that nobody is void in', () => {
    const state = view({
      trick: [],
      ledSuit: null,
      phase: 'preTrick',
      turnPlayer: '1',
      leader: '1',
      hands: {
        '0': [],
        '1': [card('H-3'), card('H-8'), card('S-14'), card('D-2')],
        '2': [],
      },
      handCounts: { '0': 0, '1': 4, '2': 0 },
      shownVoids: { '2': ['S'] },
    })
    const plays = listBotActions(state, '1').filter((action) => action.type === 'playCard')
    expect(mastermind.choose(state, '1', plays, () => 0)).toEqual({ type: 'playCard', cardID: 'H-3' })
  })

  it('discards high from short suit when void in led suit (mastermind)', () => {
    const state = view({
      trick: [{ playerID: '0', card: card('H-9') }],
      ledSuit: 'H',
      phase: 'follow',
      turnPlayer: '1',
      hands: {
        '0': [],
        '1': [card('S-14'), card('S-3'), card('S-7'), card('S-10'), card('D-13'), card('C-2')],
        '2': [],
      },
      handCounts: { '0': 0, '1': 6, '2': 0 },
      active: ['0', '1'],
    })
    const plays: BotAction[] = [
      { type: 'playCard', cardID: 'S-14' },
      { type: 'playCard', cardID: 'S-3' },
      { type: 'playCard', cardID: 'S-7' },
      { type: 'playCard', cardID: 'S-10' },
      { type: 'playCard', cardID: 'D-13' },
      { type: 'playCard', cardID: 'C-2' },
    ]
    const choice = mastermind.choose(state, '1', plays, () => 0)
    expect(choice).toEqual({ type: 'playCard', cardID: 'D-13' })
  })

  it('dumps the ace in endgame discard to avoid winning unwanted tricks', () => {
    const state = view({
      trick: [{ playerID: '0', card: card('H-9') }],
      ledSuit: 'H',
      phase: 'follow',
      turnPlayer: '1',
      hands: {
        '0': [],
        '1': [card('S-14'), card('S-3'), card('D-2')],
        '2': [],
      },
      handCounts: { '0': 0, '1': 3, '2': 0 },
      active: ['0', '1'],
    })
    const plays: BotAction[] = [
      { type: 'playCard', cardID: 'S-14' },
      { type: 'playCard', cardID: 'S-3' },
      { type: 'playCard', cardID: 'D-2' },
    ]
    const choice = mastermind.choose(state, '1', plays, () => 0)
    expect(choice).toEqual({ type: 'playCard', cardID: 'S-14' })
  })

  it('strongly ducks when a thulla threat exists (mastermind)', () => {
    const state = view({
      trick: [{ playerID: '0', card: card('S-3') }],
      ledSuit: 'S',
      phase: 'follow',
      turnPlayer: '1',
      active: ['0', '1', '2'],
      shownVoids: { '2': ['S'] },
    })
    const plays: BotAction[] = [
      { type: 'playCard', cardID: 'S-4' },
      { type: 'playCard', cardID: 'S-12' },
    ]
    const choice = mastermind.choose(state, '1', plays, () => 0)
    expect(choice).toEqual({ type: 'playCard', cardID: 'S-4' })
  })
})

describe('botPauseMs', () => {
  it('waits out a pickup and a finished trick before the think time', () => {
    const leading = view({
      phase: 'preTrick',
      trick: [],
      ledSuit: null,
      turnPlayer: '1',
      lastTrick: {
        id: 1,
        plays: [],
        winner: '1',
        ledSuit: 'S',
      },
    })
    const pause = botPauseMs(leading, '1', 'rookie', () => 0)
    expect(pause).toBe(config.bots.thinkMs.rookie[0] + config.timing.trickDisplayMinMs)

    const pickup = view({
      lastPickup: {
        id: 1,
        giver: '0',
        receiver: '1',
        ledSuit: 'S',
        thullaCard: card('H-2'),
        cards: [card('S-9'), card('H-2')],
        dismissed: false,
      },
    })
    const fly = botPauseMs(pickup, '1', 'rookie', () => 0)
    expect(fly).toBe(
      config.bots.thinkMs.rookie[0] + config.timing.pickupFlyMs + config.timing.pickupFlyStaggerMs,
    )
  })
})

describe('BotRunner', () => {
  it('dispatches one legal action after the clock fires', async () => {
    const sent: BotAction[] = []
    let listener: ((snapshot: BotSnapshot | null) => void) | null = null
    const connection: BotConnection = {
      start() {
        listener?.({ G: view({}), isConnected: true })
      },
      subscribe(next) {
        listener = next
        return () => {
          listener = null
        }
      },
      noteBot() {},
      markSeated() {},
      dispatch(action) {
        sent.push(action)
      },
      stop() {},
    }
    const runner = new BotRunner({
      playerID: '1',
      difficulty: 'shark',
      connection,
      listActions: () => [{ type: 'playCard', cardID: 'S-4' }, { type: 'takeLeftHand' }],
      clock: { wait: () => Promise.resolve() },
      rng: () => 0,
    })
    runner.start()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(sent).toEqual([{ type: 'playCard', cardID: 'S-4' }])
  })
})
