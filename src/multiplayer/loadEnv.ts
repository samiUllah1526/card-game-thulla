import { readEnvFile } from '../games/bhabhi-thulla/peekEnv'

/**
 * Load `.env` into process.env.
 * Overwrites empty values so a blank PEEK_PASSWORD from an earlier boot
 * can be replaced after you edit `.env`.
 */
export function loadEnv(filename = '.env'): void {
  const parsed = readEnvFile(filename)
  for (const [key, value] of Object.entries(parsed)) {
    const current = process.env[key]
    if (current === undefined || current === '') process.env[key] = value
  }
}
