export type Suit = 'S' | 'H' | 'D' | 'C'
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14

export interface Card {
  id: string
  suit: Suit
  rank: Rank
}

export interface TrickPlay {
  playerID: string
  card: Card
}

/**
 * Structured game events. The server only knows player IDs; the client
 * turns them into sentences with real player names.
 */
export type GameEvent =
  | { id: number; type: 'waiting' }
  | { id: number; type: 'firstLead'; player: string }
  | { id: number; type: 'firstTrickWaste'; leader: string }
  | { id: number; type: 'trickWon'; winner: string }
  | { id: number; type: 'thulla'; giver: string; receiver: string; count: number }
  | { id: number; type: 'gotAway'; player: string }
  | { id: number; type: 'took'; taker: string; victim: string; count: number }
  | { id: number; type: 'takeAsked'; from: string; to: string }
  | { id: number; type: 'takeAccepted'; from: string; to: string; count: number }
  | { id: number; type: 'takeRejected'; from: string; to: string }
  | { id: number; type: 'bhabhi'; player: string }

/** Leader asked to take the next player's hand; waiting for Accept/Reject. */
export interface PendingTake {
  id: number
  from: string
  to: string
}

/** Public roast after a take request is rejected. */
export interface TakeRejectRoast {
  id: number
  from: string
  to: string
  dismissed: boolean
}

/** A GameEvent before the server assigns its id (distributes over the union). */
export type GameEventInput = GameEvent extends infer E ? (E extends GameEvent ? Omit<E, 'id'> : never) : never

/** Public record of a Thulla pickup so every client shows the same overlay. */
export interface PickupEvent {
  id: number
  giver: string
  receiver: string
  ledSuit: Suit
  thullaCard: Card
  cards: Card[]
  /** Set by the receiver's dismissPickup move; the overlay stays until then. */
  dismissed: boolean
}

/** Public record of the last completed (non-Thulla) trick so the final card is visible. */
export interface ResolvedTrick {
  id: number
  plays: TrickPlay[]
  winner: string
  ledSuit: Suit
}

export interface Session {
  matchID: string
  playerID: string
  credentials: string
  playerName: string
}

export interface LobbySeat {
  id: number
  name?: string
}

export interface SetupData {
  shuffleAlgorithm?: string
  shuffleScale?: number
  takeRequiresPermission?: boolean
}

export interface ShuffleReport {
  algorithm: string
  algorithmLabel: string
  scale: number
  alpha: number
  orderScore: number
  clumpScore: number
  verdict: string
  verdictLabel: string
}

/** One finished deal on this table (survives Play again). */
export interface DealResult {
  deal: number
  bhabhi: string
  gotAway: string[]
  at: number
}

export interface BhabhiState {
  hands: Record<string, Card[]>
  handCounts: Record<string, number>
  waste: Card[]
  wasteCount: number
  trick: TrickPlay[]
  ledSuit: Suit | null
  pickupCount: number
  lastPickup?: PickupEvent
  trickCount: number
  lastTrick?: ResolvedTrick
  active: string[]
  gotAway: string[]
  leader: string
  turnPlayer: string
  firstLeader: string
  firstTrick: boolean
  started: boolean
  hostID: string
  phase: 'waiting' | 'preTrick' | 'follow' | 'finished'
  events: GameEvent[]
  shuffleReport: ShuffleReport
  takeRequiresPermission: boolean
  takeCount: number
  pendingTake?: PendingTake
  lastTakeReject?: TakeRejectRoast
  /** Seats that unlocked full-hand peek (stripped from other clients' playerView). */
  peekers?: Record<string, boolean>
  /** Finished deals on this match; kept across Play again. */
  dealHistory: DealResult[]
  winner?: string
  bhabhi?: string
}
