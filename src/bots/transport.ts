import { Client } from 'boardgame.io/client'
import { SocketIO } from 'boardgame.io/multiplayer'
import { config } from '../config'
import { BhabhiThulla } from '../games/bhabhi-thulla/game'
import type { BhabhiState } from '../games/bhabhi-thulla/types'
import type { BotDifficulty } from './difficulty'
import type { BotAction, BotConnection, BotSnapshot, BotTransport } from './types'

/**
 * boardgame.io lobby plus a socket client for one bot seat.
 * The runner never imports this; the server passes it in.
 */
export function createLobbyTransport(server: string): BotTransport {
  const game = config.game.name
  return {
    async join(matchID, playerID, playerName) {
      const body = await json<{ playerCredentials: string }>(
        `${server}/games/${game}/${matchID}/join`,
        {
          method: 'POST',
          body: JSON.stringify({ playerID: Number(playerID), playerName }),
        },
      )
      return { credentials: body.playerCredentials }
    },
    async leave(matchID, playerID, credentials) {
      await json(`${server}/games/${game}/${matchID}/leave`, {
        method: 'POST',
        body: JSON.stringify({ playerID: Number(playerID), credentials }),
      })
    },
    connect(session) {
      return new SocketBotConnection(server, session)
    },
  }
}

class SocketBotConnection implements BotConnection {
  private readonly client: ReturnType<typeof Client<BhabhiState>>

  constructor(
    server: string,
    session: { matchID: string; playerID: string; credentials: string },
  ) {
    this.client = Client<BhabhiState>({
      game: BhabhiThulla,
      matchID: session.matchID,
      playerID: session.playerID,
      credentials: session.credentials,
      multiplayer: SocketIO({ server }),
      debug: false,
    })
  }

  start(): void {
    this.client.start()
  }

  subscribe(listener: (snapshot: BotSnapshot | null) => void): () => void {
    return this.client.subscribe((state) => {
      if (!state) {
        listener(null)
        return
      }
      listener({ G: state.G, isConnected: !!state.isConnected })
    })
  }

  noteBot(difficulty: BotDifficulty | null): void {
    this.moves().noteBot?.(difficulty)
  }

  markSeated(): void {
    this.moves().markSeated?.()
  }

  dispatch(action: BotAction): void {
    const moves = this.moves()
    switch (action.type) {
      case 'playCard':
        moves.playCard?.(action.cardID)
        return
      case 'takeLeftHand':
        moves.takeLeftHand?.()
        return
      case 'respondTake':
        moves.respondTake?.(action.accept)
        return
      case 'dismissPickup':
        moves.dismissPickup?.()
        return
      case 'dismissTakeReject':
        moves.dismissTakeReject?.()
        return
    }
  }

  stop(): void {
    this.client.stop()
  }

  private moves(): Record<string, (...args: unknown[]) => void> {
    return this.client.moves as Record<string, (...args: unknown[]) => void>
  }
}

async function json<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  })
  const body = (await response.json().catch(() => ({}))) as { error?: string } & T
  if (!response.ok) throw new Error(body.error ?? `Bot lobby request failed (${response.status})`)
  return body
}
