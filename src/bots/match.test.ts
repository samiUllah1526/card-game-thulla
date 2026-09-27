import { INVALID_MOVE } from 'boardgame.io/core'
import { describe, expect, it } from 'vitest'
import { listBotActions } from '../games/bhabhi-thulla/botActions'
import { createDealtState, BhabhiThulla } from '../games/bhabhi-thulla/game'
import { filterPlayerView } from '../games/bhabhi-thulla/peek'
import type { BhabhiState } from '../games/bhabhi-thulla/types'
import type { BotAction, BotPolicy } from './types'
import { rookie } from './policies/rookie'
import { shark } from './policies/shark'
import { mastermind } from './policies/mastermind'

function seeded(seed: number): { Number: () => number } {
  let value = seed
  return {
    Number: () => {
      value = (value * 9301 + 49297) % 233280
      return value / 233280
    },
  }
}

function rngFrom(seed: number): () => number {
  let value = seed
  return () => {
    value = (value * 9301 + 49297) % 233280
    return value / 233280
  }
}

function apply(G: BhabhiState, playerID: string, action: BotAction) {
  const move = BhabhiThulla.moves?.[action.type]
  if (!move || typeof move !== 'function') throw new Error(action.type)
  if (action.type === 'playCard') return move({ G, playerID } as never, action.cardID)
  if (action.type === 'respondTake') return move({ G, playerID } as never, action.accept)
  return move({ G, playerID } as never)
}

function scripted(view: BhabhiState, playerID: string, actions: BotAction[]): BotAction {
  const dismiss = actions.find(
    (action) => action.type === 'dismissPickup' || action.type === 'dismissTakeReject',
  )
  if (dismiss) return dismiss
  const accept = actions.find((action) => action.type === 'respondTake' && action.accept)
  if (accept) return accept
  const plays = actions.filter(
    (action): action is Extract<BotAction, { type: 'playCard' }> => action.type === 'playCard',
  )
  if (plays.length > 0) {
    const hand = view.hands[playerID] ?? []
    return plays.reduce((best, action) => {
      const card = hand.find((candidate) => candidate.id === action.cardID)
      const bestCard = hand.find((candidate) => candidate.id === best.cardID)
      if (!card || !bestCard) return best
      return card.rank < bestCard.rank ? action : best
    })
  }
  return actions.find((action) => action.type !== 'takeLeftHand') ?? actions[0]
}

function playDeal(policies: Record<string, BotPolicy>, seed: number) {
  const G = createDealtState({
    numPlayers: 3,
    seats: ['0', '1', '2'],
    random: seeded(seed),
    autoStart: true,
    seatCount: 3,
    hostID: '0',
    bots: { '1': policies['1'].id, '2': policies['2'].id },
  })
  const rng = rngFrom(seed)
  for (let step = 0; step < 2000 && G.phase !== 'finished'; step += 1) {
    const ready = ['0', '1', '2'].filter((id) => {
      return listBotActions(filterPlayerView(G, id), id).length > 0
    })
    if (ready.length !== 1) {
      throw new Error(`expected one actor, saw ${ready.join(',') || 'none'} at ${G.phase}`)
    }
    const playerID = ready[0]
    const seatView = filterPlayerView(G, playerID)
    const actions = listBotActions(seatView, playerID)
    const action =
      playerID === '0'
        ? scripted(seatView, playerID, actions)
        : policies[playerID].choose(seatView, playerID, actions, rng)
    expect(actions).toContainEqual(action)
    expect(apply(G, playerID, action)).not.toBe(INVALID_MOVE)
  }
  expect(G.phase).toBe('finished')
  expect(G.bhabhi).toBeTruthy()
}

describe('bots finish a deal through the real moves', () => {
  it('plays shark and mastermind without an illegal move', () => {
    playDeal({ '1': shark, '2': mastermind }, 4)
  })

  it('plays rookie without an illegal move', () => {
    playDeal({ '1': rookie, '2': rookie }, 9)
  })

  it('plays all three levels across multiple seeds', () => {
    for (const seed of [1, 7, 13, 21, 42]) {
      playDeal({ '1': mastermind, '2': shark }, seed)
      playDeal({ '1': rookie, '2': mastermind }, seed)
    }
  })
})
