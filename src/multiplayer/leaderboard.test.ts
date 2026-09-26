import { describe, expect, it } from 'vitest'
import { tallyLeaderboard } from './leaderboard'

describe('tallyLeaderboard', () => {
  it('counts got-away and bhabhi per seat', () => {
    const board = tallyLeaderboard(
      [
        { deal: 1, bhabhi: '2', gotAway: ['0', '1'], at: 1 },
        { deal: 2, bhabhi: '0', gotAway: ['1', '2'], at: 2 },
      ],
      [
        { id: 0, name: 'Ali' },
        { id: 1, name: 'Bea' },
        { id: 2, name: 'Cam' },
      ],
    )
    expect(board.players).toEqual([
      { playerID: '0', name: 'Ali', gotAway: 1, bhabhi: 1 },
      { playerID: '1', name: 'Bea', gotAway: 2, bhabhi: 0 },
      { playerID: '2', name: 'Cam', gotAway: 1, bhabhi: 1 },
    ])
  })
})
