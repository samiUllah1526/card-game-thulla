/** App tables on the same SQLite file as boardgame.io matches. */
export const APP_SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    google_sub TEXT
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
    at INTEGER NOT NULL,
    deleted_at INTEGER
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

  CREATE TABLE IF NOT EXISTS seat_members (
    match_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (match_id, player_id)
  );

  CREATE TABLE IF NOT EXISTS match_gates (
    match_id TEXT PRIMARY KEY,
    chat_after INTEGER NOT NULL DEFAULT 0,
    closed_at INTEGER,
    departed TEXT NOT NULL DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS bot_seats (
    match_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    credentials TEXT NOT NULL,
    PRIMARY KEY (match_id, player_id)
  );
`

interface SchemaDb {
  exec(sql: string): unknown
  prepare(sql: string): { all(): unknown[] }
}

export function applyAppSchema(db: SchemaDb): void {
  db.exec(APP_SCHEMA)
  const columns = db.prepare(`PRAGMA table_info(chat_messages)`).all() as Array<{ name: string }>
  if (!columns.some((column) => column.name === 'deleted_at')) {
    db.exec(`ALTER TABLE chat_messages ADD COLUMN deleted_at INTEGER`)
  }
  const userColumns = db.prepare(`PRAGMA table_info(users)`).all() as Array<{ name: string }>
  if (!userColumns.some((column) => column.name === 'google_sub')) {
    db.exec(`ALTER TABLE users ADD COLUMN google_sub TEXT`)
  }
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL`,
  )
}
