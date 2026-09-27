import { highestLedSuit } from '../../games/bhabhi-thulla/rules'
import type { BhabhiState, Card } from '../../games/bhabhi-thulla/types'
import { groupBySuit } from '../analysis'
import type { BotAction } from '../types'

// ---------------------------------------------------------------------------
// Immediate / UI actions
// ---------------------------------------------------------------------------

/** Dismiss overlays and accept incoming takes without deliberation. */
export function preferImmediate(actions: BotAction[]): BotAction | null {
  const dismiss = actions.find(
    (action) => action.type === 'dismissPickup' || action.type === 'dismissTakeReject',
  )
  if (dismiss) return dismiss
  const accept = actions.find((action) => action.type === 'respondTake' && action.accept)
  return accept ?? null
}

// ---------------------------------------------------------------------------
// Action filters
// ---------------------------------------------------------------------------

export type PlayAction = Extract<BotAction, { type: 'playCard' }>

export function playCards(actions: BotAction[]): PlayAction[] {
  return actions.filter(
    (action): action is PlayAction => action.type === 'playCard',
  )
}

export function withoutTake(actions: BotAction[]): BotAction[] {
  const rest = actions.filter((action) => action.type !== 'takeLeftHand')
  return rest.length > 0 ? rest : actions
}

// ---------------------------------------------------------------------------
// Card resolution
// ---------------------------------------------------------------------------

export function cardFor(
  view: BhabhiState,
  playerID: string,
  cardID: string,
): Card | undefined {
  return view.hands[playerID]?.find((card) => card.id === cardID)
}

export function wouldWin(view: BhabhiState, card: Card): boolean {
  if (!view.ledSuit || card.suit !== view.ledSuit || view.trick.length === 0) return false
  return card.rank > highestLedSuit(view.trick, view.ledSuit).card.rank
}

// ---------------------------------------------------------------------------
// Simple play selectors
// ---------------------------------------------------------------------------

export function lowestPlay(
  view: BhabhiState,
  playerID: string,
  plays: PlayAction[],
): BotAction {
  const hand = view.hands[playerID] ?? []
  return plays.reduce((best, action) => {
    const card = hand.find((c) => c.id === action.cardID)
    const bestCard = hand.find((c) => c.id === best.cardID)
    if (!card || !bestCard) return best
    return card.rank < bestCard.rank ? action : best
  })
}

/**
 * Lowest card that either wins or ducks the trick, depending on `wantWin`.
 * Falls back to the absolute lowest if no card satisfies the preference.
 */
export function lowestMatching(
  view: BhabhiState,
  playerID: string,
  plays: PlayAction[],
  wantWin: boolean,
): BotAction {
  const ranked = plays
    .map((action) => ({ action, card: cardFor(view, playerID, action.cardID) }))
    .filter((item): item is { action: PlayAction; card: Card } => !!item.card)
  const preferred = ranked.filter((item) => wouldWin(view, item.card) === wantWin)
  const pool = preferred.length > 0 ? preferred : ranked
  return pool.reduce((best, item) => (item.card.rank < best.card.rank ? item : best)).action
}

// ---------------------------------------------------------------------------
// Off-suit discard
// ---------------------------------------------------------------------------

/**
 * When void in the led suit, pick the card to throw off-suit.
 *
 * **Highest card from the shortest suit** — dumps dangerous high cards and
 * pushes toward more voids, which means more future discard freedom.
 */
export function smartDiscard(
  view: BhabhiState,
  playerID: string,
  plays: PlayAction[],
): BotAction {
  const hand = view.hands[playerID] ?? []
  const playableCards = plays
    .map((action) => ({ action, card: cardFor(view, playerID, action.cardID) }))
    .filter((item): item is { action: PlayAction; card: Card } => !!item.card)
  if (playableCards.length === 0) return plays[0]

  const groups = groupBySuit(hand)
  const suitCount = new Map(groups.map((g) => [g.suit, g.count]))

  return playableCards.reduce((best, item) => {
    const bestCount = suitCount.get(best.card.suit) ?? Infinity
    const itemCount = suitCount.get(item.card.suit) ?? Infinity
    if (itemCount < bestCount) return item
    if (itemCount === bestCount && item.card.rank > best.card.rank) return item
    return best
  }).action
}

// ---------------------------------------------------------------------------
// Controlled randomness
// ---------------------------------------------------------------------------

/**
 * Given scored candidates, pick from the top tier with controlled variance.
 * `jitter` (0–1) controls how much the choice varies: 0 = deterministic,
 * 0.15 = slight randomness among near-equal options.
 */
export function pickWithJitter<T extends { score: number }>(
  candidates: T[],
  rng: () => number,
  jitter: number,
): T {
  if (candidates.length === 0) throw new Error('No candidates')
  if (candidates.length === 1 || jitter <= 0) {
    return candidates.reduce((a, b) => (a.score >= b.score ? a : b))
  }
  const best = Math.max(...candidates.map((c) => c.score))
  const threshold = best - Math.abs(best) * jitter
  const top = candidates.filter((c) => c.score >= threshold)
  const pool = top.length > 0 ? top : candidates
  return pool[Math.floor(rng() * pool.length)]
}

// ---------------------------------------------------------------------------
// Trick position
// ---------------------------------------------------------------------------

export function playersStillToAct(view: BhabhiState, playerID: string): boolean {
  const played = new Set(view.trick.map((play) => play.playerID))
  return view.active.some((id) => id !== playerID && !played.has(id))
}
