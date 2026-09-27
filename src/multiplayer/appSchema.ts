/** App tables on the same SQLite file as boardgame.io matches. */
export const APP_SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL,
    sender_seat TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    text TEXT NOT NULL,
    at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS chat_messages_match_at ON chat_messages (match_id, at);

  CREATE TABLE IF NOT EXISTS deal_results (
    match_id TEXT NOT NULL,
    deal INTEGER NOT NULL,
    bhabhi_seat TEXT NOT NULL,
    got_away TEXT NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (match_id, deal)
  );
`

export function applyAppSchema(db: { exec: (sql: string) => unknown }): void {
  db.exec(APP_SCHEMA)
}
