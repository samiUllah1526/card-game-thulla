import { Client } from 'boardgame.io/client'
import { SocketIO } from 'boardgame.io/multiplayer'
import { get, writable, type Readable } from 'svelte/store'
import { utcNowMs } from '../lib/time'
import { config } from '../config'
import { BhabhiThulla } from '../games/bhabhi-thulla/game'
import type { BhabhiState, Session } from '../games/bhabhi-thulla/types'
import {
  chatDeleteId,
  mergeChatMessages,
  normalizeChatMessage,
  sanitizeChatText,
  type TableChatMessage,
} from './chat'
import { deleteMatchChat, fetchMatchChat, persistMatchChat } from './authClient'

export interface GameConnection {
  state: Readable<GameSnapshot | null>
  chat: Readable<TableChatMessage[]>
  sendChat: (text: string) => boolean
  deleteChat: (id: string) => void
  moves: {
    startGame: () => void
    addSeat: () => void
    markSeated: () => void
    playAgain: () => void
    takeLeftHand: () => void
    playCard: (cardID: string) => void
    dismissPickup: () => void
    respondTake: (accept: boolean) => void
    dismissTakeReject: () => void
    unlockPeek: (password: string) => void
    leaveGame: () => void
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
  const deletedIds = new Set<string>()
  let chatOpen = true
  let chatReady = false
  let visibleAfter = 0
  let sawFinished = false

  const syncChat = (incoming: TableChatMessage[] = []) => {
    if (!chatReady || !chatOpen) return
    for (const entry of client.chatMessages ?? []) {
      const deleteId = chatDeleteId(entry.payload)
      if (deleteId) deletedIds.add(deleteId)
    }
    const fromSocket = (client.chatMessages ?? [])
      .map((entry) => normalizeChatMessage(entry))
      .filter((item): item is TableChatMessage => !!item && item.at >= visibleAfter)
    chat.set(
      mergeChatMessages(get(chat), [...fromSocket, ...incoming], config.chat.historyCap, deletedIds),
    )
  }

  const applyServer = (payload: { messages: TableChatMessage[]; visibleAfter: number; open: boolean }) => {
    visibleAfter = payload.visibleAfter
    chatOpen = payload.open
    chatReady = true
    if (!payload.open) {
      chat.set([])
      return
    }
    syncChat(payload.messages)
  }

  const reloadChat = () =>
    fetchMatchChat(session)
      .then(applyServer)
      .catch(() => {
        chatReady = true
        if (!sawFinished) chatOpen = true
      })

  void reloadChat()

  let markedSeat = false
  const unsubscribe = client.subscribe((nextState) => {
    const snap = nextState as GameSnapshot | null
    if (
      !markedSeat &&
      snap?.isConnected &&
      snap.G &&
      !snap.G.started &&
      !snap.G.seated?.[session.playerID]
    ) {
      markedSeat = true
      client.moves.markSeated()
    }
    state.set(nextState as GameSnapshot | null)
    const phase = (nextState as GameSnapshot | null)?.G?.phase
    if (phase === 'finished') {
      sawFinished = true
      chatOpen = false
      chat.set([])
      return
    }
    if (sawFinished) {
      sawFinished = false
      chatOpen = false
      chat.set([])
      visibleAfter = utcNowMs()
      void reloadChat()
      return
    }
    syncChat()
  })
  client.start()

  return {
    state,
    chat,
    sendChat: (text) => {
      if (!chatOpen) return false
      const cleaned = sanitizeChatText(text, config.chat.maxLength)
      if (!cleaned) return false
      const message = { id: crypto.randomUUID(), text: cleaned, at: Math.max(utcNowMs(), visibleAfter) }
      client.sendChatMessage(message)
      void persistMatchChat(session, message).catch(() => {
        // Socket already delivered the line; DB write can retry on the next send.
      })
      return true
    },
    deleteChat: (id) => {
      if (!chatOpen) return
      deletedIds.add(id)
      chat.update((lines) => lines.filter((line) => line.id !== id))
      void deleteMatchChat(session, id)
        .then(() => {
          client.sendChatMessage({ deleteId: id })
        })
        .catch(() => {
          deletedIds.delete(id)
          void reloadChat()
        })
    },
    moves: {
      startGame: () => client.moves.startGame(),
      addSeat: () => client.moves.addSeat(),
      markSeated: () => client.moves.markSeated(),
      playAgain: () => client.moves.playAgain(),
      takeLeftHand: () => client.moves.takeLeftHand(),
      playCard: (cardID) => client.moves.playCard(cardID),
      dismissPickup: () => client.moves.dismissPickup(),
      respondTake: (accept) => client.moves.respondTake(accept),
      dismissTakeReject: () => client.moves.dismissTakeReject(),
      unlockPeek: (password) => client.moves.unlockPeek(password),
      leaveGame: () => client.moves.leaveGame(),
    },
    stop: () => {
      unsubscribe()
      client.stop()
    },
  }
}
