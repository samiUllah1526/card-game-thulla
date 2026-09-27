import type { PublicUser } from './authTypes'
import type { TableChatMessage } from './chat'
import type { MatchLeaderboard } from './leaderboard'
import type { Session } from '../games/bhabhi-thulla/types'
import type { WatchEvent } from './watchTypes'

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  const body = (await response.json().catch(() => ({}))) as { error?: string } & T
  if (!response.ok) throw new Error(body.error ?? 'Could not reach the game server')
  return body
}

function seatHeaders(session: Session): Record<string, string> {
  return {
    'X-Player-ID': session.playerID,
    'X-Credentials': session.credentials,
  }
}

export async function fetchMe(): Promise<PublicUser | null> {
  const body = await json<{ user: PublicUser | null }>('/auth/me')
  return body.user
}

export async function signup(
  email: string,
  password: string,
  displayName: string,
): Promise<PublicUser> {
  const body = await json<{ user: PublicUser }>('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password, displayName }),
  })
  return body.user
}

export async function login(email: string, password: string): Promise<PublicUser> {
  const body = await json<{ user: PublicUser }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  return body.user
}

export async function logout(): Promise<void> {
  await json('/auth/logout', { method: 'POST' })
}

export interface ChatView {
  messages: TableChatMessage[]
  visibleAfter: number
  open: boolean
}

export interface MatchGate {
  closed: boolean
  started: boolean
}

export async function fetchMatchChat(session: Session): Promise<ChatView> {
  const body = await json<ChatView>(
    `/api/matches/${encodeURIComponent(session.matchID)}/chat`,
    { headers: seatHeaders(session) },
  )
  return {
    messages: body.messages ?? [],
    visibleAfter: body.visibleAfter ?? 0,
    open: body.open !== false,
  }
}

export async function registerSeat(session: Session): Promise<void> {
  await json(`/api/matches/${encodeURIComponent(session.matchID)}/seat`, {
    method: 'POST',
    headers: seatHeaders(session),
  })
}

export async function fetchMatchGate(matchID: string): Promise<MatchGate> {
  return json<MatchGate>(`/api/matches/${encodeURIComponent(matchID)}/gate`)
}

export async function reclaimSeat(matchID: string): Promise<Session> {
  return json<Session>(`/api/matches/${encodeURIComponent(matchID)}/reclaim`, {
    method: 'POST',
  })
}

export async function closeMatch(session: Session): Promise<void> {
  await json(`/api/matches/${encodeURIComponent(session.matchID)}/close`, {
    method: 'POST',
    headers: seatHeaders(session),
  })
}

export async function departMatch(session: Session): Promise<{ closed: boolean }> {
  return json<{ closed: boolean }>(`/api/matches/${encodeURIComponent(session.matchID)}/depart`, {
    method: 'POST',
    headers: seatHeaders(session),
  })
}

export async function persistMatchChat(
  session: Session,
  message: Pick<TableChatMessage, 'id' | 'text' | 'at'>,
): Promise<TableChatMessage> {
  const body = await json<{ message: TableChatMessage }>(
    `/api/matches/${encodeURIComponent(session.matchID)}/chat`,
    {
      method: 'POST',
      headers: seatHeaders(session),
      body: JSON.stringify(message),
    },
  )
  return body.message
}

export async function deleteMatchChat(session: Session, messageID: string): Promise<void> {
  await json(
    `/api/matches/${encodeURIComponent(session.matchID)}/chat/${encodeURIComponent(messageID)}`,
    {
      method: 'DELETE',
      headers: seatHeaders(session),
    },
  )
}

/** Live public table. The stream never carries a seat secret. */
export function openWatch(matchID: string, onEvent: (event: WatchEvent) => void): () => void {
  const source = new EventSource(`/api/matches/${encodeURIComponent(matchID)}/watch/events`)
  source.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data) as WatchEvent)
    } catch {
      // Ignore a malformed frame and wait for the next one.
    }
  }
  return () => source.close()
}

export async function fetchMatchLeaderboard(session: Session): Promise<MatchLeaderboard> {
  return json<MatchLeaderboard>(
    `/api/matches/${encodeURIComponent(session.matchID)}/leaderboard`,
    { headers: seatHeaders(session) },
  )
}
