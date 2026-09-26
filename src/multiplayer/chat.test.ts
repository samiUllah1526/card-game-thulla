import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { config } from '../config'
import {
  loadChatCache,
  mergeChatMessages,
  normalizeChatMessage,
  saveChatCache,
  sanitizeChatText,
  type TableChatMessage,
} from './chat'

const matchID = 'test-match'
const memory = new Map<string, string>()

beforeAll(() => {
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value)
      },
      removeItem: (key: string) => {
        memory.delete(key)
      },
      clear: () => memory.clear(),
      key: () => null,
      get length() {
        return memory.size
      },
    },
  })
})

afterEach(() => {
  memory.clear()
})

describe('sanitizeChatText', () => {
  it('trims and collapses whitespace', () => {
    expect(sanitizeChatText('  hello   world  ')).toBe('hello world')
  })

  it('rejects empty / whitespace-only', () => {
    expect(sanitizeChatText('')).toBeNull()
    expect(sanitizeChatText('   \n\t  ')).toBeNull()
  })

  it('caps length', () => {
    const long = 'a'.repeat(config.chat.maxLength + 40)
    expect(sanitizeChatText(long)?.length).toBe(config.chat.maxLength)
  })
})

describe('normalizeChatMessage', () => {
  it('accepts object payloads with text and at', () => {
    expect(
      normalizeChatMessage({
        id: 'm1',
        sender: '0',
        payload: { text: '  hi  ', at: 100 },
      }),
    ).toEqual({ id: 'm1', sender: '0', text: 'hi', at: 100 })
  })

  it('accepts plain string payloads', () => {
    const message = normalizeChatMessage({ id: 'm2', sender: '1', payload: 'yo' })
    expect(message).toMatchObject({ id: 'm2', sender: '1', text: 'yo' })
    expect(message?.at).toBeTypeOf('number')
  })

  it('drops invalid entries', () => {
    expect(normalizeChatMessage({ id: 'm3', sender: '0', payload: { text: '   ' } })).toBeNull()
    expect(normalizeChatMessage({ id: '', sender: '0', payload: 'ok' })).toBeNull()
  })
})

describe('mergeChatMessages', () => {
  it('dedupes by id and sorts by time', () => {
    const cached: TableChatMessage[] = [
      { id: 'a', sender: '0', text: 'first', at: 10 },
      { id: 'b', sender: '1', text: 'old b', at: 20 },
    ]
    const incoming: TableChatMessage[] = [
      { id: 'b', sender: '1', text: 'new b', at: 20 },
      { id: 'c', sender: '2', text: 'third', at: 5 },
    ]
    expect(mergeChatMessages(cached, incoming)).toEqual([
      { id: 'c', sender: '2', text: 'third', at: 5 },
      { id: 'a', sender: '0', text: 'first', at: 10 },
      { id: 'b', sender: '1', text: 'new b', at: 20 },
    ])
  })

  it('trims to historyCap keeping newest', () => {
    const many = Array.from({ length: 5 }, (_, index) => ({
      id: String(index),
      sender: '0',
      text: `m${index}`,
      at: index,
    }))
    expect(mergeChatMessages([], many, 3).map((m) => m.id)).toEqual(['2', '3', '4'])
  })
})

describe('chat session cache', () => {
  it('round-trips messages for a match', () => {
    const messages: TableChatMessage[] = [
      { id: '1', sender: '0', text: 'hello', at: 1 },
      { id: '2', sender: '1', text: 'world', at: 2 },
    ]
    saveChatCache(matchID, messages)
    expect(loadChatCache(matchID)).toEqual(messages)
  })

  it('returns empty for missing or corrupt data', () => {
    expect(loadChatCache('missing')).toEqual([])
    sessionStorage.setItem(`${config.chat.storageKey}:${matchID}`, '{not json')
    expect(loadChatCache(matchID)).toEqual([])
  })
})
