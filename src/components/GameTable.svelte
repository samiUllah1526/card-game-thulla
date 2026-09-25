<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { flip } from 'svelte/animate'
  import { fade, fly, scale } from 'svelte/transition'
  import { cubicIn, cubicOut } from 'svelte/easing'
  import { config } from '../config'
  import type {
    BhabhiState,
    Card,
    GameEvent,
    LobbySeat,
    PickupEvent,
    ResolvedTrick,
    Session,
    Suit,
  } from '../games/bhabhi-thulla/types'
  import type { GameConnection, GameSnapshot } from '../multiplayer/gameClient'
  import { getSeats } from '../multiplayer/lobby'
  import { legalCards } from '../games/bhabhi-thulla/rules'
  import { formatShuffleReport } from '../games/bhabhi-thulla/shuffle'

  export let session: Session
  export let connection: GameConnection
  export let onLeave: () => void

  const { timing, haptics, roast } = config

  let state: GameSnapshot | null = null
  let seats: LobbySeat[] = []
  let selectedCard = ''
  let copied = false
  let poll: number | undefined
  let timers: number[] = []

  // ---- Thulla pickup ------------------------------------------------------
  // The overlay is driven by server state (lastPickup.dismissed). When the
  // receiver dismisses it, every client plays the same "fly to receiver" exit.
  let flyingPickup: PickupEvent | null = null
  let flyTo = { x: 0, y: 0 }
  let receivedIDs = new Set<string>()
  let landedFor: string | null = null
  let overlayEl: HTMLElement | undefined
  let handEl: HTMLElement | undefined
  let chipEls: Record<string, HTMLElement> = {}
  let wasPending = false
  let pendingID = 0
  let seenPickupBuzz = 0

  // ---- Last completed trick ----------------------------------------------
  // Stays on the table between trickDisplayMinMs and trickDisplayMaxMs.
  let shownTrick: ResolvedTrick | null = null
  let trickLocked = false
  let seenTrickID: number | null = null
  let trickTimers: number[] = []

  // ---- Full-name tooltip on player chips ---------------------------------
  let openNameFor: string | null = null
  let nameTimer: number | undefined

  // ---- Bhabhi roast ------------------------------------------------------
  let roastOpen = false
  let roastTaunt = ''
  let shaking = false
  let sawFinished = false

  // ---- Take-reject roast -------------------------------------------------
  let takeRejectTaunt = ''
  let seenTakeAskID = 0
  let seenTakeRejectID = 0

  const unsubscribe = connection.state.subscribe((value) => {
    const G = value?.G
    if (G) {
      // Pickup: buzz on a new Thulla; fly-out when the receiver dismisses.
      const pickup = G.lastPickup
      const pending = !!pickup && !pickup.dismissed
      if (pending && pickup && pickup.id !== seenPickupBuzz) {
        seenPickupBuzz = pickup.id
        vibrate(
          pickup.receiver === session.playerID
            ? haptics.thullaReceiver
            : haptics.thulla,
        )
      }
      if (wasPending && !pending && pickup && pickup.id === pendingID) {
        prepareFly(pickup)
        void runFly(pickup)
      }
      wasPending = pending
      pendingID = pickup?.id ?? 0

      // Take ask: buzz the recipient once.
      const ask = G.pendingTake
      if (ask && ask.id !== seenTakeAskID) {
        seenTakeAskID = ask.id
        if (ask.to === session.playerID) vibrate(haptics.takeAsk)
      }

      // Take reject: public roast + shake + buzz.
      const reject = G.lastTakeReject
      if (reject && !reject.dismissed && reject.id !== seenTakeRejectID) {
        seenTakeRejectID = reject.id
        const list = roast.takeRejectTaunts
        const template = list[Math.floor(Math.random() * list.length)]
        takeRejectTaunt = template.replaceAll('{name}', nameFor(reject.from))
        shaking = true
        vibrate(haptics.takeReject)
        timers.push(
          window.setTimeout(() => {
            shaking = false
          }, timing.bhabhiShakeMs),
        )
      }

      // Completed trick: show it when a new one is recorded.
      const trick = G.lastTrick
      if (seenTrickID === null) {
        seenTrickID = trick?.id ?? 0
      } else if (trick && trick.id !== seenTrickID) {
        seenTrickID = trick.id
        showTrick(trick)
      }

      // Game over: one-shot roast + shake + vibration.
      if (G.phase === 'finished' && G.bhabhi && !sawFinished) {
        sawFinished = true
        startRoast(G.bhabhi)
      }
    }
    state = value
  })

  function vibrate(pattern: readonly number[]) {
    try {
      navigator.vibrate?.([...pattern])
    } catch {
      // Vibration is optional; many desktops have no API.
    }
  }

  function startRoast(bhabhiID: string) {
    const mine = bhabhiID === session.playerID
    const list = mine ? roast.loserTaunts : roast.winnerTaunts
    const template = list[Math.floor(Math.random() * list.length)]
    roastTaunt = template.replaceAll('{name}', nameFor(bhabhiID))
    roastOpen = true
    shaking = true
    vibrate(haptics.bhabhi)
    timers.push(
      window.setTimeout(() => {
        shaking = false
      }, timing.bhabhiShakeMs),
    )
  }

  function dismissRoast() {
    roastOpen = false
  }

  onDestroy(() => {
    unsubscribe()
    if (poll) window.clearInterval(poll)
    if (nameTimer) window.clearTimeout(nameTimer)
    ;[...timers, ...trickTimers].forEach((id) => window.clearTimeout(id))
  })

  onMount(() => {
    refreshSeats()
    poll = window.setInterval(refreshSeats, timing.seatPollMs)
  })

  function wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      timers.push(window.setTimeout(resolve, ms))
    })
  }

  function prepareFly(event: PickupEvent) {
    const mine = event.receiver === session.playerID
    const target = mine ? handEl : chipEls[event.receiver]
    if (overlayEl && target) {
      const from = overlayEl.getBoundingClientRect()
      const to = target.getBoundingClientRect()
      flyTo = {
        x: to.left + to.width / 2 - (from.left + from.width / 2),
        y: to.top + to.height / 2 - (from.top + from.height / 2),
      }
    } else {
      flyTo = { x: 0, y: mine ? 260 : -220 }
    }
    flyingPickup = event
  }

  async function runFly(event: PickupEvent) {
    await wait(timing.pickupFlyMs + timing.pickupFlyStaggerMs * event.cards.length)
    flyingPickup = null
    receivedIDs = new Set(event.cards.map((card) => card.id))
    landedFor = event.receiver
    await wait(timing.receivedGlowMs)
    receivedIDs = new Set()
    landedFor = null
  }

  function showTrick(trick: ResolvedTrick) {
    trickTimers.forEach((id) => window.clearTimeout(id))
    shownTrick = trick
    trickLocked = true
    trickTimers = [
      window.setTimeout(() => (trickLocked = false), timing.trickDisplayMinMs),
      window.setTimeout(() => {
        if (shownTrick?.id === trick.id) shownTrick = null
      }, timing.trickDisplayMaxMs),
    ]
  }

  /** Custom transition: slide toward (x, y) and shrink, staying opaque until the end. */
  function flyToTarget(
    _node: Element,
    params: { x: number; y: number; duration: number; delay: number },
  ) {
    return {
      duration: params.duration,
      delay: params.delay,
      easing: cubicIn,
      css: (t: number) => {
        const p = 1 - t
        return `transform: translate(${p * params.x}px, ${p * params.y}px) scale(${1 - p * 0.55}); opacity: ${t < 0.15 ? t / 0.15 : 1}`
      },
    }
  }

  // ---- Helpers -----------------------------------------------------------
  async function refreshSeats() {
    try {
      seats = await getSeats(session.matchID)
    } catch {
      // The socket may still be connected during a short lobby API interruption.
    }
  }

  function nameFor(playerID: string): string {
    return seats.find((seat) => String(seat.id) === playerID)?.name ?? `Player ${Number(playerID) + 1}`
  }

  function suitName(suit: Suit): string {
    return { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' }[suit]
  }

  function cardLabel(card: Card): string {
    const ranks: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }
    const suits: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' }
    return `${ranks[card.rank] ?? card.rank}${suits[card.suit]}`
  }

  function isRed(card: Card): boolean {
    return card.suit === 'H' || card.suit === 'D'
  }

  function describe(event: GameEvent): string {
    switch (event.type) {
      case 'waiting':
        return 'Waiting for the host to start'
      case 'firstLead':
        return `${nameFor(event.player)} has the Ace of Spades and leads`
      case 'firstTrickWaste':
        return `First trick goes to waste — ${nameFor(event.leader)} leads again`
      case 'trickWon':
        return `${nameFor(event.winner)} won the trick`
      case 'thulla':
        return `Thulla! ${nameFor(event.giver)} gave ${event.count} cards to ${nameFor(event.receiver)}`
      case 'gotAway':
        return `${nameFor(event.player)} got away`
      case 'took':
        return `${nameFor(event.taker)} took all ${event.count} of ${nameFor(event.victim)}’s cards`
      case 'takeAsked':
        return `${nameFor(event.from)} asked to take ${nameFor(event.to)}’s cards`
      case 'takeAccepted':
        return `${nameFor(event.to)} let ${nameFor(event.from)} take ${event.count} cards`
      case 'takeRejected':
        return `${nameFor(event.to)} rejected ${nameFor(event.from)}’s take`
      case 'bhabhi':
        return `${nameFor(event.player)} is Bhabhi`
    }
  }

  function selectCard(card: Card, legal: Set<string>) {
    if (!legal.has(card.id)) return
    selectedCard = selectedCard === card.id ? '' : card.id
  }

  function playSelected() {
    if (!selectedCard) return
    connection.moves.playCard(selectedCard)
    selectedCard = ''
  }

  async function copyCode() {
    await navigator.clipboard.writeText(session.matchID)
    copied = true
    window.setTimeout(() => (copied = false), timing.copiedFeedbackMs)
  }

  function toggleName(playerID: string) {
    if (nameTimer) window.clearTimeout(nameTimer)
    openNameFor = openNameFor === playerID ? null : playerID
    if (openNameFor) nameTimer = window.setTimeout(() => (openNameFor = null), timing.nameTipMs)
  }

  function statusText(
    G: BhabhiState,
    pendingPickup: PickupEvent | null,
    pendingTake: BhabhiState['pendingTake'] | null | undefined,
    pendingReject: BhabhiState['lastTakeReject'] | null | undefined,
    canAct: boolean,
  ): string {
    if (G.phase === 'finished') return `${nameFor(G.bhabhi!)} is Bhabhi`
    if (!G.started) return session.playerID === '0' ? 'Start when everyone has joined' : 'Waiting for the host'
    if (pendingPickup) {
      return pendingPickup.receiver === session.playerID
        ? `You picked up ${pendingPickup.cards.length} cards — tap Continue`
        : `${nameFor(pendingPickup.receiver)} picks up ${pendingPickup.cards.length} cards`
    }
    if (pendingTake) {
      return pendingTake.to === session.playerID
        ? `${nameFor(pendingTake.from)} wants your cards — Accept or Reject`
        : `Waiting for ${nameFor(pendingTake.to)} to answer ${nameFor(pendingTake.from)}’s take request`
    }
    if (pendingReject && !pendingReject.dismissed) {
      return pendingReject.from === session.playerID
        ? 'Your take was denied — tap Continue'
        : `Waiting for ${nameFor(pendingReject.from)} to recover…`
    }
    if (G.turnPlayer === session.playerID) {
      if (!canAct) return 'Get ready — your lead is next'
      if (G.phase === 'preTrick') return 'You have the power — lead a card'
      return G.ledSuit ? `Your turn — follow ${suitName(G.ledSuit)}` : 'Your turn'
    }
    return `${nameFor(G.turnPlayer)} is playing`
  }

  function registerChip(node: HTMLElement, playerID: string) {
    chipEls[playerID] = node
    return {
      destroy() {
        delete chipEls[playerID]
      },
    }
  }
