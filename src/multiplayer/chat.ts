import { utcNowMs } from '../lib/time'
import { config } from '../config'

/** Normalized chat line shown in the UI. */
export interface TableChatMessage {
  id: string
  sender: string
  text: string
  at: number
}

export interface ChatPayload {
  id?: unknown
  text?: unknown
  at?: unknown
  deleteId?: unknown
}

/** Trim and cap length; empty / whitespace-only → null. */
export function sanitizeChatText(
  raw: string,
  maxLength = config.chat.maxLength,
): string | null {
  const text = raw.replace(/\s+/g, ' ').trim()
  if (!text) return null
  return text.length > maxLength ? text.slice(0, maxLength) : text
}

/** Id of a message the sender soft-deleted, or null if this payload is a normal line. */
export function chatDeleteId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const deleteId = (payload as ChatPayload).deleteId
  return typeof deleteId === 'string' && deleteId ? deleteId : null
}

/** Turn a boardgame.io chat entry (any payload shape) into our message, or null. */
export function normalizeChatMessage(entry: {
  id: string
  sender: string
  payload: unknown
}): TableChatMessage | null {
  if (chatDeleteId(entry.payload)) return null

  let text: string | null = null
  let at = utcNowMs()
  let id = entry.id

  if (typeof entry.payload === 'string') {
    text = sanitizeChatText(entry.payload)
  } else if (entry.payload && typeof entry.payload === 'object') {
    const payload = entry.payload as ChatPayload
    if (typeof payload.text === 'string') text = sanitizeChatText(payload.text)
    if (typeof payload.at === 'number' && Number.isFinite(payload.at)) at = payload.at
    if (typeof payload.id === 'string' && payload.id) id = payload.id
  }

  if (!text || !id || entry.sender == null || entry.sender === '') return null
  return { id, sender: String(entry.sender), text, at }
}

/** Merge by id, newest last, capped. Tombstoned ids stay gone even if a copy arrives later. */
export function mergeChatMessages(
  cached: TableChatMessage[],
  incoming: TableChatMessage[],
  historyCap: number = config.chat.historyCap,
  deletedIds: Iterable<string> = [],
): TableChatMessage[] {
  const dropped = new Set(deletedIds)
  const byId = new Map<string, TableChatMessage>()
  for (const message of cached) {
    if (!dropped.has(message.id)) byId.set(message.id, message)
  }
  for (const message of incoming) {
    if (!dropped.has(message.id)) byId.set(message.id, message)
  }

  const merged = [...byId.values()].sort((a, b) => {
    if (a.at !== b.at) return a.at - b.at
    return a.id.localeCompare(b.id)
  })
  return merged.length > historyCap ? merged.slice(merged.length - historyCap) : merged
}
