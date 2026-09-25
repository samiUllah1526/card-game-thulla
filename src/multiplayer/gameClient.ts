import { Client } from 'boardgame.io/client'
import { SocketIO } from 'boardgame.io/multiplayer'
import { writable, type Readable } from 'svelte/store'
import { BhabhiThulla } from '../games/bhabhi-thulla/game'
import type { BhabhiState, Session } from '../games/bhabhi-thulla/types'

export interface GameConnection {
  state: Readable<GameSnapshot | null>
  moves: {
    startGame: () => void
    takeLeftHand: () => void
    playCard: (cardID: string) => void
    dismissPickup: () => void
    respondTake: (accept: boolean) => void
    dismissTakeReject: () => void
  }
  stop: () => void
}

export interface GameSnapshot {
  G: BhabhiState
  ctx: {
    currentPlayer: string
    gameover?: unknown
  }
  isActive: boolean
  isConnected: boolean
}

export function connectGame(session: Session): GameConnection {
  const client = Client<BhabhiState>({
    game: BhabhiThulla,
    matchID: session.matchID,
    playerID: session.playerID,
    credentials: session.credentials,
    multiplayer: SocketIO({ server: window.location.origin }),
    debug: false,
  })
  const state = writable<GameSnapshot | null>(null)
  const unsubscribe = client.subscribe((nextState) =>
    state.set(nextState as GameSnapshot | null),
  )
  client.start()

  return {
    state,
    moves: {
      startGame: () => client.moves.startGame(),
      takeLeftHand: () => client.moves.takeLeftHand(),
      playCard: (cardID) => client.moves.playCard(cardID),
      dismissPickup: () => client.moves.dismissPickup(),
      respondTake: (accept) => client.moves.respondTake(accept),
      dismissTakeReject: () => client.moves.dismissTakeReject(),
    },
    stop: () => {
      unsubscribe()
      client.stop()
    },
  }
}
