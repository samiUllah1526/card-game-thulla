import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { Server } from 'boardgame.io'
import { config } from '../config'
import { utcNowMs } from '../lib/time'
import type { DealResult, LobbySeat } from '../games/bhabhi-thulla/types'
import type { TableChatMessage } from './chat'
import { tallyLeaderboard, type MatchLeaderboard } from './leaderboard'
import type { PublicUser } from './authTypes'

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

  appendChat(input: {
    id?: string
    matchID: string
    senderSeat: string
    userID?: number | null
    text: string
    at?: number
  }): TableChatMessage {
    const id = input.id?.trim() || randomBytes(8).toString('base64url')
    const at = input.at && Number.isFinite(input.at) ? input.at : utcNowMs()
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
    const rows = this.db
      .prepare(
        `SELECT id, sender_seat, text, at FROM chat_messages
         WHERE match_id = ?
         ORDER BY at DESC, id DESC
         LIMIT ?`,
      )
      .all(matchID, cap) as Array<{ id: string; sender_seat: string; text: string; at: number }>
    return rows
      .reverse()
      .map((row) => ({ id: row.id, sender: row.sender_seat, text: row.text, at: row.at }))
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
    return Object.values(metadata.players).map((player) => ({
      id: player.id,
      name: player.name,
    }))
  }
}

export function normalizeEmail(email: string): string {
  const value = email.trim().toLowerCase()
  if (!value || !value.includes('@') || value.length > 254) {
    throw new AppError('Enter a valid email.', 400)
  }
  return value
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

function parseGotAway(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}
