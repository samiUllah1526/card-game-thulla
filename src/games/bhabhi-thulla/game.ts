import { INVALID_MOVE } from 'boardgame.io/core'
import type { Game } from 'boardgame.io'
import { config } from '../../config'
import {
  addEvent,
  createDeck,
  deal,
  finishIfNeeded,
  hasAceOfSpades,
  isLegalPlay,
  nextActive,
  pickupPending,
  removeCard,
  removeEmptyPlayer,
  resolveTrick,
  syncCounts,
} from './rules'
import type { BhabhiState } from './types'

function playCard(
  { G, playerID }: { G: BhabhiState; playerID: string },
  cardID: string,
) {
  if (!G.started || G.phase === 'finished' || playerID !== G.turnPlayer) return INVALID_MOVE
  if (G.phase !== 'preTrick' && G.phase !== 'follow') return INVALID_MOVE
  if (pickupPending(G)) return INVALID_MOVE

  const hand = G.hands[playerID]
  const card = hand.find((candidate) => candidate.id === cardID)
  if (!card || !isLegalPlay(hand, cardID, G.ledSuit)) return INVALID_MOVE

  if (G.firstTrick && G.trick.length === 0 && (card.suit !== 'S' || card.rank !== 14)) {
    return INVALID_MOVE
  }

  const wasLead = G.trick.length === 0
  if (wasLead) {
    G.ledSuit = card.suit
    G.leader = playerID
  }

  const isThulla = !wasLead && card.suit !== G.ledSuit
  G.hands[playerID] = removeCard(hand, cardID)
  G.trick.push({ playerID, card })
  removeEmptyPlayer(G, playerID)
  syncCounts(G)

  if (finishIfNeeded(G)) {
    G.turnPlayer = G.active[0]
    return
  }

  if (isThulla) {
    G.turnPlayer = resolveTrick(G, true)
    return
  }

  const played = new Set(G.trick.map((play) => play.playerID))
  const remaining = G.active.filter((id) => !played.has(id))
  if (remaining.length === 0) {
    G.turnPlayer = resolveTrick(G, false)
    return
  }

  G.phase = 'follow'
  G.turnPlayer = nextActive(remaining, playerID)
}

export const BhabhiThulla: Game<BhabhiState> = {
  name: config.game.name,
  minPlayers: config.game.minPlayers,
  maxPlayers: config.game.maxPlayers,
  disableUndo: true,

  setup: ({ ctx, random }) => {
    const hands = deal(random.Shuffle(createDeck()), ctx.numPlayers)
    const firstLeader =
      Object.entries(hands).find(([, hand]) => hasAceOfSpades(hand))?.[0] ?? '0'
    const handCounts = Object.fromEntries(
      Object.entries(hands).map(([id, hand]) => [id, hand.length]),
    )

    return {
      hands,
      handCounts,
      waste: [],
      wasteCount: 0,
      trick: [],
      ledSuit: null,
      pickupCount: 0,
      trickCount: 0,
      active: Array.from({ length: ctx.numPlayers }, (_, index) => String(index)),
      gotAway: [],
      leader: firstLeader,
      turnPlayer: '0',
      firstLeader,
      firstTrick: true,
      started: false,
      hostID: '0',
      phase: 'waiting',
      events: [{ id: 1, type: 'waiting' }],
    }
  },

  moves: {
    startGame: ({ G, playerID }) => {
      if (G.started || playerID !== G.hostID) return INVALID_MOVE
      G.started = true
      G.phase = 'preTrick'
      G.turnPlayer = G.firstLeader
      addEvent(G, { type: 'firstLead', player: G.firstLeader })
    },

    /** Only the player who picked up the Thulla can close the overlay for everyone. */
    dismissPickup: ({ G, playerID }) => {
      if (!G.lastPickup || G.lastPickup.dismissed) return INVALID_MOVE
      if (playerID !== G.lastPickup.receiver) return INVALID_MOVE
      G.lastPickup.dismissed = true
    },

    takeLeftHand: ({ G, playerID }) => {
      if (
        !G.started ||
        G.phase !== 'preTrick' ||
        playerID !== G.turnPlayer ||
        playerID !== G.leader ||
        G.active.length < 2 ||
        pickupPending(G)
      ) {
        return INVALID_MOVE
      }

      const victim = nextActive(G.active, playerID)
      const count = G.hands[victim].length
      G.hands[playerID].push(...G.hands[victim])
      G.hands[victim] = []
      removeEmptyPlayer(G, victim)
      addEvent(G, { type: 'took', taker: playerID, victim, count })
      syncCounts(G)
      const finished = finishIfNeeded(G)
      G.turnPlayer = finished ? G.active[0] : playerID
    },

    playCard,
  },

  turn: {
    minMoves: 1,
    maxMoves: 1,
    order: {
      first: () => 0,
      next: ({ G, ctx }) => {
        const index = ctx.playOrder.indexOf(G.turnPlayer)
        return index >= 0 ? index : 0
      },
    },
  },

  endIf: ({ G }) =>
    G.phase === 'finished'
      ? { bhabhi: G.bhabhi, gotAway: G.gotAway }
      : undefined,

  playerView: ({ G, playerID }) => {
    const visible = structuredClone(G)
    visible.hands = Object.fromEntries(
      Object.keys(G.hands).map((id) => [id, id === playerID ? G.hands[id] : []]),
    )
    visible.waste = []
    return visible
  },
}
