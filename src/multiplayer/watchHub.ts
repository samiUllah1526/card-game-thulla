import type { WatchEvent } from './watchTypes'

type Listener = (event: WatchEvent) => void

const rooms = new Map<string, Set<Listener>>()

export function subscribeWatch(matchID: string, listener: Listener): () => void {
  const listeners = rooms.get(matchID) ?? new Set<Listener>()
  listeners.add(listener)
  rooms.set(matchID, listeners)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) rooms.delete(matchID)
  }
}

export function publishWatch(matchID: string, event: WatchEvent): void {
  const listeners = rooms.get(matchID)
  if (!listeners) return
  for (const listener of [...listeners]) listener(event)
}
