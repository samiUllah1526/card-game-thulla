import { highestLedSuit } from '../../games/bhabhi-thulla/rules'
import type { BhabhiState, Card, Suit } from '../../games/bhabhi-thulla/types'
import {
  cardStrength,
  groupBySuit,
  inferVoids,
  isEndgame,
  nearEscapeOpponents,
  remainingPerSuit,
  thullaThreat,
} from '../analysis'
import type { BotAction, BotPolicy } from '../types'
import {
  cardFor,
  lowestMatching,
  pickWithJitter,
  playCards,
  type PlayAction,
  playersStillToAct,
  preferImmediate,
  smartDiscard,
  withoutTake,
  wouldWin,
} from './common'

const JITTER = 0.15

/**
 * Full-spectrum strategy: counts cards, infers voids from every off-suit
 * play, avoids thulla traps, sheds dangerous high cards when void, and
 * switches to micro-optimised endgame logic with ≤ 3 cards.
 *
 * A 15 % jitter keeps the bot unpredictable without hurting quality.
 */
export const mastermind: BotPolicy = {
  id: 'mastermind',
  choose(view, playerID, actions, rng) {
    const immediate = preferImmediate(actions)
    if (immediate) return immediate
    const plays = playCards(actions)
    if (plays.length === 0) return withoutTake(actions)[0]

    const hand = view.hands[playerID] ?? []

    if (view.trick.length === 0) return leadCard(view, playerID, plays, hand, rng)
    return followCard(view, playerID, plays, hand, rng)
  },
}

// ---------------------------------------------------------------------------
// Leading
// ---------------------------------------------------------------------------

function leadCard(
  view: BhabhiState,
  playerID: string,
  plays: PlayAction[],
  hand: Card[],
  rng: () => number,
): BotAction {
  if (isEndgame(hand)) return endgameLead(view, playerID, plays, hand, rng)

  const voids = inferVoids(view)
  const remaining = remainingPerSuit(view, playerID)
  const escaping = nearEscapeOpponents(view, playerID)
  const groups = groupBySuit(hand)

  const scored: Array<{ action: BotAction; score: number }> = []

  for (const group of groups) {
    const { suit, count: suitLength, lowest } = group
    const playAction = plays.find((a) => cardFor(view, playerID, a.cardID)?.id === lowest.id)
    if (!playAction) continue

    const voidOpponents = view.active.filter(
      (id) => id !== playerID && voids[id]?.has(suit),
    ).length
    const opponentsCanFollow = view.active.length - 1 - voidOpponents

    let score = 0
    score += suitLength * 12
    score -= voidOpponents * 80
    score += opponentsCanFollow * 15
    score += remaining[suit] * 4

    if (lowest.rank >= 13) score -= 25
    if (suitLength === hand.length) score += 60

    if (escaping.length > 0) {
      const escaperVoid = escaping.some((id) => voids[id]?.has(suit))
      if (escaperVoid) score += 30
    }

    scored.push({ action: playAction, score })
  }

  if (scored.length === 0) return plays[0]
  return pickWithJitter(scored, rng, JITTER).action
}

// ---------------------------------------------------------------------------
// Following
// ---------------------------------------------------------------------------

function followCard(
  view: BhabhiState,
  playerID: string,
  plays: PlayAction[],
  hand: Card[],
  rng: () => number,
): BotAction {
  const isOffSuit = plays.every((a) => {
    const card = cardFor(view, playerID, a.cardID)
    return card != null && card.suit !== view.ledSuit
  })

  if (isOffSuit) return offSuitDiscard(view, playerID, plays, hand, rng)

  const othersToAct = playersStillToAct(view, playerID)

  if (othersToAct) {
    if (thullaThreat(view, playerID)) {
      return strongDuck(view, playerID, plays, rng)
    }
    return lowestMatching(view, playerID, plays, false)
  }

  if (isEndgame(hand)) return endgameFollow(view, playerID, plays, hand, rng)
  return lowestMatching(view, playerID, plays, true)
}

/**
 * When a known-void opponent is still to play, winning the trick is
 * dangerous (they can thulla). Play the absolute lowest card regardless
 * of whether it wins.
 */
