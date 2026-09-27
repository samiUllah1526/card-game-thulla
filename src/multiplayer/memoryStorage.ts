import { Sync } from 'boardgame.io/internal'
import type { LogEntry, Server, State, StorageAPI } from 'boardgame.io'

/** In-process store — lost on restart. Useful for tests and local throwaway servers. */
export class InMemory extends Sync {
  private state = new Map<string, State>()
  private initial = new Map<string, State>()
  private metadata = new Map<string, Server.MatchData>()
  private log = new Map<string, LogEntry[]>()

  connect(): void {}

  createMatch(matchID: string, opts: StorageAPI.CreateMatchOpts): void {
    this.initial.set(matchID, opts.initialState)
    this.setState(matchID, opts.initialState)
    this.setMetadata(matchID, opts.metadata)
  }

  setState(matchID: string, state: State, deltalog?: LogEntry[]): void {
    this.state.set(matchID, state)
    if (deltalog?.length) {
      const existing = this.log.get(matchID) ?? []
      this.log.set(matchID, [...existing, ...deltalog])
    }
  }

  setMetadata(matchID: string, metadata: Server.MatchData): void {
    this.metadata.set(matchID, metadata)
  }

  fetch<O extends StorageAPI.FetchOpts>(matchID: string, opts: O): StorageAPI.FetchResult<O> {
    const result = {} as StorageAPI.FetchFields
    if (opts.state) result.state = this.state.get(matchID) as State
    if (opts.initialState) result.initialState = this.initial.get(matchID) as State
    if (opts.metadata) result.metadata = this.metadata.get(matchID) as Server.MatchData
    if (opts.log) result.log = this.log.get(matchID) ?? []
    return result as StorageAPI.FetchResult<O>
  }

  wipe(matchID: string): void {
    this.state.delete(matchID)
    this.initial.delete(matchID)
    this.metadata.delete(matchID)
    this.log.delete(matchID)
  }

  listMatches(opts?: StorageAPI.ListMatchesOpts): string[] {
    return [...this.metadata.entries()]
      .filter(([, metadata]) => {
        if (!opts) return true
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
      .map(([id]) => id)
  }
}
