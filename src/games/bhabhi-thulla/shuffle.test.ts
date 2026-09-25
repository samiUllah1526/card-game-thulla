import { describe, expect, it } from 'vitest'
import { config } from '../../config'
import {
  clampScale,
  formatShuffleReport,
  meanDisplacement,
  orderedDeck,
  resolveAlgorithm,
  scaleToAlpha,
  shuffleDeck,
  shuffleReport,
  type ShuffleRandom,
} from './shuffle'

/** Deterministic fake RNG that walks through a fixed sequence, then repeats. */
function sequenceRandom(values: number[]): ShuffleRandom {
  let index = 0
  return {
    Number() {
      const value = values[index % values.length]
      index += 1
      return value
    },
  }
}

/** Pseudo-random but seeded — enough to compare displacement across algorithms. */
function seededRandom(seed = 1): ShuffleRandom {
  let state = seed >>> 0
  return {
    Number() {
      state = (1664525 * state + 1013904223) >>> 0
      return state / 0x100000000
    },
  }
}

describe('shuffle helpers', () => {
  it('builds a 52-card ordered deck A→2 by suit', () => {
    const deck = orderedDeck()
    expect(deck).toHaveLength(52)
    expect(deck[0]).toMatchObject({ id: 'S-14', suit: 'S', rank: 14 })
    expect(deck[12]).toMatchObject({ id: 'S-2', suit: 'S', rank: 2 })
    expect(deck[13]).toMatchObject({ id: 'H-14', suit: 'H', rank: 14 })
    expect(deck[51]).toMatchObject({ id: 'C-2', suit: 'C', rank: 2 })
  })

  it('maps scale 1→0 and scale 10→1 for alpha', () => {
    expect(scaleToAlpha(1)).toBe(0)
    expect(scaleToAlpha(10)).toBe(1)
    expect(scaleToAlpha(5.4)).toBeCloseTo(4 / 9)
  })

  it('falls back to the default algorithm for unknown ids', () => {
    expect(resolveAlgorithm('nope')).toBe(config.shuffle.defaultAlgorithm)
    expect(resolveAlgorithm('localMix')).toBe('localMix')
  })

  it('clamps scale into the configured range', () => {
    expect(clampScale(0)).toBe(config.shuffle.minScale)
    expect(clampScale(99)).toBe(config.shuffle.maxScale)
    expect(clampScale(undefined)).toBe(config.shuffle.defaultScale)
  })
})

describe('weighted shuffle', () => {
  it('returns the ordered deck at scale 1 for either algorithm', () => {
    const original = orderedDeck()
    for (const algorithm of ['localMix', 'blendRandom'] as const) {
      const shuffled = shuffleDeck(original, { algorithm, scale: 1 }, seededRandom(7))
      expect(shuffled.map((card) => card.id)).toEqual(original.map((card) => card.id))
    }
  })

  it('returns a permutation of the same 52 cards at full intensity', () => {
    const original = orderedDeck()
    const shuffled = shuffleDeck(
      original,
      { algorithm: 'blendRandom', scale: 10 },
      seededRandom(42),
    )
    expect(shuffled.map((card) => card.id).sort()).toEqual(
      original.map((card) => card.id).sort(),
    )
    expect(shuffled.map((card) => card.id)).not.toEqual(original.map((card) => card.id))
  })

  it('keeps mid-scale localMix nearer original neighbors than blendRandom', () => {
    const original = orderedDeck()
    const scale = 5
    const local = shuffleDeck(original, { algorithm: 'localMix', scale }, seededRandom(99))
    const blend = shuffleDeck(original, { algorithm: 'blendRandom', scale }, seededRandom(99))
    expect(meanDisplacement(original, local)).toBeLessThan(meanDisplacement(original, blend))
  })

  it('uses the original localMix key formula (i not normalized)', () => {
    const original = orderedDeck().slice(0, 4)
    // Mid scale: alpha = 5/9. With mild randomness the original order is kept.
    const same = shuffleDeck(
      original,
      { algorithm: 'localMix', scale: 6 },
      sequenceRandom([0.9, 0.1, 0.8, 0.2]),
    )
    expect(same.map((card) => card.id)).toEqual(original.map((card) => card.id))

    // Force card 0 and 1 to swap: need r0 - r1 > (1-alpha)/alpha = 0.8
    const swapped = shuffleDeck(
      original,
      { algorithm: 'localMix', scale: 6 },
      sequenceRandom([0.95, 0.05, 0.5, 0.5]),
    )
    expect(swapped.map((card) => card.id)).toEqual([
      original[1].id,
      original[0].id,
      original[2].id,
      original[3].id,
    ])
  })
})

describe('shuffle report', () => {
  it('reports Stacked for an unshuffled deck', () => {
    const deck = orderedDeck()
    const report = shuffleReport(deck, deck, { algorithm: 'blendRandom', scale: 1 })
    expect(report.verdict).toBe('stacked')
    expect(report.verdictLabel).toBe('Stacked')
    expect(report.orderScore).toBeCloseTo(1)
    expect(report.clumpScore).toBeGreaterThan(0.9)
    expect(formatShuffleReport(report)).toContain('Blend to random')
    expect(formatShuffleReport(report)).toContain('1/10')
  })

  it('reports a low orderScore after a strong blend shuffle', () => {
    const original = orderedDeck()
    const shuffled = shuffleDeck(
      original,
      { algorithm: 'blendRandom', scale: 10 },
      seededRandom(123),
    )
    const report = shuffleReport(original, shuffled, { algorithm: 'blendRandom', scale: 10 })
    expect(report.orderScore).toBeLessThan(0.4)
    expect(['mixed', 'well', 'random']).toContain(report.verdict)
  })
})
