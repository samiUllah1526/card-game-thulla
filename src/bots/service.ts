import { config } from '../config'
import type { BotDifficulty } from '../games/bhabhi-thulla/types'
import type { BhabhiState } from '../games/bhabhi-thulla/types'
import { AppError } from '../multiplayer/appStore'
import { isBotDifficulty } from './difficulty'
import { botDisplayName } from './plan'
import { BotRunner } from './runner'
import { BotSeatStore } from './store'
import type { BotAction, BotClock, BotTransport } from './types'
import { realClock } from './types'

export interface BotLobby {
  hostID: string
  started: boolean
  closed: boolean
  seatCount: number
}

/** What the seat service needs from the match store. No credentials leave this process. */
export interface BotTableDirectory {
  lobby(matchID: string): BotLobby | null
  occupant(matchID: string, playerID: string): { name?: string; credentials?: string } | null
  takenNames(matchID: string): string[]
  releaseMember(matchID: string, playerID: string): void
  bots(matchID: string): Record<string, BotDifficulty> | undefined
  seated(matchID: string): Record<string, boolean> | undefined
}

export interface SeatResult {
  playerID: string
  difficulty: BotDifficulty
  name: string
}

export interface BotServiceOptions {
  seats: BotSeatStore
  tables: BotTableDirectory
  transport: BotTransport
  listActions: (view: BhabhiState, playerID: string) => BotAction[]
  clock?: BotClock
  rng?: () => number
  /** 0 skips waiting for the badge to land. Production uses config.bots.ackMs. */
  ackMs?: number
  pollMs?: number
  now?: () => number
}

/**
 * Host-facing seat assignment. Join, leave, and the socket client stay behind
 * the transport so tests can run without a network.
 */
export class BotService {
  private readonly runners = new Map<string, BotRunner>()
  private readonly clock: BotClock
  private readonly ackMs: number
  private readonly pollMs: number
  private readonly now: () => number

  constructor(private readonly options: BotServiceOptions) {
    this.clock = options.clock ?? realClock
    this.ackMs = options.ackMs ?? config.bots.ackMs
    this.pollMs = options.pollMs ?? config.bots.pollMs
    this.now = options.now ?? Date.now
  }

  async fill(input: {
    matchID: string
    actorID: string
    seats: string[]
    difficulty: string
  }): Promise<{ seats: SeatResult[] }> {
    const difficulty = this.open(input.matchID, input.actorID, input.difficulty)
    const gate = this.mustLobby(input.matchID)
    const unique = [...new Set(input.seats)]
    for (const seat of unique) cleanSeat(seat, gate)
    const seated: SeatResult[] = []
    for (const seat of unique) {
      seated.push(await this.place(input.matchID, seat, difficulty))
    }
    return { seats: seated }
  }

  async seat(input: {
    matchID: string
    actorID: string
    seat: string
    difficulty: string
  }): Promise<SeatResult> {
    const difficulty = this.open(input.matchID, input.actorID, input.difficulty)
    const gate = this.mustLobby(input.matchID)
    cleanSeat(input.seat, gate)
    return this.place(input.matchID, input.seat, difficulty)
  }

  async clear(input: { matchID: string; actorID: string; seat: string }): Promise<void> {
    this.open(input.matchID, input.actorID)
    const gate = this.mustLobby(input.matchID)
    cleanSeat(input.seat, gate)
    const row = this.options.seats.get(input.matchID, input.seat)
    if (!row) throw new AppError('That seat is not a bot.', 404)
    const key = this.key(input.matchID, input.seat)
    if (!this.runners.has(key)) this.attach(input.matchID, input.seat, row.credentials, row.difficulty)
    const runner = this.runners.get(key)
    runner?.pause()
    runner?.clearBadge()
    const cleared = await this.waitForBadge(input.matchID, input.seat, null)
    if (!cleared) {
      runner?.resume()
      throw new AppError('The bot is still sitting. Try again.', 409)
    }
    runner?.stop()
    this.runners.delete(this.key(input.matchID, input.seat))
    try {
      await this.options.transport.leave(input.matchID, input.seat, row.credentials)
    } catch {
      // The lobby seat may already be empty. The badge and the row still go.
    }
    this.options.seats.remove(input.matchID, input.seat)
    this.options.tables.releaseMember(input.matchID, input.seat)
  }

