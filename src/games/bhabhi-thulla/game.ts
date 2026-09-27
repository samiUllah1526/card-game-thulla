import { INVALID_MOVE } from 'boardgame.io/core'
import type { Game } from 'boardgame.io'
import { config } from '../../config'
import {
  actionBlocked,
  addEvent,
  deal,
  executeTake,
  finishIfNeeded,
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
  /** When true, skip waiting and start the new deal immediately. */
  autoStart?: boolean
}

/** Shuffle, deal, and build a fresh table state (setup or rematch). */
export function createDealtState(opts: CreateDealtOpts): BhabhiState {
  const options = {
    algorithm: opts.setupData?.shuffleAlgorithm,
    scale: opts.setupData?.shuffleScale,
  }
  const original = orderedDeck()
  const shuffled = shuffleDeck(original, options, opts.random)
  const hands = deal(shuffled, opts.numPlayers)
  const firstLeader =
    Object.entries(hands).find(([, hand]) => hasAceOfSpades(hand))?.[0] ?? '0'
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
    active: Array.from({ length: opts.numPlayers }, (_, index) => String(index)),
    gotAway: [],
    leader: firstLeader,
    turnPlayer: autoStart ? firstLeader : '0',
    firstLeader,
    firstTrick: true,
    started: autoStart,
    hostID: '0',
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

  setup: ({ ctx, random }, setupData) =>
    createDealtState({
      numPlayers: ctx.numPlayers,
      random,
      setupData,
    }),

  moves: {
    startGame: ({ G, playerID }) => {
      if (G.started || playerID !== G.hostID) return INVALID_MOVE
      G.started = true
      G.phase = 'preTrick'
      G.turnPlayer = G.firstLeader
      addEvent(G, { type: 'firstLead', player: G.firstLeader })
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

        const next = createDealtState({
          numPlayers: ctx.numPlayers,
          random,
          setupData: {
            shuffleAlgorithm: G.shuffleReport.algorithm,
            shuffleScale: G.shuffleReport.scale,
            takeRequiresPermission: G.takeRequiresPermission,
          },
          dealHistory: G.dealHistory ?? [],
          peekers: G.peekers,
          autoStart: true,
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

  // No endIf — finished stays as G.phase so the host can call playAgain.
  playerView: ({ G, playerID }) => filterPlayerView(G, playerID),
}
