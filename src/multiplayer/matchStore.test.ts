import { describe, expect, it } from 'vitest'
import { createMatchStore } from './matchStore'
import { InMemory } from './memoryStorage'
import { SqliteStorage } from './sqliteStorage'

describe('createMatchStore', () => {
  it('builds the sqlite backend', () => {
    expect(createMatchStore('sqlite')).toBeInstanceOf(SqliteStorage)
  })

  it('builds the memory backend', () => {
    expect(createMatchStore('memory')).toBeInstanceOf(InMemory)
  })
})
