import { RANKS } from '../games/bhabhi-thulla/rules'
import type { BhabhiState, Card, Suit } from '../games/bhabhi-thulla/types'

/**
 * Stateless game-state analysis for bot policies.
 *
 * Every function is a pure read of `BhabhiState` — no mutations, no side
 * effects. Policies compose these building blocks to decide what to play;
 * adding a new insight means adding one function here, not touching every
 * difficulty level.
 */

// ---------------------------------------------------------------------------
// Void inference
// ---------------------------------------------------------------------------

/**
 * Suits each opponent is known to lack, inferred from **all** available
 * evidence — explicit `shownVoids`, thulla events, and off-suit plays
 * visible in the current trick.
 */
export function inferVoids(view: BhabhiState): Record<string, Set<Suit>> {
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
  if (view.ledSuit) {
    for (const play of view.trick) {
      if (play.card.suit !== view.ledSuit) add(play.playerID, view.ledSuit)
    }
  }
  return map
}

// ---------------------------------------------------------------------------
// Card counting
// ---------------------------------------------------------------------------

/** How many cards of each suit are still held by opponents (not in waste, hand, or trick). */
export function remainingPerSuit(
  view: BhabhiState,
  playerID: string,
): Record<Suit, number> {
  const totals: Record<Suit, number> = { S: 13, H: 13, D: 13, C: 13 }
  for (const card of view.waste) totals[card.suit]--
  for (const card of view.hands[playerID] ?? []) totals[card.suit]--
  for (const play of view.trick) totals[play.card.suit]--
  return totals
}

/**
 * Relative strength of a card (0 = weakest, 1 = strongest remaining).
 * Calculated against all cards **not** already accounted for (waste, own
 * hand, current trick).
 */
export function cardStrength(
  card: Card,
  view: BhabhiState,
  playerID: string,
): number {
  const known = new Set<string>()
  for (const w of view.waste) known.add(w.id)
  for (const play of view.trick) known.add(play.card.id)
  for (const c of view.hands[playerID] ?? []) known.add(c.id)

  let higher = 0
  let total = 0
  for (const rank of RANKS) {
    const id = `${card.suit}-${rank}`
    if (known.has(id) || id === card.id) continue
    total++
    if (rank > card.rank) higher++
  }
  return total === 0 ? 1.0 : 1.0 - higher / total
}

// ---------------------------------------------------------------------------
// Hand grouping
// ---------------------------------------------------------------------------

export interface SuitGroup {
  suit: Suit
  cards: Card[]
  count: number
  lowest: Card
  highest: Card
}

/** Group a hand by suit, each group sorted by ascending rank. */
export function groupBySuit(hand: Card[]): SuitGroup[] {
  const groups = new Map<Suit, Card[]>()
  for (const card of hand) {
    ;(groups.get(card.suit) ?? (groups.set(card.suit, []), groups.get(card.suit)!)).push(card)
  }
  return [...groups].map(([suit, cards]) => {
    cards.sort((a, b) => a.rank - b.rank)
    return {
      suit,
      cards,
      count: cards.length,
      lowest: cards[0],
      highest: cards[cards.length - 1],
    }
  })
}

// ---------------------------------------------------------------------------
// Opponent awareness
// ---------------------------------------------------------------------------

/** IDs of opponents with at most `threshold` cards (close to escaping). */
export function nearEscapeOpponents(
  view: BhabhiState,
  playerID: string,
  threshold = 2,
): string[] {
  return view.active.filter(
    (id) => id !== playerID && (view.handCounts[id] ?? 0) <= threshold,
  )
}

/**
 * True when at least one opponent who has **not yet played** in this trick
 * is known to be void in the led suit — meaning they could thulla the
 * current trick winner.
 */
export function thullaThreat(view: BhabhiState, playerID: string): boolean {
  if (!view.ledSuit) return false
  const played = new Set(view.trick.map((p) => p.playerID))
  const voids = inferVoids(view)
  return view.active.some(
    (id) => id !== playerID && !played.has(id) && voids[id]?.has(view.ledSuit!),
  )
}

// ---------------------------------------------------------------------------
// Endgame detection
// ---------------------------------------------------------------------------

/** True when the player is in a critical shedding window. */
export function isEndgame(hand: Card[]): boolean {
  return hand.length > 0 && hand.length <= 3
}
