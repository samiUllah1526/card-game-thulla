import { config } from '../config'
import type { LobbySeat, Session, SetupData } from '../games/bhabhi-thulla/types'

const GAME = config.game.name
const SESSION_KEY = config.storage.sessionKey

interface MatchResponse {
  matchID: string
  players: Array<{ id: number; name?: string }>
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error ?? 'Could not reach the game server')
  return body as T
}

export async function createMatch(
  playerName: string,
  numPlayers: number,
  setupData: SetupData = {},
): Promise<Session> {
  const created = await json<{ matchID: string }>(`/games/${GAME}/create`, {
    method: 'POST',
    body: JSON.stringify({
      numPlayers,
      setupData: {
        shuffleAlgorithm: setupData.shuffleAlgorithm ?? config.shuffle.defaultAlgorithm,
        shuffleScale: setupData.shuffleScale ?? config.shuffle.defaultScale,
        takeRequiresPermission:
          setupData.takeRequiresPermission ?? config.game.defaultTakeRequiresPermission,
      },
    }),
  })
  return joinMatch(created.matchID, '0', playerName)
}

export async function joinMatch(
  matchID: string,
  playerID: string,
  playerName: string,
): Promise<Session> {
  const joined = await json<{ playerCredentials: string }>(
    `/games/${GAME}/${matchID}/join`,
    {
      method: 'POST',
      body: JSON.stringify({ playerID: Number(playerID), playerName }),
    },
  )
  return {
    matchID,
    playerID,
    playerName,
    credentials: joined.playerCredentials,
  }
}

export async function getSeats(matchID: string): Promise<LobbySeat[]> {
  const match = await json<MatchResponse>(`/games/${GAME}/${matchID}`)
  return match.players.map(({ id, name }) => ({ id, name }))
}

/** Public share URL for this table (SPA GET /join/:code). */
export function joinUrl(matchID: string, origin = window.location.origin): string {
  return `${origin}/join/${encodeURIComponent(matchID)}`
}

/** Read match code from `/join/:code`. */
export function parseJoinPath(pathname = window.location.pathname): string | null {
  return readCodePath('join', pathname)
}

/** Read match code from `/watch/:code`. Refresh reopens the watch view. */
export function parseWatchPath(pathname = window.location.pathname): string | null {
  return readCodePath('watch', pathname)
}

function readCodePath(kind: 'join' | 'watch', pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length !== 2 || parts[0] !== kind || !parts[1]) return null
  try {
    return decodeURIComponent(parts[1])
  } catch {
    return parts[1]
  }
}

/** Next unused guest1, guest2, … from names already seated (case-insensitive). */
export function nextGuestName(seats: LobbySeat[]): string {
  const taken = new Set(
    seats
      .map((seat) => seat.name?.trim().toLowerCase())
      .filter((name): name is string => !!name),
  )
  let n = 1
  while (taken.has(`guest${n}`)) n += 1
  return `guest${n}`
}

export function firstEmptySeat(seats: LobbySeat[]): LobbySeat | undefined {
  return seats.find((seat) => !seat.name)
}

/**
 * A saved seat for this table sits back down. A dropped browser still has
 * that seat in localStorage. A watch URL must not steal it.
 */
export function shouldReconnect(
  stored: { matchID?: string } | null,
  joinCode: string | null,
  watchCode: string | null,
): boolean {
  return !watchCode && !!stored?.matchID && (!joinCode || stored.matchID === joinCode)
}

export function saveSession(session: Session): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export function loadSession(): Session | null {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null')
  } catch {
    return null
  }
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY)
}