function strongDuck(
  view: BhabhiState,
  playerID: string,
  plays: PlayAction[],
  rng: () => number,
): BotAction {
  const ranked = plays
    .map((a) => ({ action: a, card: cardFor(view, playerID, a.cardID)! }))
    .filter((item) => !!item.card)
    .sort((a, b) => a.card.rank - b.card.rank)

  const nonWinning = ranked.filter((item) => !wouldWin(view, item.card))
  const pool = nonWinning.length > 0 ? nonWinning : ranked
  const candidates = pool.map((item, i) => ({
    action: item.action as BotAction,
    score: -i,
  }))
  return pickWithJitter(candidates, rng, JITTER).action
}

// ---------------------------------------------------------------------------
// Off-suit discard
// ---------------------------------------------------------------------------

/**
 * Shed the **highest** card from the **shortest** off-suit group.
 * This dumps dangerous aces/kings and pushes toward more voids.
 */
function offSuitDiscard(
  view: BhabhiState,
  playerID: string,
  plays: PlayAction[],
  hand: Card[],
  rng: () => number,
): BotAction {
  if (isEndgame(hand)) return endgameDiscard(view, playerID, plays, hand, rng)
  return smartDiscard(view, playerID, plays)
}

// ---------------------------------------------------------------------------
// Endgame (≤ 3 cards)
// ---------------------------------------------------------------------------

function endgameLead(
  view: BhabhiState,
  playerID: string,
  plays: PlayAction[],
  hand: Card[],
  rng: () => number,
): BotAction {
  if (hand.length === 1) return plays[0]

  const remaining = remainingPerSuit(view, playerID)
  const voids = inferVoids(view)
  const groups = groupBySuit(hand)

  if (hand.length === 2) {
    const sameSuit = groups.length === 1
    if (sameSuit) {
      const lowest = groups[0].lowest
      const action = plays.find((a) => cardFor(view, playerID, a.cardID)?.id === lowest.id)
      return action ?? plays[0]
    }
  }

  const scored: Array<{ action: BotAction; score: number }> = []
  for (const group of groups) {
    const { suit, lowest } = group
    const action = plays.find((a) => cardFor(view, playerID, a.cardID)?.id === lowest.id)
    if (!action) continue

    let score = 0
    const strength = cardStrength(lowest, view, playerID)
    score -= strength * 50

    const voidOpponents = view.active.filter(
      (id) => id !== playerID && voids[id]?.has(suit),
    ).length
    score -= voidOpponents * 40
    score += remaining[suit] * 8

    if (group.count === hand.length) score += 80

    scored.push({ action, score })
  }

  if (scored.length === 0) return plays[0]
  return pickWithJitter(scored, rng, JITTER).action
}

function endgameFollow(
  view: BhabhiState,
  playerID: string,
  plays: PlayAction[],
  hand: Card[],
  _rng: () => number,
): BotAction {
  if (hand.length === 1) return plays[0]

  const ranked = plays
    .map((a) => ({ action: a, card: cardFor(view, playerID, a.cardID)! }))
    .filter((item) => !!item.card)

  if (hand.length === 2 && view.ledSuit) {
    const suitCards = ranked.filter((item) => item.card.suit === view.ledSuit)
    if (suitCards.length === 2) {
      const highest = highestLedSuit(view.trick, view.ledSuit)
      const canWinBoth = suitCards.every((item) => item.card.rank > highest.card.rank)
      if (canWinBoth) {
        const lower = suitCards.reduce((a, b) => (a.card.rank < b.card.rank ? a : b))
        return lower.action
      }
    }
  }

  return lowestMatching(view, playerID, plays, true)
}

function endgameDiscard(
  view: BhabhiState,
  playerID: string,
  plays: PlayAction[],
  hand: Card[],
  _rng: () => number,
): BotAction {
  if (hand.length === 1) return plays[0]

  const ranked = plays
    .map((a) => ({ action: a, card: cardFor(view, playerID, a.cardID)! }))
    .filter((item) => !!item.card)

  const groups = groupBySuit(hand)
  const remaining = remainingPerSuit(view, playerID)

  let best: { action: BotAction; score: number } | null = null
  for (const item of ranked) {
    const group = groups.find((g) => g.suit === item.card.suit)
    if (!group) continue

    let score = 0
    score += item.card.rank * 10
    if (group.count === 1) score += 50
    score -= remaining[item.card.suit] * 5

    if (!best || score > best.score) best = { action: item.action, score }
  }
  return best?.action ?? smartDiscard(view, playerID, plays)
}
