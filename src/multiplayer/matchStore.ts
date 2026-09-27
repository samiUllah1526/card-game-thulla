import { resolve } from 'node:path'
import { config } from '../config'
import { InMemory } from './memoryStorage'
import { SqliteStorage } from './sqliteStorage'
import type { StorageAPI } from 'boardgame.io'

/**
 * boardgame.io match persistence contract.
 * Every backend (SQLite today, Postgres/etc later) implements this.
 */
export type MatchStore = StorageAPI.Sync | StorageAPI.Async

/** Engines `createMatchStore` knows how to build. */
export type StorageEngine = 'sqlite' | 'memory'

/** Build the configured match store. Add a `case` here when you add a database. */
export function createMatchStore(engine: StorageEngine = resolveEngine()): MatchStore {
  switch (engine) {
    case 'memory':
      return new InMemory()
    case 'sqlite':
      return new SqliteStorage(resolveSqlitePath())
    default: {
      const exhausted: never = engine
      throw new Error(`Unknown storage engine "${String(exhausted)}"`)
    }
  }
}

export function describeMatchStore(engine: StorageEngine = resolveEngine()): string {
  if (engine === 'memory') return 'memory (ephemeral)'
  return `sqlite ${resolveSqlitePath()}`
}

function resolveEngine(): StorageEngine {
  const fromEnv = process.env.STORAGE_ENGINE?.trim()
  if (fromEnv === 'sqlite' || fromEnv === 'memory') return fromEnv
  const configured = config.storage.engine
  if (configured === 'sqlite' || configured === 'memory') return configured
  throw new Error(
    `Unknown storage engine "${String(configured)}". Add it to createMatchStore().`,
  )
}

function resolveSqlitePath(): string {
  return resolve(process.cwd(), process.env.SQLITE_PATH ?? config.storage.sqlitePath)
}