</script>

{#if !state}
  <main class="loading page"><div class="spinner"></div><p>Connecting to the table…</p></main>
{:else}
  {@const G = state.G}
  {@const pendingPickup = G.lastPickup && !G.lastPickup.dismissed ? G.lastPickup : null}
  {@const pendingTake = G.pendingTake}
  {@const pendingReject = G.lastTakeReject && !G.lastTakeReject.dismissed ? G.lastTakeReject : null}
  {@const activePickup = pendingPickup ?? flyingPickup}
  {@const receivingMine = activePickup?.receiver === session.playerID}
  {@const hiddenIDs = new Set(receivingMine ? activePickup!.cards.map((card) => card.id) : [])}
  {@const myHand = [...(G.hands[session.playerID] ?? [])]
    .filter((card) => !hiddenIDs.has(card.id))
    .sort((a, b) => a.suit.localeCompare(b.suit) || a.rank - b.rank)}
  {@const legal = new Set(legalCards(myHand, G.ledSuit).map((card) => card.id))}
  {@const isMyTurn = G.started && G.turnPlayer === session.playerID && G.phase !== 'finished'}
  {@const takeBlocked = !!pendingTake || !!pendingReject}
  {@const canAct = isMyTurn && !activePickup && !takeBlocked && !(trickLocked && shownTrick && G.trick.length === 0)}
  {@const nextVictim = G.active[(G.active.indexOf(session.playerID) + 1) % G.active.length]}
  {@const lastEvent = G.events[G.events.length - 1]}
  {@const showLastTrick = shownTrick && G.trick.length === 0 && !activePickup && !pendingTake && !pendingReject}

  <main class="table-page" class:shaking class:finished={G.phase === 'finished'}>
    <header class="table-header">
      <button class="icon-button" on:click={onLeave} aria-label="Leave table">←</button>
      <div>
        <p class="eyebrow">Game code</p>
        <button class="code" on:click={copyCode}>{copied ? 'Copied!' : session.matchID}</button>
      </div>
      <div class="waste"><span>▧</span><strong>{G.wasteCount}</strong><small>waste</small></div>
    </header>

    {#if !G.started}
      <section class="waiting-card">
        <div class="pulse">♠</div>
        <h1>Players are joining</h1>
        <p>Share the game code with friends. The game can start when every chosen seat is filled.</p>
        {#if G.shuffleReport}
          <div class="shuffle-report" class:stacked={G.shuffleReport.verdict === 'stacked'} class:random={G.shuffleReport.verdict === 'random' || G.shuffleReport.verdict === 'well'}>
            <p class="shuffle-kicker">Deck shuffle</p>
            <strong>{formatShuffleReport(G.shuffleReport)}</strong>
            <p>
              {#if G.shuffleReport.verdict === 'stacked'}
                Cards are still nearly in order — expect long suit runs.
              {:else if G.shuffleReport.verdict === 'light'}
                Light mix — some suit clumps remain.
              {:else if G.shuffleReport.verdict === 'mixed'}
                Cards are somewhat mixed; a few suit clumps remain.
              {:else if G.shuffleReport.verdict === 'well'}
                Well shuffled — suits are spread out.
              {:else}
                Fully mixed deck.
              {/if}
            </p>
          </div>
        {/if}
        {#if G.takeRequiresPermission}
          <p class="house-rule">House rule: takes need permission</p>
        {/if}
        <div class="seat-list">
          {#each seats as seat}
            <div class:filled={seat.name}>
              <span>{seat.name ? seat.name.slice(0, 1).toUpperCase() : seat.id + 1}</span>
              <p>{seat.name ?? 'Empty seat'}</p>
              {#if String(seat.id) === '0'}<small>Host</small>{/if}
            </div>
          {/each}
        </div>
        {#if session.playerID === '0'}
          <button
            class="primary"
            disabled={seats.length < config.game.minPlayers || seats.some((seat) => !seat.name)}
            on:click={connection.moves.startGame}
          >Start game</button>
        {:else}
          <div class="waiting-pill">Waiting for the host to start…</div>
        {/if}
      </section>
    {:else}
      <section class="opponents" aria-label="Other players">
        {#each G.active.filter((id) => id !== session.playerID) as playerID (playerID)}
          <button
            type="button"
            class="opponent"
            class:turn={G.turnPlayer === playerID && !activePickup}
            class:power={G.leader === playerID}
            class:giver={activePickup?.giver === playerID}
            class:receiver={activePickup?.receiver === playerID}
            class:landed={landedFor === playerID}
            class:bhabhi={G.phase === 'finished' && G.bhabhi === playerID}
            class:show-name={openNameFor === playerID}
            title={nameFor(playerID)}
            aria-label={`${nameFor(playerID)}, ${G.handCounts[playerID]} cards`}
            on:click={() => toggleName(playerID)}
            use:registerChip={playerID}
            animate:flip={{ duration: 300 }}
          >
            <span class="name-tip" role="tooltip">{nameFor(playerID)}</span>
            <div class="avatar">{nameFor(playerID).slice(0, 1).toUpperCase()}</div>
            <strong class="player-name">{nameFor(playerID)}</strong>
            <span class="count">
              ▰ {G.handCounts[playerID]}
              {#if landedFor === playerID && receivedIDs.size}
                <em class="bump" in:fly={{ y: 10, duration: 250 }} out:fade>+{receivedIDs.size}</em>
              {/if}
            </span>
            {#if G.leader === playerID && !activePickup}<small class="tag power-tag">POWER</small>{/if}
            {#if activePickup?.giver === playerID}
              <small class="tag thulla-tag" in:scale={{ start: 1.8, duration: 300 }}>THULLA</small>
            {/if}
            {#if activePickup?.receiver === playerID}
              <small class="tag receive-tag" in:scale={{ start: 1.8, duration: 300 }}>PICKS UP</small>
            {/if}
            {#if G.phase === 'finished' && G.bhabhi === playerID}
              <small class="tag bhabhi-tag" in:scale={{ start: 2, duration: 400 }}>BHABHI</small>
            {/if}
          </button>
        {/each}
        {#each G.gotAway.filter((id) => id !== session.playerID) as playerID (playerID)}
          <button
            type="button"
            class="opponent escaped"
            class:show-name={openNameFor === playerID}
            title={nameFor(playerID)}
            on:click={() => toggleName(playerID)}
            animate:flip={{ duration: 300 }}
          >
            <span class="name-tip" role="tooltip">{nameFor(playerID)}</span>
            <div class="avatar">✓</div><strong class="player-name">{nameFor(playerID)}</strong><span>Got away</span>
          </button>
        {/each}
      </section>

      <section class="play-area">
        <div class="status" class:mine={canAct || pendingTake?.to === session.playerID || pendingReject?.from === session.playerID}>
          <span class="status-dot"></span>
          {statusText(G, pendingPickup, pendingTake, pendingReject, canAct)}
        </div>

        <div class="trick">
          {#if G.trick.length === 0 && !showLastTrick && !activePickup}
            <div class="empty-trick" in:fade={{ duration: 200 }}><span>♠</span><p>Waiting for the lead</p></div>
          {:else if showLastTrick && shownTrick}
            <div class="resolved-trick" out:fade={{ duration: 250 }}>
              {#each shownTrick.plays as play (play.playerID)}
                <div class="played-card" class:winner={play.playerID === shownTrick.winner}>
                  <small class:highlight={play.playerID === shownTrick.winner} title={nameFor(play.playerID)}>
                    {nameFor(play.playerID)}
                  </small>
                  <div class:red={isRed(play.card)} class="card-face">{cardLabel(play.card)}</div>
                  {#if play.playerID === shownTrick.winner}<b class="win-tag">WINS</b>{/if}
                </div>
              {/each}
              <p class="resolved-note">
                Trick goes to waste
                {#if trickLocked}
                  · clearing soon
                {:else if G.turnPlayer === session.playerID}
                  · play a card to continue
                {/if}
              </p>
            </div>
          {:else}
            {#each G.trick as play (play.playerID)}
              <div class="played-card" in:fly={{ y: 60, duration: 320, easing: cubicOut }}>
                <small class:highlight={G.turnPlayer === play.playerID} title={nameFor(play.playerID)}>
                  {nameFor(play.playerID)}
                </small>
                <div class:red={isRed(play.card)} class="card-face">{cardLabel(play.card)}</div>
              </div>
            {/each}
          {/if}

          {#if pendingPickup}
            <div class="pickup-overlay" bind:this={overlayEl} in:fade={{ duration: 150 }}>
              <div class="thulla-badge" in:scale={{ start: 2.4, duration: 420, easing: cubicOut }} out:fade={{ duration: 150 }}>
                THULLA!
              </div>
              <p class="pickup-title" in:fly={{ y: 12, duration: 300, delay: 150 }} out:fade={{ duration: 120 }}>
                {nameFor(pendingPickup.giver)} could not follow {suitName(pendingPickup.ledSuit)}
              </p>
              <div class="pickup-cards">
                {#each pendingPickup.cards as card, index (card.id)}
                  <div
                    class="card-face pickup-card"
                    class:red={isRed(card)}
                    class:thulla={card.id === pendingPickup.thullaCard.id}
                    in:fly={{ y: -24, duration: 260, delay: 80 * index }}
                    out:flyToTarget={{ x: flyTo.x, y: flyTo.y, duration: timing.pickupFlyMs, delay: timing.pickupFlyStaggerMs * index }}
                  >
                    {cardLabel(card)}
                    {#if card.id === pendingPickup.thullaCard.id}<span class="tag thulla-tag">THULLA</span>{/if}
                  </div>
                {/each}
              </div>
              <p class="pickup-sub" in:fade={{ delay: 400 }} out:fade={{ duration: 120 }}>
                <strong>{nameFor(pendingPickup.receiver)}</strong> picks up {pendingPickup.cards.length} cards
              </p>
              {#if pendingPickup.receiver === session.playerID}
                <button class="primary continue-button" on:click={connection.moves.dismissPickup} in:fly={{ y: 16, duration: 300, delay: 500 }} out:fade={{ duration: 120 }}>
                  Continue
                </button>
              {:else}
                <p class="pickup-wait" in:fade={{ delay: 600 }} out:fade={{ duration: 120 }}>
                  Waiting for {nameFor(pendingPickup.receiver)} to continue…
                </p>
              {/if}
            </div>
          {/if}
        </div>

        {#if lastEvent && !pendingPickup && !pendingTake && !pendingReject}
          {#key lastEvent.id}
            <div class="event-banner" class:thulla={lastEvent.type === 'thulla'} class:bhabhi={lastEvent.type === 'bhabhi'} in:fly={{ y: 14, duration: 320, easing: cubicOut }}>
              <span class="event-icon">
                {#if lastEvent.type === 'thulla'}!{:else if lastEvent.type === 'gotAway'}✓{:else if lastEvent.type === 'bhabhi'}★{:else if lastEvent.type === 'takeRejected'}✕{:else}♠{/if}
              </span>
              {describe(lastEvent)}
            </div>
          {/key}
        {/if}
      </section>

      <section class="hand-area" class:receiving={receivingMine} class:landed={landedFor === session.playerID}>
        {#if G.phase === 'finished'}
          <div class="game-over" class:loser={G.bhabhi === session.playerID}>
            <p>Game over</p>
            <h2>{G.bhabhi === session.playerID ? 'You are Bhabhi' : `${nameFor(G.bhabhi!)} is Bhabhi`}</h2>
            <p class="game-over-sub">{roastTaunt || (G.bhabhi === session.playerID ? 'Better luck next deal.' : 'Point and laugh responsibly.')}</p>
            <button class="secondary" on:click={onLeave}>Back to lobby</button>
          </div>
        {:else}
          <div class="hand-head">
            <span class:highlight={canAct}>{canAct ? 'Your turn' : 'Your hand'}</span>
            <strong>
              {myHand.length} cards
              {#if landedFor === session.playerID && receivedIDs.size}
                <em class="bump" in:fly={{ y: 8, duration: 250 }} out:fade>+{receivedIDs.size} picked up</em>
              {/if}
            </strong>
          </div>
          {#if receivingMine && activePickup}
            <div class="received-banner" in:fly={{ y: 20, duration: 300 }} out:fade={{ duration: 200 }}>
              You picked up the Thulla — {activePickup.cards.length} cards added
            </div>
          {/if}
          {#if pendingTake?.to === session.playerID}
            <div class="take-ask-banner" role="alertdialog" aria-label="Take request" in:fly={{ y: 16, duration: 280 }}>
              <p><strong>{nameFor(pendingTake.from)}</strong> wants to take all your cards</p>
              <div class="take-ask-actions">
                <button class="accept-button" on:click={() => connection.moves.respondTake(true)}>Accept</button>
                <button class="reject-button" on:click={() => connection.moves.respondTake(false)}>Reject</button>
              </div>
            </div>
          {/if}
          {#if canAct && G.phase === 'preTrick' && nextVictim}
            <button class="take-button" on:click={connection.moves.takeLeftHand}>
              {G.takeRequiresPermission
                ? `Ask to take ${nameFor(nextVictim)}’s cards`
                : `Take ${nameFor(nextVictim)}’s cards`}
            </button>
          {:else if isMyTurn && G.phase === 'preTrick' && takeBlocked && G.leader === session.playerID}
            <button class="take-button" disabled>
              {pendingTake
                ? `Waiting for ${nameFor(pendingTake.to)}…`
                : 'Waiting…'}
            </button>
          {/if}
          <div class="hand" aria-label="Your cards" bind:this={handEl}>
            {#each myHand as card (card.id)}
              <button
                class="playing-card"
                class:red={isRed(card)}
                class:selected={selectedCard === card.id}
                class:illegal={!canAct || !legal.has(card.id)}
                class:received={receivedIDs.has(card.id)}
                on:click={() => selectCard(card, legal)}
                disabled={!canAct || !legal.has(card.id)}
                in:fly={{ y: -50, duration: 380, easing: cubicOut }}
                animate:flip={{ duration: 320 }}
              >
                <span>{cardLabel(card)}</span>
                <b>{cardLabel(card).slice(-1)}</b>
              </button>
            {/each}
          </div>
          {#if selectedCard && canAct}
            <button class="primary play-button" on:click={playSelected} in:fly={{ y: 10, duration: 200 }}>
              Play selected card
            </button>
          {/if}
        {/if}
      </section>
    {/if}

    {#if pendingReject}
      <div
        class="roast-overlay deny-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Take denied"
        in:fade={{ duration: 180 }}
        out:fade={{ duration: 220 }}
      >
        <div class="roast-card deny-card" in:scale={{ start: 0.55, duration: 520, easing: cubicOut }}>
          <span class="roast-stamp deny-stamp" in:scale={{ start: 2.6, duration: 480, easing: cubicOut }}>DENIED</span>
          <div class="roast-avatar" aria-hidden="true">
            {nameFor(pendingReject.from).slice(0, 1).toUpperCase()}
          </div>
          <p class="roast-kicker">Take request rejected</p>
          <h2 class="roast-name">{nameFor(pendingReject.from)}</h2>
          <p class="roast-taunt">{takeRejectTaunt || `${nameFor(pendingReject.from)} got shut down!`}</p>
          {#if pendingReject.from === session.playerID}
            <button class="primary roast-dismiss" on:click={connection.moves.dismissTakeReject}>
              Continue
            </button>
          {:else}
            <p class="pickup-wait">Waiting for {nameFor(pendingReject.from)} to recover…</p>
          {/if}
        </div>
      </div>
    {/if}

    {#if roastOpen && G.bhabhi}
      <div
        class="roast-overlay"
        class:loser={G.bhabhi === session.playerID}
        role="dialog"
        aria-modal="true"
        aria-label="Bhabhi roast"
        in:fade={{ duration: 180 }}
        out:fade={{ duration: 220 }}
      >
        <div class="roast-card" in:scale={{ start: 0.55, duration: 520, easing: cubicOut }}>
          <span class="roast-stamp" in:scale={{ start: 2.6, duration: 480, easing: cubicOut }}>BHABHI</span>
          <div class="roast-avatar" aria-hidden="true">
            {nameFor(G.bhabhi).slice(0, 1).toUpperCase()}
          </div>
          <p class="roast-kicker">
            {G.bhabhi === session.playerID ? 'That’s you' : 'We have a winner… of last place'}
          </p>
          <h2 class="roast-name">{nameFor(G.bhabhi)}</h2>
          <p class="roast-taunt">{roastTaunt}</p>
          <button class="primary roast-dismiss" on:click={dismissRoast}>
            {G.bhabhi === session.playerID ? 'Fine, I accept' : 'Keep roasting'}
          </button>
        </div>
      </div>
    {/if}
  </main>
{/if}
