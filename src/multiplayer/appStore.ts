import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { Server } from 'boardgame.io'
import { config } from '../config'
import { utcNowMs } from '../lib/time'
import type { BhabhiState, BotDifficulty, DealResult, LobbySeat } from '../games/bhabhi-thulla/types'
import { filterPlayerView } from '../games/bhabhi-thulla/peek'
import type { TableChatMessage } from './chat'
import { tallyLeaderboard, type MatchLeaderboard } from './leaderboard'
import type { PublicUser } from './authTypes'
import { publishWatch } from './watchHub'
import type { WatchSnapshot } from './watchTypes'

export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export class AppStore {
  constructor(private readonly db: Database.Database) {}

  signup(email: string, password: string, displayName: string): { user: PublicUser; token: string } {
    const cleanEmail = normalizeEmail(email)
    const name = normalizeDisplayName(displayName)
    const hash = hashPassword(password)
    const now = utcNowMs()
    try {
      const result = this.db
        .prepare(
          `INSERT INTO users (email, password_hash, display_name, created_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(cleanEmail, hash, name, now)
      const user: PublicUser = {
        id: Number(result.lastInsertRowid),
        email: cleanEmail,
        displayName: name,
      }
      return { user, token: this.createSession(user.id) }
    } catch (reason) {
      if (isUniqueError(reason)) throw new AppError('That email is already registered.', 409)
      throw reason
    }
  }

  login(email: string, password: string): { user: PublicUser; token: string } {
    const cleanEmail = normalizeEmail(email)
    const row = this.db
      .prepare(`SELECT id, email, password_hash, display_name FROM users WHERE email = ?`)
      .get(cleanEmail) as
      | { id: number; email: string; password_hash: string; display_name: string }
      | undefined
    if (!row || !verifyPassword(password, row.password_hash)) {
      throw new AppError('Email or password is wrong.', 401)
    }
    return {
      user: { id: row.id, email: row.email, displayName: row.display_name },
      token: this.createSession(row.id),
    }
  }

  loginWithGoogle(profile: { sub: string; email: string; name: string }): {
    user: PublicUser
    token: string
  } {
    const sub = profile.sub.trim()
    if (!sub) throw new AppError('Google account is missing an id.', 400)
    const cleanEmail = normalizeEmail(profile.email)
    const bySub = this.userByGoogleSub(sub)
    if (bySub) return { user: bySub, token: this.createSession(bySub.id) }

    const byEmail = this.userByEmail(cleanEmail)
    if (byEmail) {
      if (byEmail.googleSub && byEmail.googleSub !== sub) {
        throw new AppError('That email is already linked to a different Google account.', 409)
      }
      if (!byEmail.googleSub) {
        this.db.prepare(`UPDATE users SET google_sub = ? WHERE id = ?`).run(sub, byEmail.id)
      }
      const user: PublicUser = {
        id: byEmail.id,
        email: byEmail.email,
        displayName: byEmail.displayName,
      }
      return { user, token: this.createSession(user.id) }
    }

    const name = googleDisplayName(profile.name, cleanEmail)
    const hash = hashPassword(randomBytes(32).toString('hex'))
    const now = utcNowMs()
    try {
      const result = this.db
        .prepare(
          `INSERT INTO users (email, password_hash, display_name, created_at, google_sub)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(cleanEmail, hash, name, now, sub)
      const user: PublicUser = {
        id: Number(result.lastInsertRowid),
        email: cleanEmail,
        displayName: name,
      }
      return { user, token: this.createSession(user.id) }
    } catch (reason) {
      if (isUniqueError(reason)) throw new AppError('That email is already registered.', 409)
      throw reason
    }
  }

  userForToken(token: string | undefined): PublicUser | null {
    if (!token) return null
    const row = this.db
      .prepare(
        `SELECT users.id, users.email, users.display_name, sessions.expires_at
         FROM sessions JOIN users ON users.id = sessions.user_id
         WHERE sessions.token = ?`,
      )
      .get(token) as
      | { id: number; email: string; display_name: string; expires_at: number }
      | undefined
    if (!row) return null
    if (row.expires_at < utcNowMs()) {
      this.deleteSession(token)
      return null
    }
    return { id: row.id, email: row.email, displayName: row.display_name }
  }

  deleteSession(token: string): void {
    this.db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token)
  }

  requireSeat(matchID: string, playerID: string, credentials: string): void {
    const metadata = this.matchMetadata(matchID)
    if (!metadata) throw new AppError('Game not found.', 404)
    const seat = metadata.players[Number(playerID)]
    if (!seat || seat.credentials !== credentials) {
      throw new AppError('You are not seated at this table.', 403)
    }
  }

  /** Waiting-room facts the bot seat service uses to authorize a host. */
  lobby(matchID: string): { hostID: string; started: boolean; closed: boolean; seatCount: number } | null {
    const game = this.matchGame(matchID)
    if (!game) return null
    return {
      hostID: String(game.hostID ?? '0'),
      started: !!game.started,
      closed: this.isClosed(matchID),
      seatCount: game.seatCount ?? config.game.maxPlayers,
    }
  }

  occupant(matchID: string, playerID: string): { name?: string; credentials?: string } | null {
    const metadata = this.matchMetadata(matchID)
    const seat = metadata?.players?.[Number(playerID)]
    if (!seat) return null
    return { name: seat.name, credentials: seat.credentials }
  }

  takenNames(matchID: string): string[] {
    return this.seatList(matchID)
      .map((seat) => seat.name?.trim() ?? '')
      .filter((name) => name.length > 0)
  }

  releaseMember(matchID: string, playerID: string): void {
    this.db
      .prepare(`DELETE FROM seat_members WHERE match_id = ? AND player_id = ?`)
      .run(matchID, playerID)
  }

  seated(matchID: string): Record<string, boolean> | undefined {
    const row = this.db.prepare(`SELECT state FROM matches WHERE id = ?`).get(matchID) as
      | { state: string | null }
      | undefined
    if (!row?.state) return undefined
    try {
      const state = JSON.parse(row.state) as { G?: { seated?: Record<string, boolean> } }
      return state.G?.seated
    } catch {
      return undefined
    }
  }

  bots(matchID: string): Record<string, BotDifficulty> | undefined {
    const row = this.db.prepare(`SELECT state FROM matches WHERE id = ?`).get(matchID) as
      | { state: string | null }
      | undefined
    if (!row?.state) return undefined
    try {
      const state = JSON.parse(row.state) as { G?: { bots?: Record<string, BotDifficulty> } }
      return state.G?.bots
    } catch {
      return undefined
    }
  }

  appendChat(input: {
    id?: string
    matchID: string
    senderSeat: string
    userID?: number | null
    text: string
    at?: number
  }): TableChatMessage {
    if (this.isClosed(input.matchID)) throw new AppError('This table has ended.', 410)
    if (this.matchGame(input.matchID)?.phase === 'finished') {
      throw new AppError('Chat is closed for this deal.', 403)
    }
    const id = input.id?.trim() || randomBytes(8).toString('base64url')
    const joinedAt = this.joinedAt(input.matchID, input.senderSeat)
    const requested = input.at && Number.isFinite(input.at) ? input.at : utcNowMs()
    const at = Math.max(requested, joinedAt)
    this.db
      .prepare(
        `INSERT INTO chat_messages (id, match_id, sender_seat, user_id, text, at)
         VALUES (@id, @match_id, @sender_seat, @user_id, @text, @at)
         ON CONFLICT(id) DO NOTHING`,
      )
      .run({
        id,
        match_id: input.matchID,
        sender_seat: input.senderSeat,
        user_id: input.userID ?? null,
        text: input.text,
        at,
      })
    return { id, sender: input.senderSeat, text: input.text, at }
  }

  listChat(matchID: string, cap = config.chat.historyCap): TableChatMessage[] {
    return this.chatRows(matchID, 0, cap)
  }

  /**
   * Messages this seat is allowed to see. Closed tables throw.
   * A finished deal returns nothing until Play again opens a new window.
   */
  chatView(matchID: string, playerID: string): {
    messages: TableChatMessage[]
    visibleAfter: number
    open: boolean
  } {
    if (this.isClosed(matchID)) throw new AppError('This table has ended.', 410)
    const game = this.matchGame(matchID)
    const visibleAfter = Math.max(this.chatAfter(matchID), this.joinedAt(matchID, playerID))
    if (game?.phase === 'finished') {
      return { messages: [], visibleAfter, open: false }
    }
    return {
      messages: this.chatRows(matchID, visibleAfter),
      visibleAfter,
      open: true,
    }
  }

  softDeleteChat(matchID: string, messageID: string, senderSeat: string): void {
    if (this.isClosed(matchID)) throw new AppError('This table has ended.', 410)
    if (this.matchGame(matchID)?.phase === 'finished') {
      throw new AppError('Chat is closed for this deal.', 403)
    }
    const row = this.db
      .prepare(
        `SELECT sender_seat, deleted_at FROM chat_messages WHERE id = ? AND match_id = ?`,
      )
      .get(messageID, matchID) as { sender_seat: string; deleted_at: number | null } | undefined
    if (!row) throw new AppError('Message not found.', 404)
    if (row.sender_seat !== senderSeat) throw new AppError('You can only delete your own message.', 403)
    if (row.deleted_at != null) return
    this.db
      .prepare(`UPDATE chat_messages SET deleted_at = ? WHERE id = ? AND match_id = ?`)
      .run(utcNowMs(), messageID, matchID)
  }

  chatRow(messageID: string): { id: string; text: string; deletedAt: number | null } | null {
    const row = this.db
      .prepare(`SELECT id, text, deleted_at FROM chat_messages WHERE id = ?`)
      .get(messageID) as { id: string; text: string; deleted_at: number | null } | undefined
    if (!row) return null
    return { id: row.id, text: row.text, deletedAt: row.deleted_at }
  }

  upsertDealResults(matchID: string, history: DealResult[] | undefined): void {
    if (!Array.isArray(history) || history.length === 0) return
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO deal_results (match_id, deal, bhabhi_seat, got_away, at)
       VALUES (@match_id, @deal, @bhabhi_seat, @got_away, @at)`,
    )
    const write = this.db.transaction((deals: DealResult[]) => {
      for (const deal of deals) {
        if (typeof deal.deal !== 'number' || typeof deal.bhabhi !== 'string') continue
        insert.run({
          match_id: matchID,
          deal: deal.deal,
          bhabhi_seat: deal.bhabhi,
          got_away: JSON.stringify(deal.gotAway ?? []),
          at: typeof deal.at === 'number' ? deal.at : utcNowMs(),
        })
      }
    })
    write(history)
  }

  getLeaderboard(matchID: string): MatchLeaderboard {
    if (this.isClosed(matchID)) throw new AppError('This table has ended.', 410)
    const rows = this.db
      .prepare(
        `SELECT deal, bhabhi_seat, got_away, at FROM deal_results
         WHERE match_id = ? ORDER BY deal ASC`,
      )
      .all(matchID) as Array<{ deal: number; bhabhi_seat: string; got_away: string; at: number }>
    const deals: DealResult[] = rows.map((row) => ({
      deal: row.deal,
      bhabhi: row.bhabhi_seat,
      gotAway: parseGotAway(row.got_away),
      at: row.at,
    }))
    return tallyLeaderboard(deals, this.seatList(matchID))
  }

  wipeMatchExtras(matchID: string): void {
    this.db.prepare(`DELETE FROM chat_messages WHERE match_id = ?`).run(matchID)
    this.db.prepare(`DELETE FROM deal_results WHERE match_id = ?`).run(matchID)
    this.db.prepare(`DELETE FROM seat_members WHERE match_id = ?`).run(matchID)
    this.db.prepare(`DELETE FROM match_gates WHERE match_id = ?`).run(matchID)
  }

  /**
   * What a spectator may see. No seat is created, and the payload has no
   * credentials, chat, or move log.
   */
  watchSnapshot(matchID: string): WatchSnapshot {
    if (this.isClosed(matchID)) throw new AppError('This table has ended.', 410)
    const record = this.matchRecord(matchID)
    if (!record?.G) throw new AppError('That table was not found.', 404)
    let G: BhabhiState
    try {
      G = filterPlayerView(record.G, null)
    } catch {
      throw new AppError('That table was not found.', 404)
    }
    return {
      closed: false,
      seats: this.seatList(matchID),
      G,
      ctx: { currentPlayer: record.ctx?.currentPlayer ?? '0' },
    }
  }

  matchGate(matchID: string): { closed: boolean; started: boolean; seatCount: number } {
    const game = this.matchGame(matchID)
    return {
      closed: this.isClosed(matchID),
      started: !!game?.started,
      seatCount: game?.seatCount ?? config.game.maxPlayers,
    }
  }

  /** Why a new player cannot take a seat, or null while that seat is open. */
  joinBlock(matchID: string, playerID?: number): 'closed' | 'started' | 'unopened' | null {
    if (this.isClosed(matchID)) return 'closed'
    const game = this.matchGame(matchID)
    if (game?.started) return 'started'
    const seatCount = game?.seatCount ?? config.game.maxPlayers
    if (playerID != null && playerID >= seatCount) return 'unopened'
    return null
  }

  isClosed(matchID: string): boolean {
    const row = this.db
      .prepare(`SELECT closed_at FROM match_gates WHERE match_id = ?`)
      .get(matchID) as { closed_at: number | null } | undefined
    return row?.closed_at != null
  }

  /** Remember when this seat sat, and the account if they are signed in. */
  noteSeat(matchID: string, playerID: string, userID?: number | null, joinedAt = utcNowMs()): void {
    this.db
      .prepare(
        `INSERT INTO seat_members (match_id, player_id, user_id, joined_at)
         VALUES (@match_id, @player_id, @user_id, @joined_at)
         ON CONFLICT(match_id, player_id) DO UPDATE SET
           user_id = COALESCE(seat_members.user_id, excluded.user_id)`,
      )
      .run({
        match_id: matchID,
        player_id: playerID,
        user_id: userID ?? null,
        joined_at: joinedAt,
      })
  }

  /** Signed-in player returns to the seat stored for their account. */
  reclaimSeat(matchID: string, userID: number): { playerID: string; credentials: string; playerName: string } {
    if (this.isClosed(matchID)) throw new AppError('This table has ended.', 410)
    const member = this.db
      .prepare(`SELECT player_id FROM seat_members WHERE match_id = ? AND user_id = ?`)
      .get(matchID, userID) as { player_id: string } | undefined
    if (!member) throw new AppError('You are not seated at this table.', 404)
    const metadata = this.matchMetadata(matchID)
    const seat = metadata?.players?.[Number(member.player_id)]
    if (!seat?.credentials) throw new AppError('You are not seated at this table.', 404)
    return {
      playerID: String(member.player_id),
      credentials: seat.credentials,
      playerName: seat.name ?? '',
    }
  }

  /** Host closes the link for everyone. Only from the result screen. */
  closeMatch(matchID: string, playerID: string): void {
    if (this.isClosed(matchID)) return
    const game = this.matchGame(matchID)
    if (!game || game.phase !== 'finished') throw new AppError('The deal is still going.', 400)
    if (String(game.hostID ?? '') !== playerID) throw new AppError('Only the host can end the table.', 403)
    this.markClosed(matchID)
  }

  /**
   * A player left the result screen. When everyone still at the table has left
   * without Play again, the link closes.
   */
  departResult(matchID: string, playerID: string): { closed: boolean } {
    if (this.isClosed(matchID)) return { closed: true }
    const game = this.matchGame(matchID)
    if (!game || game.phase !== 'finished') return { closed: false }
    const gate = this.ensureGate(matchID)
    const departed = new Set(parseStringList(gate.departed))
    departed.add(playerID)
    this.db
      .prepare(`UPDATE match_gates SET departed = ? WHERE match_id = ?`)
      .run(JSON.stringify([...departed]), matchID)
    const still = this.remainingSeats(matchID, game.left ?? [])
    if (still.length === 0 || still.every((id) => departed.has(id))) this.markClosed(matchID)
    return { closed: this.isClosed(matchID) }
  }

  /** Play again hides every message from the deal that just finished. */
  openNextDealChat(matchID: string, at = utcNowMs()): void {
    if (this.isClosed(matchID)) return
    this.ensureGate(matchID)
    this.db
      .prepare(`UPDATE match_gates SET chat_after = ?, departed = '[]' WHERE match_id = ?`)
      .run(at, matchID)
  }

  /** A finished deal with nobody left to leave closes on its own. */
  closeIfAbandoned(matchID: string): void {
    if (this.isClosed(matchID)) return
    const game = this.matchGame(matchID)
    if (!game || game.phase !== 'finished') return
    if (this.remainingSeats(matchID, game.left ?? []).length === 0) this.markClosed(matchID)
  }

  matchPhase(matchID: string): string | null {
    return this.matchGame(matchID)?.phase ?? null
  }

  private chatRows(
    matchID: string,
    visibleAfter: number,
    cap = config.chat.historyCap,
  ): TableChatMessage[] {
    const rows = this.db
      .prepare(
        `SELECT id, sender_seat, text, at FROM chat_messages
         WHERE match_id = ? AND deleted_at IS NULL AND at >= ?
         ORDER BY at DESC, id DESC
         LIMIT ?`,
      )
      .all(matchID, visibleAfter, cap) as Array<{
      id: string
      sender_seat: string
      text: string
      at: number
    }>
    return rows
      .reverse()
      .map((row) => ({ id: row.id, sender: row.sender_seat, text: row.text, at: row.at }))
  }

  private joinedAt(matchID: string, playerID: string): number {
    const row = this.db
      .prepare(`SELECT joined_at FROM seat_members WHERE match_id = ? AND player_id = ?`)
      .get(matchID, playerID) as { joined_at: number } | undefined
    return row?.joined_at ?? 0
  }

  private chatAfter(matchID: string): number {
    const row = this.db
      .prepare(`SELECT chat_after FROM match_gates WHERE match_id = ?`)
      .get(matchID) as { chat_after: number } | undefined
    return row?.chat_after ?? 0
  }

  private ensureGate(matchID: string): { departed: string } {
    this.db.prepare(`INSERT OR IGNORE INTO match_gates (match_id) VALUES (?)`).run(matchID)
    return this.db
      .prepare(`SELECT departed FROM match_gates WHERE match_id = ?`)
      .get(matchID) as { departed: string }
  }

  private markClosed(matchID: string): void {
    this.ensureGate(matchID)
    this.db
      .prepare(`UPDATE match_gates SET closed_at = COALESCE(closed_at, ?) WHERE match_id = ?`)
      .run(utcNowMs(), matchID)
    publishWatch(matchID, { closed: true })
  }

  private matchRecord(matchID: string): { G?: BhabhiState; ctx?: { currentPlayer?: string } } | null {
    const row = this.db.prepare(`SELECT state FROM matches WHERE id = ?`).get(matchID) as
      | { state: string | null }
      | undefined
    if (!row?.state) return null
    try {
      return JSON.parse(row.state) as { G?: BhabhiState; ctx?: { currentPlayer?: string } }
    } catch {
      return null
    }
  }

  private remainingSeats(matchID: string, left: string[]): string[] {
    const gone = new Set(left)
    return this.seatList(matchID)
      .filter((seat) => seat.name)
      .map((seat) => String(seat.id))
      .filter((id) => !gone.has(id))
  }

  private matchGame(matchID: string): {
    phase?: string
    started?: boolean
    hostID?: string
    left?: string[]
    seatCount?: number
  } | null {
    const row = this.db.prepare(`SELECT state FROM matches WHERE id = ?`).get(matchID) as
      | { state: string | null }
      | undefined
    if (!row?.state) return null
    try {
      const state = JSON.parse(row.state) as {
        G?: { phase?: string; started?: boolean; hostID?: string; left?: string[]; seatCount?: number }
      }
      return state.G ?? null
    } catch {
      return null
    }
  }

  private userByGoogleSub(sub: string): PublicUser | null {
    const row = this.db
      .prepare(`SELECT id, email, display_name FROM users WHERE google_sub = ?`)
      .get(sub) as { id: number; email: string; display_name: string } | undefined
    return row ? { id: row.id, email: row.email, displayName: row.display_name } : null
  }

  private userByEmail(email: string): (PublicUser & { googleSub: string | null }) | null {
    const row = this.db
      .prepare(`SELECT id, email, display_name, google_sub FROM users WHERE email = ?`)
      .get(email) as
      | { id: number; email: string; display_name: string; google_sub: string | null }
      | undefined
    if (!row) return null
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      googleSub: row.google_sub,
    }
  }

  private createSession(userID: number): string {
    const token = randomBytes(24).toString('base64url')
    const expiresAt = utcNowMs() + config.auth.sessionDays * 24 * 60 * 60 * 1000
    this.db
      .prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`)
      .run(token, userID, expiresAt)
    return token
  }

  private matchMetadata(matchID: string): Server.MatchData | null {
    const row = this.db.prepare(`SELECT metadata FROM matches WHERE id = ?`).get(matchID) as
      | { metadata: string | null }
      | undefined
    if (!row?.metadata) return null
    try {
      return JSON.parse(row.metadata) as Server.MatchData
    } catch {
      return null
    }
  }

  private seatList(matchID: string): LobbySeat[] {
    const metadata = this.matchMetadata(matchID)
    if (!metadata?.players) return []
    const count = this.matchGame(matchID)?.seatCount
    return Object.values(metadata.players)
      .map((player) => ({
        id: player.id,
        name: player.name,
      }))
      .filter((seat) => count == null || seat.id < count)
      .sort((a, b) => a.id - b.id)
  }
}

