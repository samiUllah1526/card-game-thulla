import { INVALID_MOVE, Stage } from 'boardgame.io/core'
import type { Game } from 'boardgame.io'
import { config } from '../../config'
import {
  actionBlocked,
  addEvent,
  deal,
  executeTake,
  finishIfNeeded,
  forfeitPlayer,
  hasAceOfSpades,
  isLegalPlay,
  nextActive,
  removeCard,
  removeEmptyPlayer,
  resolveTrick,
  syncCounts,
  takePending,
  takeRejectPending,
} from './rules'
import { filterPlayerView, expectedPeekPassword } from './peek'
import { peekLog } from './peekLog'
import { orderedDeck, shuffleDeck, shuffleReport, type ShuffleRandom } from './shuffle'
import type { BhabhiState, DealResult, SetupData } from './types'

export interface CreateDealtOpts {
  numPlayers: number
  random: ShuffleRandom
  setupData?: SetupData
  /** Carry-over across Play again. */
  dealHistory?: DealResult[]
  peekers?: Record<string, boolean>
  /** Seats that forfeited earlier on this match. They are not dealt. */
  left?: string[]
  /** Host after a forfeit. Falls back to the first seat still at the table. */
  hostID?: string
  /** When true, skip waiting and start the new deal immediately. */
  autoStart?: boolean
  /** Deal only these seats. Other slots stay empty. */
  seats?: string[]
  seatCount?: number
  seated?: Record<string, boolean>
}

export function clampSeatCount(value: number | undefined): number {
  const rounded = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : config.game.minPlayers
  return Math.min(config.game.maxPlayers, Math.max(config.game.minPlayers, rounded))
}

export function markedSeats(G: BhabhiState): string[] {
  const limit = G.seatCount ?? config.game.maxPlayers
  return Object.entries(G.seated ?? {})
    .filter(([id, on]) => on && Number(id) < limit)
    .map(([id]) => id)
    .sort((a, b) => Number(a) - Number(b))
}

/** Lobby before anyone is dealt. Cards are shuffled when the host starts. */
export function createWaitingState(opts: { numPlayers: number; setupData?: SetupData }): BhabhiState {
  const seatCount = clampSeatCount(opts.setupData?.seatCount)
  const allSeats = Array.from({ length: opts.numPlayers }, (_, index) => String(index))
  const hands = Object.fromEntries(allSeats.map((id) => [id, [] as BhabhiState['hands'][string]]))
  const options = {
    algorithm: opts.setupData?.shuffleAlgorithm,
    scale: opts.setupData?.shuffleScale,
  }
  const deck = orderedDeck()
  return {
    hands,
    handCounts: Object.fromEntries(allSeats.map((id) => [id, 0])),
    waste: [],
    wasteCount: 0,
    trick: [],
    ledSuit: null,
    pickupCount: 0,
    trickCount: 0,
    active: [],
    gotAway: [],
    left: [],
    leader: '0',
    turnPlayer: '0',
    firstLeader: '0',
    firstTrick: true,
    started: false,
    hostID: '0',
    seatCount,
    seated: {},
    dealtSeats: [],
    phase: 'waiting',
    events: [{ id: 1, type: 'waiting' }],
    shuffleReport: shuffleReport(deck, deck, options),
    takeRequiresPermission:
      opts.setupData?.takeRequiresPermission ?? config.game.defaultTakeRequiresPermission,
    takeCount: 0,
    peekers: {},
    dealHistory: [],
  }
}

/** Shuffle, deal, and build a fresh table state (setup or rematch). */
export function createDealtState(opts: CreateDealtOpts): BhabhiState {
  const options = {
    algorithm: opts.setupData?.shuffleAlgorithm,
    scale: opts.setupData?.shuffleScale,
  }
  const original = orderedDeck()
  const shuffled = shuffleDeck(original, options, opts.random)
  const left = [...(opts.left ?? [])]
  const gone = new Set(left)
  const allSeats = Array.from({ length: opts.numPlayers }, (_, index) => String(index))
  const group = opts.seats ?? allSeats
  const seated = group.filter((id) => allSeats.includes(id) && !gone.has(id))
  const dealt = deal(shuffled, seated.length, seated)
  const hands = Object.fromEntries(allSeats.map((id) => [id, dealt[id] ?? []]))
  const firstLeader = seated.find((id) => hasAceOfSpades(hands[id])) ?? seated[0] ?? '0'
  const hostID = opts.hostID && seated.includes(opts.hostID) ? opts.hostID : (seated[0] ?? '0')
  const handCounts = Object.fromEntries(
    Object.entries(hands).map(([id, hand]) => [id, hand.length]),
  )
  const autoStart = !!opts.autoStart

  const state: BhabhiState = {
    hands,
    handCounts,
    waste: [],
    wasteCount: 0,
    trick: [],
    ledSuit: null,
    pickupCount: 0,
    trickCount: 0,
    active: seated,
    gotAway: [],
    left,
    leader: firstLeader,
    turnPlayer: autoStart ? firstLeader : hostID,
    firstLeader,
    firstTrick: true,
    started: autoStart,
    hostID,
    seatCount: opts.seatCount ?? opts.numPlayers,
    seated: opts.seated ?? Object.fromEntries(seated.map((id) => [id, true])),
    dealtSeats: group,
    phase: autoStart ? 'preTrick' : 'waiting',
    events: autoStart
      ? [{ id: 1, type: 'firstLead', player: firstLeader }]
      : [{ id: 1, type: 'waiting' }],
    shuffleReport: shuffleReport(original, shuffled, options),
    takeRequiresPermission:
      opts.setupData?.takeRequiresPermission ?? config.game.defaultTakeRequiresPermission,
    takeCount: 0,
    peekers: opts.peekers ? { ...opts.peekers } : {},
    dealHistory: opts.dealHistory ? [...opts.dealHistory] : [],
  }
  return state
}

