import type Database from 'better-sqlite3'
import type { BotDifficulty } from './difficulty'

export interface BotSeatRow {
  matchID: string
  playerID: string
  difficulty: BotDifficulty
  credentials: string
}

/** Credentials for bot seats. This is the only place they are stored. */
export class BotSeatStore {
  constructor(private readonly db: Database.Database) {}

  upsert(matchID: string, playerID: string, difficulty: BotDifficulty, credentials: string): void {
    this.db
      .prepare(
        `INSERT INTO bot_seats (match_id, player_id, difficulty, credentials)
         VALUES (@match_id, @player_id, @difficulty, @credentials)
         ON CONFLICT(match_id, player_id) DO UPDATE SET
           difficulty = excluded.difficulty,
           credentials = excluded.credentials`,
      )
      .run({
        match_id: matchID,
        player_id: playerID,
        difficulty,
        credentials,
      })
  }

  updateDifficulty(matchID: string, playerID: string, difficulty: BotDifficulty): void {
    this.db
      .prepare(`UPDATE bot_seats SET difficulty = ? WHERE match_id = ? AND player_id = ?`)
      .run(difficulty, matchID, playerID)
  }

  remove(matchID: string, playerID: string): void {
    this.db.prepare(`DELETE FROM bot_seats WHERE match_id = ? AND player_id = ?`).run(matchID, playerID)
  }

  get(matchID: string, playerID: string): BotSeatRow | null {
    const row = this.db
      .prepare(
        `SELECT match_id, player_id, difficulty, credentials
         FROM bot_seats WHERE match_id = ? AND player_id = ?`,
      )
      .get(matchID, playerID) as
      | { match_id: string; player_id: string; difficulty: BotDifficulty; credentials: string }
      | undefined
    return row ? toSeat(row) : null
  }

  all(): BotSeatRow[] {
    const rows = this.db
      .prepare(`SELECT match_id, player_id, difficulty, credentials FROM bot_seats`)
      .all() as Array<{
      match_id: string
      player_id: string
      difficulty: BotDifficulty
      credentials: string
    }>
    return rows.map(toSeat)
  }
}

function toSeat(row: {
  match_id: string
  player_id: string
  difficulty: BotDifficulty
  credentials: string
}): BotSeatRow {
  return {
    matchID: row.match_id,
    playerID: row.player_id,
    difficulty: row.difficulty,
    credentials: row.credentials,
  }
}
