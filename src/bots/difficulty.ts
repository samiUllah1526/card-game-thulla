import { config } from '../config'
import type { BotDifficulty } from '../games/bhabhi-thulla/types'

export type { BotDifficulty }

export function isBotDifficulty(value: unknown): value is BotDifficulty {
  return config.bots.levels.some((level) => level.id === value)
}

export function thinkRange(id: BotDifficulty): readonly [number, number] {
  const range = config.bots.thinkMs[id]
  return [range[0], range[1]]
}
