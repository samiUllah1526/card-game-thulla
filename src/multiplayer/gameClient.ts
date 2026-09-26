import { Client } from 'boardgame.io/client'
import { SocketIO } from 'boardgame.io/multiplayer'
import { get, writable, type Readable } from 'svelte/store'
import { config } from '../config'
import { BhabhiThulla } from '../games/bhabhi-thulla/game'
import type { BhabhiState, Session } from '../games/bhabhi-thulla/types'
import {
  loadChatCache,
  mergeChatMessages,
  normalizeChatMessage,
  saveChatCache,
  sanitizeChatText,
  type TableChatMessage,
} from './chat'

export interface GameConnection {
  state: Readable<GameSnapshot | null>
  chat: Readable<TableChatMessage[]>
  sendChat: (text: string) => boolean
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
  const chat = writable<TableChatMessage[]>(loadChatCache(session.matchID))

  const syncChat = () => {
    const incoming = (client.chatMessages ?? [])
      .map((entry) => normalizeChatMessage(entry))
      .filter((item): item is TableChatMessage => !!item)
    const merged = mergeChatMessages(get(chat), incoming, config.chat.historyCap)
    chat.set(merged)
    saveChatCache(session.matchID, merged)
  }

  const unsubscribe = client.subscribe((nextState) => {
    state.set(nextState as GameSnapshot | null)
    syncChat()
  })
  client.start()

  return {
    state,
    chat,
    sendChat: (text) => {
      const cleaned = sanitizeChatText(text, config.chat.maxLength)
      if (!cleaned) return false
      client.sendChatMessage({ text: cleaned, at: Date.now() })
      return true
    },
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
