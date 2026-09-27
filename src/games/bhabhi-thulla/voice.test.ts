import { describe, expect, it } from 'vitest'
import { bhabhiLine, denyLine, fillVoice, lineAt, thullaLine } from './voice'

describe('game voice lines', () => {
  it('picks a stable line from the seed', () => {
    expect(lineAt(['a', 'b', 'c'], 0)).toBe('a')
    expect(lineAt(['a', 'b', 'c'], 2)).toBe('c')
    expect(lineAt(['a', 'b', 'c'], 4)).toBe('b')
    expect(lineAt(['a', 'b', 'c'], -1)).toBe('c')
  })

  it('fills names into a spoken line', () => {
    expect(fillVoice('Hi {name}, {count} cards', { name: 'Aisha', count: '3' })).toBe(
      'Hi Aisha, 3 cards',
    )
  })

  it('roasts a Thulla with both names and the card count', () => {
    const line = thullaLine('Nia', 'Omar', 4, 1)
    expect(line).toContain('Nia')
    expect(line).toContain('Omar')
    expect(line).toContain('4')
    expect(thullaLine('Nia', 'Omar', 4, 1)).toBe(line)
  })

  it('roasts the Bhabhi, and the loser hears a different joke', () => {
    const others = bhabhiLine('Host', false, 0)
    const mine = bhabhiLine('Host', true, 0)
    expect(others).toContain('Host')
    expect(mine).toContain('Bhabhi')
    expect(mine).not.toBe(others)
  })

  it('roasts the player whose take was declined', () => {
    const line = denyLine('Late', 2)
    expect(line).toContain('Late')
    expect(denyLine('Late', 2)).toBe(line)
  })
})