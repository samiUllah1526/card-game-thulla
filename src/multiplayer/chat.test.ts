import { describe, expect, it } from 'vitest'
import { config } from '../config'
import { chatDeleteId, mergeChatMessages, normalizeChatMessage, sanitizeChatText, type TableChatMessage } from './chat'

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

  it('prefers payload.id so socket and DB rows merge', () => {
    expect(
      normalizeChatMessage({
        id: 'socket-row',
        sender: '0',
        payload: { id: 'stable', text: 'hi', at: 1 },
      }),
    ).toEqual({ id: 'stable', sender: '0', text: 'hi', at: 1 })
  })

  it('accepts plain string payloads', () => {
    const message = normalizeChatMessage({ id: 'm2', sender: '1', payload: 'yo' })
    expect(message).toMatchObject({ id: 'm2', sender: '1', text: 'yo' })
    expect(message?.at).toBeTypeOf('number')
  })

  it('drops invalid entries', () => {
    expect(normalizeChatMessage({ id: 'm3', sender: '0', payload: { text: '   ' } })).toBeNull()
    expect(normalizeChatMessage({ id: '', sender: '0', payload: 'ok' })).toBeNull()
    expect(normalizeChatMessage({ id: 'sock', sender: '0', payload: { deleteId: 'a' } })).toBeNull()
  })

  it('reads a delete tombstone', () => {
    expect(chatDeleteId({ deleteId: 'a' })).toBe('a')
    expect(chatDeleteId({ text: 'hi' })).toBeNull()
    expect(chatDeleteId('hi')).toBeNull()
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

  it('drops a tombstoned id even when a later copy arrives', () => {
    const cached: TableChatMessage[] = [
      { id: 'a', sender: '0', text: 'first', at: 10 },
      { id: 'b', sender: '1', text: 'second', at: 20 },
    ]
    const incoming: TableChatMessage[] = [
      { id: 'a', sender: '0', text: 'first again', at: 10 },
    ]
    expect(mergeChatMessages(cached, incoming, 80, ['a'])).toEqual([
      { id: 'b', sender: '1', text: 'second', at: 20 },
    ])
  })
})
