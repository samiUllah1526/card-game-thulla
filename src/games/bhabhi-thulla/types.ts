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

export interface PublicEvent {
  id: number
  text: string
}

export interface BhabhiState {
  hands: Record<string, Card[]>
  handCounts: Record<string, number>
  waste: Card[]
  wasteCount: number
  trick: TrickPlay[]
  ledSuit: Suit | null
  active: string[]
  gotAway: string[]
  leader: string
  turnPlayer: string
  firstLeader: string
  firstTrick: boolean
  started: boolean
  hostID: string
  phase: 'waiting' | 'preTrick' | 'follow' | 'finished'
  events: PublicEvent[]
  winner?: string
  bhabhi?: string
}

export interface LobbySeat {
  id: number
  name?: string
}

export interface Session {
  matchID: string
  playerID: string
  credentials: string
  playerName: string
}
