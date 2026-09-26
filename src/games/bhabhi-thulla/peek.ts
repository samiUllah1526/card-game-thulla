import type { BhabhiState } from './types'

/** Apply playerView filtering; peekers receive every hand. Safe for client + server. */
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

/**
 * Injected by the Node server (and tests). Stays empty in the browser bundle
 * so `node:fs` never ships to the client.
 */
let resolvePeekPassword: () => string = () => ''

export function setPeekPasswordResolver(fn: () => string): void {
  resolvePeekPassword = fn
}

export function expectedPeekPassword(): string {
  return resolvePeekPassword()
}