function playCard(
  { G, playerID }: { G: BhabhiState; playerID: string },
  cardID: string,
) {
  if (!G.started || G.phase === 'finished' || playerID !== G.turnPlayer) return INVALID_MOVE
  if (G.phase !== 'preTrick' && G.phase !== 'follow') return INVALID_MOVE
  if (actionBlocked(G)) return INVALID_MOVE

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
    G.turnPlayer = G.hostID
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

function leaveSeat(
  { G, playerID, events }: { G: BhabhiState; playerID: string; events: { endTurn: () => void } },
) {
  if (!playerID || !G.started || !(playerID in G.hands)) return INVALID_MOVE
  if (G.left?.includes(playerID)) return INVALID_MOVE
  const { endTurn } = forfeitPlayer(G, playerID)
  if (endTurn) events.endTurn()
}

const leaveGame = {
  client: false as const,
  noLimit: true,
  ignoreStaleStateID: true,
  move: leaveSeat,
}

const markSeated = {
  client: false as const,
  noLimit: true,
  ignoreStaleStateID: true,
  move: ({ G, playerID }: { G: BhabhiState; playerID: string }) => {
    if (!playerID || G.started) return INVALID_MOVE
    const limit = G.seatCount ?? config.game.maxPlayers
    if (Number(playerID) >= limit) return INVALID_MOVE
    G.seated = { ...(G.seated ?? {}), [playerID]: true }
  },
}

function canStartTake(G: BhabhiState, playerID: string): boolean {
  return (
    G.started &&
    G.phase === 'preTrick' &&
    playerID === G.turnPlayer &&
    playerID === G.leader &&
    G.active.length >= 2 &&
    !actionBlocked(G)
  )
}

export const BhabhiThulla: Game<BhabhiState, Record<string, unknown>, SetupData> = {
  name: config.game.name,
  minPlayers: config.game.minPlayers,
  maxPlayers: config.game.maxPlayers,
  disableUndo: true,

  setup: ({ ctx }, setupData) =>
    createWaitingState({
      numPlayers: ctx.numPlayers,
      setupData,
    }),

  moves: {
    /** Records this authenticated seat. Other players reach it from the leave stage. */
    markSeated,

    /** Host opens one more seat while people are still arriving. */
    addSeat: ({ G, playerID }) => {
      if (G.started || playerID !== G.hostID) return INVALID_MOVE
      const count = G.seatCount ?? config.game.minPlayers
      if (count >= config.game.maxPlayers) return INVALID_MOVE
      G.seatCount = count + 1
    },

    /**
     * Host starts with whoever has sat. Server-only so the shuffle uses the
     * server random. Empty seats are left out of the deal.
     */
    startGame: {
      client: false,
      move: ({ G, ctx, playerID, random }) => {
        if (G.started || playerID !== G.hostID) return INVALID_MOVE
        const playing = markedSeats(G)
        if (playing.length < config.game.minPlayers) return INVALID_MOVE
        const next = createDealtState({
          numPlayers: ctx.numPlayers,
          seats: playing,
          random,
          setupData: {
            shuffleAlgorithm: G.shuffleReport.algorithm,
            shuffleScale: G.shuffleReport.scale,
            takeRequiresPermission: G.takeRequiresPermission,
          },
          dealHistory: G.dealHistory ?? [],
          peekers: G.peekers,
          hostID: G.hostID,
          autoStart: true,
          seatCount: G.seatCount,
          seated: G.seated,
        })
        Object.assign(G, next)
      },
    },

    /**
     * Host rematch after a finished deal. Redeals the same table and starts
     * immediately. On finish we hand the turn to the host so this move is legal.
     * Server-only so the new shuffle uses the server RNG.
     */
    playAgain: {
      client: false,
      move: ({ G, ctx, playerID, random }) => {
        if (G.phase !== 'finished' || playerID !== G.hostID) return INVALID_MOVE

        const left = G.left ?? []
        const group = G.dealtSeats?.length
          ? G.dealtSeats
          : Array.from({ length: ctx.numPlayers }, (_, index) => String(index))
        const stillIn = group.filter((id) => !left.includes(id))
        if (stillIn.length < 2) return INVALID_MOVE

        const next = createDealtState({
          numPlayers: ctx.numPlayers,
          seats: group,
          random,
          setupData: {
            shuffleAlgorithm: G.shuffleReport.algorithm,
            shuffleScale: G.shuffleReport.scale,
            takeRequiresPermission: G.takeRequiresPermission,
          },
          dealHistory: G.dealHistory ?? [],
          peekers: G.peekers,
          left,
          hostID: G.hostID,
          autoStart: true,
          seatCount: G.seatCount,
          seated: G.seated,
        })

        Object.assign(G, next)
        delete G.lastPickup
        delete G.lastTrick
        delete G.pendingTake
        delete G.lastTakeReject
        delete G.bhabhi
        delete G.winner
      },
    },

    /**
     * Password-gated peek unlock. Server-only; does not spend the turn.
     * boardgame.io only accepts moves from the active seat — the client queues until then.
     */
    unlockPeek: {
      client: false,
      noLimit: true,
      // Ignore stale optimistic state — unlock is idempotent and not turn-timed.
      ignoreStaleStateID: true,
      move: ({ G, playerID }, password: string) => {
        const expected = expectedPeekPassword()
        const got = typeof password === 'string' ? password.trim() : ''
        if (!expected) {
          peekLog('unlock rejected — PEEK_PASSWORD is empty/unset on the server', {
            playerID,
          })
          return INVALID_MOVE
        }
        if (!got) {
          peekLog('unlock rejected — empty password from client', { playerID })
          return INVALID_MOVE
        }
        if (got !== expected) {
          peekLog('unlock rejected — password mismatch', {
            playerID,
            gotLength: got.length,
            expectedLength: expected.length,
            hint: 'use the exact PEEK_PASSWORD value from .env (no VITE_ prefix)',
          })
          return INVALID_MOVE
        }
        if (!G.peekers) G.peekers = {}
        G.peekers[playerID] = true
        peekLog('unlock ok — peeker flag set; client should show another hand', {
          playerID,
        })
      },
    },

    /** Only the player who picked up the Thulla can close the overlay for everyone. */
    dismissPickup: ({ G, playerID }) => {
      if (!G.lastPickup || G.lastPickup.dismissed) return INVALID_MOVE
      if (playerID !== G.lastPickup.receiver) return INVALID_MOVE
      G.lastPickup.dismissed = true
    },

    takeLeftHand: ({ G, playerID }) => {
      if (!canStartTake(G, playerID)) return INVALID_MOVE

      const victim = nextActive(G.active, playerID)

      if (G.takeRequiresPermission) {
        G.takeCount += 1
        G.pendingTake = { id: G.takeCount, from: playerID, to: victim }
        // Hand the turn to the victim so they can Accept/Reject (maxMoves: 1).
        G.turnPlayer = victim
        addEvent(G, { type: 'takeAsked', from: playerID, to: victim })
        return
      }

      executeTake(G, playerID, victim)
    },

    respondTake: ({ G, playerID }, accept: boolean) => {
      if (!takePending(G) || !G.pendingTake) return INVALID_MOVE
      if (playerID !== G.pendingTake.to) return INVALID_MOVE

      const { from, to } = G.pendingTake
      G.pendingTake = undefined

      if (accept) {
        executeTake(G, from, to, 'accepted')
        return
      }

      G.takeCount += 1
      G.lastTakeReject = { id: G.takeCount, from, to, dismissed: false }
      // Roasted requester must dismiss before play resumes.
      G.turnPlayer = from
      addEvent(G, { type: 'takeRejected', from, to })
    },

    dismissTakeReject: ({ G, playerID }) => {
      if (!takeRejectPending(G) || !G.lastTakeReject) return INVALID_MOVE
      if (playerID !== G.lastTakeReject.from) return INVALID_MOVE
      G.lastTakeReject.dismissed = true
    },

    playCard,

    /**
     * Any seated player can forfeit after the deal starts. Cards in hand are
     * discarded. Does not spend the turn unless the leaver was the one to move.
     * Non-current players reach the same move through the `leave` stage.
     */
    leaveGame,
  },

  turn: {
    minMoves: 1,
    maxMoves: 1,
    activePlayers: { currentPlayer: Stage.NULL, others: 'leave' },
    stages: {
      leave: {
        moves: { leaveGame, markSeated },
      },
    },
    order: {
      first: () => 0,
      next: ({ G, ctx }) => {
        const index = ctx.playOrder.indexOf(G.turnPlayer)
        return index >= 0 ? index : 0
      },
    },
  },

  // No endIf — finished stays as G.phase so the host can call playAgain.
  playerView: ({ G, playerID }) => filterPlayerView(G, playerID),
}
