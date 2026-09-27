import { config } from '../config'
import type { BhabhiState } from '../games/bhabhi-thulla/types'
import { thinkRange, type BotDifficulty } from './difficulty'
import { policyFor } from './policies'
import type { BotAction, BotClock, BotConnection } from './types'

export function botPauseMs(
  view: BhabhiState,
  playerID: string,
  difficulty: BotDifficulty,
  rng: () => number,
): number {
  const [min, max] = thinkRange(difficulty)
  const think = min + rng() * (max - min)
  let extra = 0
  if (view.lastPickup && !view.lastPickup.dismissed && view.lastPickup.receiver === playerID) {
    const count = view.lastPickup.cards.length
    extra =
      config.timing.pickupFlyMs + config.timing.pickupFlyStaggerMs * Math.max(0, count - 1)
  } else if (
    view.trick.length === 0 &&
    view.lastTrick &&
    view.phase === 'preTrick' &&
    view.turnPlayer === playerID
  ) {
    extra = config.timing.trickDisplayMinMs
  }
  return Math.round(think + extra)
}

export interface BotRunnerOptions {
  playerID: string
  difficulty: BotDifficulty
  connection: BotConnection
  listActions: (view: BhabhiState, playerID: string) => BotAction[]
  clock: BotClock
  rng?: () => number
}

/**
 * Plays one seat. It knows action names and timings, not which card is legal.
 * The adapter and the policy make that choice.
 */
export class BotRunner {
  private difficulty: BotDifficulty
  private latest: BhabhiState | null = null
  private waiting = false
  private stopped = false
  private paused = false
  private syncing = false
  private readonly rng: () => number

  constructor(private readonly options: BotRunnerOptions) {
    this.difficulty = options.difficulty
    this.rng = options.rng ?? Math.random
  }

  start(): void {
    this.options.connection.subscribe((snapshot) => {
      this.latest = snapshot?.G ?? null
      if (this.syncing || this.stopped || this.paused || !this.latest) return
      this.syncing = true
      try {
        this.syncLobby(this.latest)
        this.schedule(this.latest)
      } finally {
        this.syncing = false
      }
    })
    this.options.connection.start()
  }

  setDifficulty(next: BotDifficulty): void {
    this.difficulty = next
    if (this.latest && !this.latest.started && this.latest.bots?.[this.options.playerID] !== next) {
      this.options.connection.noteBot(next)
    }
  }

  /** Stop rewriting the badge and playing cards while a seat change is in flight. */
  pause(): void {
    this.paused = true
  }

  resume(): void {
    this.paused = false
    if (this.latest && !this.stopped) {
      this.syncLobby(this.latest)
      this.schedule(this.latest)
    }
  }

  stop(): void {
    this.stopped = true
    this.paused = true
  }

  clearBadge(): void {
    this.options.connection.noteBot(null)
  }

  private syncLobby(view: BhabhiState): void {
    if (view.started) return
    const seat = this.options.playerID
    if (!view.seated?.[seat]) this.options.connection.markSeated()
    if (view.bots?.[seat] !== this.difficulty) this.options.connection.noteBot(this.difficulty)
  }

  private schedule(view: BhabhiState): void {
    if (this.waiting || !view.started || view.phase === 'finished') return
    const actions = this.options.listActions(view, this.options.playerID)
    if (actions.length === 0) return
    this.waiting = true
    const pause = botPauseMs(view, this.options.playerID, this.difficulty, this.rng)
    void this.options.clock.wait(pause).then(() => {
      this.waiting = false
      if (this.stopped || this.paused || !this.latest) return
      const fresh = this.options.listActions(this.latest, this.options.playerID)
      if (fresh.length === 0) return
      const action = policyFor(this.difficulty).choose(
        this.latest,
        this.options.playerID,
        fresh,
        this.rng,
      )
      if (!fresh.some((candidate) => sameAction(candidate, action))) return
      this.options.connection.dispatch(action)
    })
  }
}

function sameAction(left: BotAction, right: BotAction): boolean {
  if (left.type !== right.type) return false
  if (left.type === 'playCard' && right.type === 'playCard') return left.cardID === right.cardID
  if (left.type === 'respondTake' && right.type === 'respondTake') return left.accept === right.accept
  return true
}
