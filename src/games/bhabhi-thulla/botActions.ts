import type { BotAction } from '../../bots/types'
import type { BhabhiState } from './types'
import { actionBlocked, legalCards } from './rules'

/**
 * Legal actions for one seat, from that seat's view of the table.
 * Host moves (start, add seat, play again) are intentionally absent.
 */
export function listBotActions(view: BhabhiState, playerID: string): BotAction[] {
  if (!view.started || view.phase === 'finished' || view.phase === 'waiting') return []

  if (view.lastPickup && !view.lastPickup.dismissed) {
    return view.lastPickup.receiver === playerID ? [{ type: 'dismissPickup' }] : []
  }
  if (view.pendingTake) {
    if (view.pendingTake.to !== playerID) return []
    return [
      { type: 'respondTake', accept: true },
      { type: 'respondTake', accept: false },
    ]
  }
  if (view.lastTakeReject && !view.lastTakeReject.dismissed) {
    return view.lastTakeReject.from === playerID ? [{ type: 'dismissTakeReject' }] : []
  }
  if (actionBlocked(view)) return []
  if (playerID !== view.turnPlayer) return []
  if (view.phase !== 'preTrick' && view.phase !== 'follow') return []

  const hand = view.hands[playerID] ?? []
  let cards = legalCards(hand, view.ledSuit)
  if (view.firstTrick && view.trick.length === 0) {
    cards = cards.filter((card) => card.suit === 'S' && card.rank === 14)
  }

  const actions: BotAction[] = cards.map((card) => ({ type: 'playCard', cardID: card.id }))
  if (view.phase === 'preTrick' && playerID === view.leader && view.active.length >= 2) {
    actions.push({ type: 'takeLeftHand' })
  }
  return actions
}
