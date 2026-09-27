import type { BhabhiState, Card, Suit } from '../../games/bhabhi-thulla/types'
import { inferVoids } from '../analysis'
import type { BotAction, BotPolicy } from '../types'
import {
  cardFor,
  lowestMatching,
  lowestPlay,
  playCards,
  type PlayAction,
  playersStillToAct,
  preferImmediate,
  smartDiscard,
  withoutTake,
} from './common'

/**
 * Sheds low, ducks when others can still punish, and leads from long suits.
 * Knows about voids from `shownVoids` and thulla events but does not count
 * cards or track off-suit plays in the current trick.
 */
export const shark: BotPolicy = {
  id: 'shark',
  choose(view, playerID, actions) {
    const immediate = preferImmediate(actions)
    if (immediate) return immediate
    const plays = playCards(actions)
    if (plays.length === 0) return withoutTake(actions)[0]

    if (view.trick.length === 0) return lead(view, playerID, plays)

    const isOffSuit = isVoidInLed(view, playerID, plays)
    if (isOffSuit) return smartDiscard(view, playerID, plays)

    if (playersStillToAct(view, playerID)) return lowestMatching(view, playerID, plays, false)
    return lowestMatching(view, playerID, plays, true)
  },
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function isVoidInLed(
  view: BhabhiState,
  playerID: string,
  plays: PlayAction[],
): boolean {
  if (!view.ledSuit) return false
  return plays.every((a) => {
    const card = cardFor(view, playerID, a.cardID)
    return card != null && card.suit !== view.ledSuit
  })
}

function sharkVoids(view: BhabhiState): Record<string, Set<Suit>> {
  const map: Record<string, Set<Suit>> = {}
  const add = (player: string, suit: Suit) => {
    ;(map[player] ??= new Set()).add(suit)
  }
  for (const [player, suits] of Object.entries(view.shownVoids ?? {})) {
    for (const suit of suits) add(player, suit)
  }
  for (const event of view.events) {
    if (event.type === 'thulla') add(event.giver, event.suit)
  }
  return map
}

function lead(
  view: BhabhiState,
  playerID: string,
  plays: PlayAction[],
): BotAction {
  const voids = sharkVoids(view)
  const grouped = new Map<Suit, Array<{ action: PlayAction; card: Card }>>()
  for (const action of plays) {
    const card = cardFor(view, playerID, action.cardID)
    if (!card) continue
    const group = grouped.get(card.suit) ?? []
    group.push({ action, card })
    grouped.set(card.suit, group)
  }

  let best: { action: BotAction; card: Card } | null = null
  let bestScore = Number.NEGATIVE_INFINITY
  for (const [suit, group] of grouped) {
    const voidOpponents = view.active.filter(
      (id) => id !== playerID && voids[id]?.has(suit),
    ).length
    const score = group.length * 10 - voidOpponents * 100
    const lowest = group.reduce((a, b) => (a.card.rank <= b.card.rank ? a : b))
    if (
      score > bestScore ||
      (score === bestScore && best !== null && lowest.card.rank < best.card.rank)
    ) {
      bestScore = score
      best = lowest
    }
  }
  return best?.action ?? lowestPlay(view, playerID, plays)
}
