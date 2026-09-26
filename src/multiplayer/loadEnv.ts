import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** Load `.env` into process.env without overriding existing vars. Server-only. */
export function loadEnv(filename = '.env'): void {
  try {
    const text = readFileSync(resolve(process.cwd(), filename), 'utf8')
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq <= 0) continue
      const key = trimmed.slice(0, eq).trim()
      let value = trimmed.slice(eq + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (key && process.env[key] === undefined) process.env[key] = value
    }
  } catch {
    // Missing .env is fine — feature stays off until PEEK_PASSWORD is set.
  }
}