export function normalizeEmail(email: string): string {
  const value = email.trim().toLowerCase()
  if (!value || !value.includes('@') || value.length > 254) {
    throw new AppError('Enter a valid email.', 400)
  }
  return value
}

function googleDisplayName(name: string, email: string): string {
  const collapsed = name.replace(/\s+/g, ' ').trim()
  if (collapsed.length >= 1 && collapsed.length <= config.auth.maxDisplayName) return collapsed
  if (collapsed.length > config.auth.maxDisplayName) {
    const trimmed = collapsed.slice(0, config.auth.maxDisplayName).trim()
    if (trimmed) return trimmed
  }
  const local = email.split('@')[0] ?? ''
  if (local.length >= 1 && local.length <= config.auth.maxDisplayName) return local
  if (local.length > config.auth.maxDisplayName) return local.slice(0, config.auth.maxDisplayName)
  return 'Player'
}

export function normalizeDisplayName(name: string): string {
  const value = name.replace(/\s+/g, ' ').trim()
  if (!value || value.length > config.auth.maxDisplayName) {
    throw new AppError(`Display name must be 1–${config.auth.maxDisplayName} characters.`, 400)
  }
  return value
}

function hashPassword(password: string): string {
  if (password.length < config.auth.minPasswordLength) {
    throw new AppError(`Password must be at least ${config.auth.minPasswordLength} characters.`, 400)
  }
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 64)
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}

function verifyPassword(password: string, stored: string): boolean {
  const [kind, saltHex, hashHex] = stored.split('$')
  if (kind !== 'scrypt' || !saltHex || !hashHex) return false
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), 64)
  const expected = Buffer.from(hashHex, 'hex')
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

function isUniqueError(reason: unknown): boolean {
  return (
    typeof reason === 'object' &&
    reason !== null &&
    'code' in reason &&
    (reason as { code: string }).code === 'SQLITE_CONSTRAINT_UNIQUE'
  )
}

function parseStringList(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function parseGotAway(raw: string): string[] {
  return parseStringList(raw)
}
