import type { BhabhiState, LobbySeat } from '../games/bhabhi-thulla/types'

/** Public table. Hands, waste, peek flags, chat, and credentials are already removed. */
export interface WatchSnapshot {
  closed: false
  seats: LobbySeat[]
  G: BhabhiState
  ctx: { currentPlayer: string }
}

export type WatchEvent = WatchSnapshot | { closed: true }