  /** Reconnect bots after a process restart. Missing tables are dropped. */
  async restore(): Promise<void> {
    for (const row of this.options.seats.all()) {
      const gate = this.options.tables.lobby(row.matchID)
      const occupant = this.options.tables.occupant(row.matchID, row.playerID)
      if (!gate || gate.closed || occupant?.credentials !== row.credentials) {
        this.options.seats.remove(row.matchID, row.playerID)
        continue
      }
      this.attach(row.matchID, row.playerID, row.credentials, row.difficulty)
    }
  }

  private open(matchID: string, actorID: string, difficulty?: string): BotDifficulty {
    const gate = this.mustLobby(matchID)
    if (gate.closed) throw new AppError('This table has ended.', 410)
    if (gate.started) throw new AppError('Bots can only sit before the deal starts.', 409)
    if (actorID !== gate.hostID) throw new AppError('Only the host can seat a bot.', 403)
    if (difficulty === undefined) return 'rookie'
    if (!isBotDifficulty(difficulty)) throw new AppError('Pick a bot difficulty.', 400)
    return difficulty
  }

  private mustLobby(matchID: string): BotLobby {
    const gate = this.options.tables.lobby(matchID)
    if (!gate) throw new AppError('Game not found.', 404)
    return gate
  }

  private async place(matchID: string, seat: string, difficulty: BotDifficulty): Promise<SeatResult> {
    const existing = this.options.seats.get(matchID, seat)
    const person = this.options.tables.occupant(matchID, seat)
    if (existing && person?.credentials === existing.credentials) {
      this.options.seats.updateDifficulty(matchID, seat, difficulty)
      const runner = this.runners.get(this.key(matchID, seat))
      if (runner) runner.setDifficulty(difficulty)
      else this.attach(matchID, seat, existing.credentials, difficulty)
      await this.waitForBadge(matchID, seat, difficulty)
      return {
        playerID: seat,
        difficulty,
        name: person?.name ?? botDisplayName(seat, this.options.tables.takenNames(matchID)),
      }
    }

    if (person?.name) {
      if (!person.credentials) throw new AppError('That seat cannot be replaced.', 409)
      await this.options.transport.leave(matchID, seat, person.credentials)
      this.options.tables.releaseMember(matchID, seat)
    }
    if (existing) {
      this.runners.get(this.key(matchID, seat))?.stop()
      this.runners.delete(this.key(matchID, seat))
      try {
        await this.options.transport.leave(matchID, seat, existing.credentials)
      } catch {
        // Stale bot credentials. The new join still takes the seat.
      }
      this.options.seats.remove(matchID, seat)
    }

    const name = botDisplayName(seat, this.options.tables.takenNames(matchID))
    const joined = await this.options.transport.join(matchID, seat, name)
    this.options.seats.upsert(matchID, seat, difficulty, joined.credentials)
    this.attach(matchID, seat, joined.credentials, difficulty)
    const sitting = await this.waitForSit(matchID, seat)
    if (!sitting) throw new AppError('The bot joined, but it has not sat down yet.', 409)
    return { playerID: seat, difficulty, name }
  }

  private attach(
    matchID: string,
    playerID: string,
    credentials: string,
    difficulty: BotDifficulty,
  ): void {
    const key = this.key(matchID, playerID)
    if (this.runners.has(key)) return
    const connection = this.options.transport.connect({ matchID, playerID, credentials })
    const runner = new BotRunner({
      playerID,
      difficulty,
      connection,
      listActions: this.options.listActions,
      clock: this.clock,
      rng: this.options.rng,
    })
    this.runners.set(key, runner)
    runner.start()
  }

  private async waitForSit(matchID: string, playerID: string): Promise<boolean> {
    if (this.ackMs <= 0) return true
    const deadline = this.now() + this.ackMs
    while (this.now() <= deadline) {
      if (this.options.tables.seated(matchID)?.[playerID]) return true
      await this.clock.wait(this.pollMs)
    }
    return false
  }

  private async waitForBadge(
    matchID: string,
    playerID: string,
    difficulty: BotDifficulty | null,
  ): Promise<boolean> {
    if (this.ackMs <= 0) return true
    const deadline = this.now() + this.ackMs
    while (this.now() <= deadline) {
      const current = this.options.tables.bots(matchID)?.[playerID] ?? null
      if (current === difficulty) return true
      await this.clock.wait(this.pollMs)
    }
    return false
  }

  private key(matchID: string, playerID: string): string {
    return `${matchID}:${playerID}`
  }
}

function cleanSeat(seat: string, gate: BotLobby): void {
  if (!/^\d+$/.test(seat) || Number(seat) >= gate.seatCount) {
    throw new AppError('That seat is not open.', 400)
  }
  if (seat === gate.hostID) throw new AppError('The host seat stays with you.', 400)
}
