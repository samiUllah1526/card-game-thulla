import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { config } from '../../config'

/** Parse a dotenv file into a map (does not mutate process.env). Server-only. */
export function readEnvFile(filename = '.env'): Record<string, string> {
  const out: Record<string, string> = {}
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
      if (key) out[key] = value
    }
  } catch {
    // Missing file is fine.
  }
  return out
}

/**
 * Server-only peek password.
 * Re-reads `.env` each call so edits apply without restarting the game server.
 * Under Vitest, prefers process.env so unit tests stay isolated from the real `.env`.
 */
export function peekPassword(): string {
  if (process.env.VITEST) {
    return (process.env[config.peek.envKey] ?? '').trim()
  }
  const fromFile = (readEnvFile()[config.peek.envKey] ?? '').trim()
  if (fromFile) return fromFile
  return (process.env[config.peek.envKey] ?? '').trim()
}
