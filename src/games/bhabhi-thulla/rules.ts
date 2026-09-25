import type { BhabhiState, Card, Rank, Suit, TrickPlay } from './types'

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
  addEvent(state, `Player ${Number(playerID) + 1} got away`)
}

export function addEvent(state: BhabhiState, text: string): void {
  const id = (state.events.at(-1)?.id ?? 0) + 1
  state.events = [...state.events.slice(-4), { id, text }]
}

export function syncCounts(state: BhabhiState): void {
  state.handCounts = Object.fromEntries(
    Object.entries(state.hands).map(([id, hand]) => [id, hand.length]),
  )
  state.wasteCount = state.waste.length
}

export function finishIfNeeded(state: BhabhiState): boolean {
  if (state.started && state.active.length === 1) {
    state.phase = 'finished'
    state.bhabhi = state.active[0]
    addEvent(state, `Player ${Number(state.bhabhi) + 1} is Bhabhi`)
    return true
  }
  return false
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
    addEvent(state, 'First trick went to waste')
  } else if (thulla) {
    state.hands[highest.playerID].push(...state.trick.map((play) => play.card))
    nextLeader = highest.playerID
    addEvent(state, `Thulla! Player ${Number(highest.playerID) + 1} picked up the trick`)
  } else {
    state.waste.push(...state.trick.map((play) => play.card))
    nextLeader = state.active.includes(highest.playerID)
      ? highest.playerID
      : nextActive(state.active, highest.playerID)
    addEvent(state, `Player ${Number(highest.playerID) + 1} won the trick`)
  }

  state.trick = []
  state.ledSuit = null
  state.leader = nextLeader
  state.phase = 'preTrick'
  syncCounts(state)
  return nextLeader
}
