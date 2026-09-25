import { config } from '../../config'
import type { Card, Rank, ShuffleReport, Suit } from './types'

export type ShuffleAlgorithmId = (typeof config.shuffle.algorithms)[number]['id']
export type ShuffleVerdictId = (typeof config.shuffle.verdicts)[number]['id']

export interface ShuffleOptions {
  algorithm?: string
  scale?: number
}

/** boardgame.io RandomAPI — only Number() is used for the float draws. */
export interface ShuffleRandom {
  Number(): number
}

const ORDERED_SUITS: Suit[] = ['S', 'H', 'D', 'C']
/** A high → 2 low, matching the plan's "table order". */
const ORDERED_RANKS: Rank[] = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2]

export function orderedDeck(): Card[] {
  return ORDERED_SUITS.flatMap((suit) =>
    ORDERED_RANKS.map((rank) => ({ id: `${suit}-${rank}`, suit, rank })),
  )
}

export function resolveAlgorithm(id: string | undefined): ShuffleAlgorithmId {
  const match = config.shuffle.algorithms.find((entry) => entry.id === id)
  return match?.id ?? config.shuffle.defaultAlgorithm
}

export function clampScale(scale: number | undefined): number {
  const { minScale, maxScale, defaultScale } = config.shuffle
  if (typeof scale !== 'number' || Number.isNaN(scale)) return defaultScale
  return Math.min(maxScale, Math.max(minScale, Math.round(scale)))
}

export function scaleToAlpha(scale: number): number {
  const { minScale, maxScale } = config.shuffle
  return (clampScale(scale) - minScale) / (maxScale - minScale)
}

function algorithmMeta(id: ShuffleAlgorithmId) {
  return config.shuffle.algorithms.find((entry) => entry.id === id)!
}

function sortKey(
  algorithm: ShuffleAlgorithmId,
  index: number,
  n: number,
  alpha: number,
  r: number,
): number {
  const tieBreak = index * 1e-12
  if (algorithm === 'localMix') {
    return (1 - alpha) * index + alpha * r + tieBreak
  }
  const normalized = n <= 1 ? 0 : index / (n - 1)
  return (1 - alpha) * normalized + alpha * r + tieBreak
}

/**
 * Weighted interpolation shuffle. S=1 → identity; S=10 → fully random for the method.
 * Uses boardgame.io's seeded RNG so every client sees the same deal.
 */
export function shuffleDeck(
  deck: Card[],
  options: ShuffleOptions,
  random: ShuffleRandom,
): Card[] {
  const algorithm = resolveAlgorithm(options.algorithm)
  const scale = clampScale(options.scale)
  const alpha = scaleToAlpha(scale)
  const n = deck.length

  if (alpha === 0) return deck.slice()

  const keyed = deck.map((card, index) => ({
    card,
    key: sortKey(algorithm, index, n, alpha, random.Number()),
  }))
  keyed.sort((a, b) => a.key - b.key)
  return keyed.map((entry) => entry.card)
}

function spearmanOrderScore(original: Card[], shuffled: Card[]): number {
  const n = original.length
  if (n <= 1) return 1
  const originalIndex = new Map(original.map((card, index) => [card.id, index]))
  let sumD2 = 0
  shuffled.forEach((card, newIndex) => {
    const oldIndex = originalIndex.get(card.id) ?? newIndex
    const d = oldIndex - newIndex
    sumD2 += d * d
  })
  return 1 - (6 * sumD2) / (n * (n * n - 1))
}

function clumpScore(shuffled: Card[]): number {
  if (shuffled.length < 2) return 0
  let same = 0
  for (let index = 1; index < shuffled.length; index += 1) {
    if (shuffled[index].suit === shuffled[index - 1].suit) same += 1
  }
  return same / (shuffled.length - 1)
}

function verdictFor(orderScore: number): { id: ShuffleVerdictId; label: string } {
  for (const entry of config.shuffle.verdicts) {
    if (orderScore >= entry.maxOrder) return { id: entry.id, label: entry.label }
  }
  const last = config.shuffle.verdicts[config.shuffle.verdicts.length - 1]
  return { id: last.id, label: last.label }
}

/** Mean absolute distance each card moved from its original index. */
export function meanDisplacement(original: Card[], shuffled: Card[]): number {
  const originalIndex = new Map(original.map((card, index) => [card.id, index]))
  let total = 0
  shuffled.forEach((card, newIndex) => {
    total += Math.abs((originalIndex.get(card.id) ?? newIndex) - newIndex)
  })
  return shuffled.length === 0 ? 0 : total / shuffled.length
}

export function shuffleReport(
  original: Card[],
  shuffled: Card[],
  options: ShuffleOptions,
): ShuffleReport {
  const algorithm = resolveAlgorithm(options.algorithm)
  const scale = clampScale(options.scale)
  const alpha = scaleToAlpha(scale)
  const orderScore = spearmanOrderScore(original, shuffled)
  const clump = clumpScore(shuffled)
  const verdict = verdictFor(orderScore)
  const meta = algorithmMeta(algorithm)

  return {
    algorithm,
    algorithmLabel: meta.label,
    scale,
    alpha,
    orderScore,
    clumpScore: clump,
    verdict: verdict.id,
    verdictLabel: verdict.label,
  }
}

export function formatShuffleReport(report: ShuffleReport): string {
  return `${report.algorithmLabel} · ${report.scale}/${config.shuffle.maxScale} · ${report.verdictLabel}`
}
