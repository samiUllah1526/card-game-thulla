import { config } from '../../config'
import type { BhabhiState } from './types'

/** Server-only: password from env. Empty string means peek is disabled. */
export function peekPassword(): string {
  return (process.env[config.peek.envKey] ?? '').trim()
}

/** Apply playerView filtering; peekers receive every hand. */
export function filterPlayerView(G: BhabhiState, playerID: string | null | undefined): BhabhiState {
  const visible = structuredClone(G)
  const peek = !!playerID && !!G.peekers?.[playerID]
  visible.hands = Object.fromEntries(
    Object.keys(G.hands).map((id) => [id, peek || id === playerID ? G.hands[id] : []]),
  )
  visible.peekers = peek && playerID ? { [playerID]: true } : undefined
  visible.waste = []
  return visible
}
