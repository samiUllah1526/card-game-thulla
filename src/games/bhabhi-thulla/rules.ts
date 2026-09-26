import { config } from '../../config'
import { utcNowMs } from '../../lib/time'
import type { BhabhiState, Card, GameEvent, GameEventInput, Rank, Suit, TrickPlay } from './types'

export const SUITS: Suit[] = ['S', 'H', 'D', 'C']
export const RANKS: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]

export function createDeck(): Card[] {
  return SUITS.flatMap((suit) =>
    RANKS.map((rank) => ({ id: `${suit}-${rank}`, suit, rank })),
  )
}

export function deal(deck: Card[], playerCount: number): Record<string, Card[]> {
  const hands: Record<string, Card[]> = Object.fromEntries(
    Array.from({ length: playerCount }, (_, index) => [String(index), []]),
  )
  deck.forEach((card, index) => hands[String(index % playerCount)].push(card))
  return hands
}

export function hasAceOfSpades(hand: Card[]): boolean {
  return hand.some((card) => card.suit === 'S' && card.rank === 14)
}

export function legalCards(hand: Card[], ledSuit: Suit | null): Card[] {
  if (!ledSuit) return hand
  const matching = hand.filter((card) => card.suit === ledSuit)
  return matching.length > 0 ? matching : hand
}

export function isLegalPlay(hand: Card[], cardID: string, ledSuit: Suit | null): boolean {
  return legalCards(hand, ledSuit).some((card) => card.id === cardID)
}

export function highestLedSuit(trick: TrickPlay[], ledSuit: Suit): TrickPlay {
  const matching = trick.filter((play) => play.card.suit === ledSuit)
  return matching.reduce((highest, play) =>
    play.card.rank > highest.card.rank ? play : highest,
  )
}

export function nextActive(active: string[], after: string): string {
  if (active.length === 0) return after
  const numeric = active.map(Number).sort((a, b) => a - b)
  const next = numeric.find((id) => id > Number(after)) ?? numeric[0]
  return String(next)
}

export function removeCard(hand: Card[], cardID: string): Card[] {
  return hand.filter((card) => card.id !== cardID)
}

export function removeEmptyPlayer(state: BhabhiState, playerID: string): void {
  if (state.hands[playerID].length !== 0 || !state.active.includes(playerID)) return
  state.active = state.active.filter((id) => id !== playerID)
  state.gotAway.push(playerID)
  addEvent(state, { type: 'gotAway', player: playerID })
}

export function addEvent(state: BhabhiState, event: GameEventInput): void {
  const id = (state.events.at(-1)?.id ?? 0) + 1
  state.events = [
    ...state.events.slice(-(config.game.eventHistory - 1)),
    { ...event, id } as GameEvent,
  ]
}

export function syncCounts(state: BhabhiState): void {
  state.handCounts = Object.fromEntries(
    Object.entries(state.hands).map(([id, hand]) => [id, hand.length]),
  )
  state.wasteCount = state.waste.length
}

export function finishIfNeeded(state: BhabhiState): boolean {
  if (!state.started || state.active.length !== 1) return false
  // Already finished this deal — do not append history twice.
  if (state.phase === 'finished' && state.bhabhi === state.active[0]) return true

  state.phase = 'finished'
  state.bhabhi = state.active[0]
  if (!state.dealHistory) state.dealHistory = []
  state.dealHistory.push({
    deal: state.dealHistory.length + 1,
    bhabhi: state.bhabhi,
    gotAway: [...state.gotAway],
    at: utcNowMs(),
  })
  addEvent(state, { type: 'bhabhi', player: state.bhabhi })
  return true
}

/** True while a Thulla pickup is waiting for the receiver to dismiss it. */
export function pickupPending(state: BhabhiState): boolean {
  return !!state.lastPickup && !state.lastPickup.dismissed
}

/** True while a take request is waiting for Accept/Reject. */
export function takePending(state: BhabhiState): boolean {
  return !!state.pendingTake
}

/** True while a rejected take roast is waiting for the requester to dismiss. */
export function takeRejectPending(state: BhabhiState): boolean {
  return !!state.lastTakeReject && !state.lastTakeReject.dismissed
}

/** Blocks new leads/takes while Thulla, take ask, or reject roast is open. */
export function actionBlocked(state: BhabhiState): boolean {
  return pickupPending(state) || takePending(state) || takeRejectPending(state)
}

/**
 * Transfer victim's hand to taker; victim gets away.
 * `via` chooses which public event is recorded.
 */
export function executeTake(
  state: BhabhiState,
  taker: string,
  victim: string,
  via: 'free' | 'accepted' = 'free',
): boolean {
  const count = state.hands[victim].length
  state.hands[taker].push(...state.hands[victim])
  state.hands[victim] = []
  removeEmptyPlayer(state, victim)
  if (via === 'accepted') {
    addEvent(state, { type: 'takeAccepted', from: taker, to: victim, count })
  } else {
    addEvent(state, { type: 'took', taker, victim, count })
  }
  syncCounts(state)
  const finished = finishIfNeeded(state)
  state.turnPlayer = finished ? state.hostID : taker
  return finished
}

export function resolveTrick(state: BhabhiState, thulla: boolean): string {
  const ledSuit = state.ledSuit!
  const highest = highestLedSuit(state.trick, ledSuit)
  let nextLeader: string

  if (state.firstTrick) {
    state.waste.push(...state.trick.map((play) => play.card))
    nextLeader = state.active.includes(state.firstLeader)
      ? state.firstLeader
      : nextActive(state.active, state.firstLeader)
    state.firstTrick = false
    recordTrick(state, highest.playerID, ledSuit)
    addEvent(state, { type: 'firstTrickWaste', leader: nextLeader })
  } else if (thulla) {
    const thullaPlay = state.trick[state.trick.length - 1]
    const cards = state.trick.map((play) => play.card)
    state.hands[highest.playerID].push(...cards)
    state.pickupCount += 1
    state.lastPickup = {
      id: state.pickupCount,
      giver: thullaPlay.playerID,
      receiver: highest.playerID,
      ledSuit,
      thullaCard: thullaPlay.card,
      cards,
      dismissed: false,
    }
    nextLeader = highest.playerID
    addEvent(state, {
      type: 'thulla',
      giver: thullaPlay.playerID,
      receiver: highest.playerID,
      count: cards.length,
    })
  } else {
    state.waste.push(...state.trick.map((play) => play.card))
    nextLeader = state.active.includes(highest.playerID)
      ? highest.playerID
      : nextActive(state.active, highest.playerID)
    recordTrick(state, highest.playerID, ledSuit)
    addEvent(state, { type: 'trickWon', winner: highest.playerID })
  }

  state.trick = []
  state.ledSuit = null
  state.leader = nextLeader
  state.phase = 'preTrick'
  syncCounts(state)
  return nextLeader
}

function recordTrick(state: BhabhiState, winner: string, ledSuit: Suit): void {
  state.trickCount += 1
  state.lastTrick = {
    id: state.trickCount,
    plays: state.trick.map((play) => ({ ...play })),
    winner,
    ledSuit,
  }
}
