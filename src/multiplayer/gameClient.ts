import { Client } from 'boardgame.io/client'
import { SocketIO } from 'boardgame.io/multiplayer'
import { get, writable, type Readable } from 'svelte/store'
import { config } from '../config'
import { BhabhiThulla } from '../games/bhabhi-thulla/game'
import type { BhabhiState, Session } from '../games/bhabhi-thulla/types'
import { fetchMatchChat, persistMatchChat } from './authClient'
import {
  mergeChatMessages,
  normalizeChatMessage,
  sanitizeChatText,
  type TableChatMessage,
} from './chat'

export interface GameConnection {
  state: Readable<GameSnapshot | null>
  chat: Readable<TableChatMessage[]>
  sendChat: (text: string) => boolean
  moves: {
    startGame: () => void
    playAgain: () => void
    takeLeftHand: () => void
    playCard: (cardID: string) => void
    dismissPickup: () => void
    respondTake: (accept: boolean) => void
    dismissTakeReject: () => void
    unlockPeek: (password: string) => void
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
  const chat = writable<TableChatMessage[]>([])

  const syncChat = (incoming: TableChatMessage[] = []) => {
    const fromSocket = (client.chatMessages ?? [])
      .map((entry) => normalizeChatMessage(entry))
      .filter((item): item is TableChatMessage => !!item)
    chat.set(mergeChatMessages(get(chat), [...fromSocket, ...incoming], config.chat.historyCap))
  }

  void fetchMatchChat(session)
    .then((messages) => syncChat(messages))
    .catch(() => {
      // Live socket chat still works if history hasn't loaded yet.
    })

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
      const message = { id: crypto.randomUUID(), text: cleaned, at: Date.now() }
      client.sendChatMessage(message)
      void persistMatchChat(session, message).catch(() => {
        // Socket already delivered the line; DB write can retry on the next send.
      })
      return true
    },
    moves: {
      startGame: () => client.moves.startGame(),
      playAgain: () => client.moves.playAgain(),
      takeLeftHand: () => client.moves.takeLeftHand(),
      playCard: (cardID) => client.moves.playCard(cardID),
      dismissPickup: () => client.moves.dismissPickup(),
      respondTake: (accept) => client.moves.respondTake(accept),
      dismissTakeReject: () => client.moves.dismissTakeReject(),
      unlockPeek: (password) => client.moves.unlockPeek(password),
    },
    stop: () => {
      unsubscribe()
      client.stop()
    },
  }
}
