import type { BhabhiState } from '../games/bhabhi-thulla/types'
import type { BotDifficulty } from './difficulty'

/** A move a seated player can make on their turn. Host controls are not included. */
export type BotAction =
  | { type: 'playCard'; cardID: string }
  | { type: 'takeLeftHand' }
  | { type: 'respondTake'; accept: boolean }
  | { type: 'dismissPickup' }
  | { type: 'dismissTakeReject' }

export interface BotPolicy {
  id: BotDifficulty
  choose(view: BhabhiState, playerID: string, actions: BotAction[], rng: () => number): BotAction
}

export interface BotSnapshot {
  G: BhabhiState
  isConnected: boolean
}

/** A connected seat. The runner dispatches actions; it does not open sockets itself. */
export interface BotConnection {
  start(): void
  subscribe(listener: (snapshot: BotSnapshot | null) => void): () => void
  noteBot(difficulty: BotDifficulty | null): void
  markSeated(): void
  dispatch(action: BotAction): void
  stop(): void
}

export interface BotTransport {
  join(matchID: string, playerID: string, playerName: string): Promise<{ credentials: string }>
  leave(matchID: string, playerID: string, credentials: string): Promise<void>
  connect(session: { matchID: string; playerID: string; credentials: string }): BotConnection
}

export interface BotClock {
  wait(ms: number): Promise<void>
}

export const realClock: BotClock = {
  wait(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms)
    })
  },
}
