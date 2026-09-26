import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { Sync } from 'boardgame.io/internal'
import type { LogEntry, Server, State, StorageAPI } from 'boardgame.io'
import { applyAppSchema } from './appSchema'
import { AppStore } from './appStore'
import type { DealResult } from '../games/bhabhi-thulla/types'

/**
 * SQLite MatchStore backend (single Node process).
 * Swap this out via `createMatchStore()` — do not import this from the game server.
 */
export class SqliteStorage extends Sync {
  private db: Database.Database | null = null
  private appStore: AppStore | null = null

  constructor(private readonly filename: string) {
    super()
  }

  connect(): void {
    if (this.db) return
    mkdirSync(dirname(this.filename), { recursive: true })
    this.db = new Database(this.filename)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS matches (
        id TEXT PRIMARY KEY,
        state TEXT,
        initial_state TEXT,
        metadata TEXT,
        log TEXT NOT NULL DEFAULT '[]'
      );
    `)
    applyAppSchema(this.db)
    this.appStore = new AppStore(this.db)
  }

  getAppStore(): AppStore {
    if (!this.appStore) throw new Error('SqliteStorage.connect() must be called first')
    return this.appStore
  }

  private requireDb(): Database.Database {
    if (!this.db) throw new Error('SqliteStorage.connect() must be called first')
    return this.db
  }

  createMatch(matchID: string, opts: StorageAPI.CreateMatchOpts): void {
    const db = this.requireDb()
    db.prepare(
      `INSERT INTO matches (id, state, initial_state, metadata, log)
       VALUES (@id, @state, @initial_state, @metadata, @log)
       ON CONFLICT(id) DO UPDATE SET
         state = excluded.state,
         initial_state = excluded.initial_state,
         metadata = excluded.metadata,
         log = excluded.log`,
    ).run({
      id: matchID,
      state: JSON.stringify(opts.initialState),
      initial_state: JSON.stringify(opts.initialState),
      metadata: JSON.stringify(opts.metadata),
      log: '[]',
    })
  }

  setState(matchID: string, state: State, deltalog?: LogEntry[]): void {
    const db = this.requireDb()
    const row = db.prepare(`SELECT log FROM matches WHERE id = ?`).get(matchID) as
      | { log: string }
      | undefined

    let log: LogEntry[] = []
    if (row?.log) {
      try {
        log = JSON.parse(row.log) as LogEntry[]
      } catch {
        log = []
      }
    }
    if (deltalog?.length) log = [...log, ...deltalog]

    db.prepare(
      `INSERT INTO matches (id, state, log)
       VALUES (@id, @state, @log)
       ON CONFLICT(id) DO UPDATE SET
         state = excluded.state,
         log = excluded.log`,
    ).run({
      id: matchID,
      state: JSON.stringify(state),
      log: JSON.stringify(log),
    })

    const history = (state.G as { dealHistory?: DealResult[] } | undefined)?.dealHistory
    this.appStore?.upsertDealResults(matchID, history)
  }

  setMetadata(matchID: string, metadata: Server.MatchData): void {
    this.requireDb()
      .prepare(
        `INSERT INTO matches (id, metadata)
         VALUES (@id, @metadata)
         ON CONFLICT(id) DO UPDATE SET metadata = excluded.metadata`,
      )
      .run({
        id: matchID,
        metadata: JSON.stringify(metadata),
      })
  }

  fetch<O extends StorageAPI.FetchOpts>(
    matchID: string,
    opts: O,
  ): StorageAPI.FetchResult<O> {
    const row = this.requireDb()
      .prepare(
        `SELECT state, initial_state, metadata, log FROM matches WHERE id = ?`,
      )
      .get(matchID) as
      | {
          state: string | null
          initial_state: string | null
          metadata: string | null
          log: string | null
        }
      | undefined

    const result = {} as StorageAPI.FetchFields
    if (!row) return result as StorageAPI.FetchResult<O>

    if (opts.state && row.state) result.state = JSON.parse(row.state) as State
    if (opts.initialState && row.initial_state) {
      result.initialState = JSON.parse(row.initial_state) as State
    }
    if (opts.metadata && row.metadata) {
      result.metadata = JSON.parse(row.metadata) as Server.MatchData
    }
    if (opts.log) {
      result.log = row.log ? (JSON.parse(row.log) as LogEntry[]) : []
    }
    return result as StorageAPI.FetchResult<O>
  }

  wipe(matchID: string): void {
    this.appStore?.wipeMatchExtras(matchID)
    this.requireDb().prepare(`DELETE FROM matches WHERE id = ?`).run(matchID)
  }

  listMatches(opts?: StorageAPI.ListMatchesOpts): string[] {
    const rows = this.requireDb()
      .prepare(`SELECT id, metadata FROM matches WHERE metadata IS NOT NULL`)
      .all() as Array<{ id: string; metadata: string }>

    return rows
      .filter((row) => {
        if (!opts) return true
        let metadata: Server.MatchData
        try {
          metadata = JSON.parse(row.metadata) as Server.MatchData
        } catch {
          return false
        }
        if (opts.gameName && metadata.gameName !== opts.gameName) return false
        if (opts.where?.isGameover !== undefined) {
          const isGameover = metadata.gameover !== undefined
          if (isGameover !== opts.where.isGameover) return false
        }
        if (
          opts.where?.updatedBefore !== undefined &&
          metadata.updatedAt >= opts.where.updatedBefore
        ) {
          return false
        }
        if (
          opts.where?.updatedAfter !== undefined &&
          metadata.updatedAt <= opts.where.updatedAfter
        ) {
          return false
        }
        return true
      })
      .map((row) => row.id)
  }
}
