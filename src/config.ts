/**
 * Single source of configuration for the whole app (client + server).
 * Change values here only; nothing else should hard-code these numbers.
 */
export const config = {
  game: {
    /** boardgame.io game name; also used in lobby API URLs. */
    name: 'bhabhi-thulla',
    minPlayers: 3,
    maxPlayers: 8,
    /** How many recent events the server keeps in state. */
    eventHistory: 5,
    /** When false, the leader can take the next hand immediately (classic). */
    defaultTakeRequiresPermission: false,
  },

  shuffle: {
    minScale: 1,
    maxScale: 10,
    /** Default intensity — 10 matches a fully mixed deck. */
    defaultScale: 10,
    defaultAlgorithm: 'blendRandom' as const,
    algorithms: [
      {
        id: 'localMix' as const,
        label: 'Local mix',
        hint: 'Cards mostly stay near their original neighbors — a light table riffle.',
      },
      {
        id: 'blendRandom' as const,
        label: 'Blend to random',
        hint: 'Original order and a random order compete — mid settings mix the whole deck.',
      },
    ],
    /**
     * Verdict thresholds on orderScore (1 = still stacked, ~0 = random).
     * Checked from highest orderScore down.
     */
    verdicts: [
      { maxOrder: 0.85, id: 'stacked' as const, label: 'Stacked' },
      { maxOrder: 0.55, id: 'light' as const, label: 'Light mix' },
      { maxOrder: 0.3, id: 'mixed' as const, label: 'Mixed' },
      { maxOrder: 0.12, id: 'well' as const, label: 'Well shuffled' },
      { maxOrder: 0, id: 'random' as const, label: 'Random' },
    ],
  },

  timing: {
    /** A finished trick stays on the table at least this long before the winner can lead. */
    trickDisplayMinMs: 2000,
    /** A finished trick is cleared from the table after this long even if nobody plays. */
    trickDisplayMaxMs: 10000,
    /** Duration of a single picked-up card flying to the receiver. */
    pickupFlyMs: 650,
    /** Delay between each picked-up card starting its flight. */
    pickupFlyStaggerMs: 70,
    /** How long received cards glow in the receiver's hand. */
    receivedGlowMs: 2600,
    /** How often the table refreshes player names from the lobby API. */
    seatPollMs: 2500,
    /** "Copied!" feedback after tapping the game code. */
    copiedFeedbackMs: 1500,
    /** Full-name tooltip stays open this long after a tap on a player chip. */
    nameTipMs: 2200,
    /** How long the table shakes when someone becomes Bhabhi. */
    bhabhiShakeMs: 1400,
  },

  /** Phone vibration patterns (ms: vibrate, pause, vibrate, …). No-ops on desktop. */
  haptics: {
    /** Sharp double-buzz when a Thulla is played. */
    thulla: [40, 40, 90, 50, 180],
    /** Extra kick on the phone of the player who must pick up. */
    thullaReceiver: [60, 40, 60, 40, 120, 60, 220],
    /** Dramatic pattern when someone is named Bhabhi. */
    bhabhi: [80, 60, 80, 60, 160, 100, 320],
    /** Soft ping when someone asks to take your cards. */
    takeAsk: [50, 40, 80],
    /** Buzz when a take request is rejected (everyone). */
    takeReject: [70, 50, 70, 50, 140],
  },

  /** Playful roast when the last player left holding cards is named Bhabhi. */
  roast: {
    /** Taunts shown to winners watching the loser. {name} = loser display name. */
    winnerTaunts: [
      '{name} is the Bhabhi!',
      'Someone call {name}… Bhabhi!',
      '{name} got stuck with the cards!',
      'Bhabhi alert: {name}!',
      '{name} — last one standing. Classic.',
    ],
    /** Taunts shown on the loser’s own phone. */
    loserTaunts: [
      'You are the Bhabhi!',
      'Welp. You’re Bhabhi.',
      'All that and you’re still Bhabhi.',
      'The cards chose you. Bhabhi.',
      'Everyone’s staring. You’re Bhabhi.',
    ],
    /** Public roast when a take request is rejected. {name} = rejected requester. */
    takeRejectTaunts: [
      '{name} got shut down!',
      'No cards for {name}!',
      '{name} asked. The answer was no.',
      'Denied! {name} walks away empty.',
      '{name} tried it. Bold. Failed.',
    ],
  },

  server: {
    defaultPort: 8000,
    /** Allowed browser origins when CLIENT_ORIGINS env is not set. */
    defaultOrigins: ['*'],
  },

  storage: {
    sessionKey: 'bhabhi-session',
  },

  chat: {
    /** Max characters per message after trim. */
    maxLength: 200,
    /** How many messages to keep in memory / sessionStorage. */
    historyCap: 80,
    /** sessionStorage key prefix; matchID is appended. */
    storageKey: 'bhabhi-chat',
  },
} as const

export type AppConfig = typeof config
