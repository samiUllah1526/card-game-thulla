<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import type { BhabhiState, Card, LobbySeat, Session, Suit } from '../games/bhabhi-thulla/types'
  import type { GameConnection, GameSnapshot } from '../multiplayer/gameClient'
  import { getSeats } from '../multiplayer/lobby'
  import { legalCards } from '../games/bhabhi-thulla/rules'

  export let session: Session
  export let connection: GameConnection
  export let onLeave: () => void

  let state: GameSnapshot | null = null
  let seats: LobbySeat[] = []
  let selectedCard = ''
  let copied = false
  let poll: number | undefined

  const unsubscribe = connection.state.subscribe((value) => (state = value))
  onDestroy(() => {
    unsubscribe()
    if (poll) window.clearInterval(poll)
  })

  onMount(() => {
    refreshSeats()
    poll = window.setInterval(refreshSeats, 2500)
  })

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

  function cardLabel(card: Card): string {
    const ranks: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }
    const suits: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' }
    return `${ranks[card.rank] ?? card.rank}${suits[card.suit]}`
  }

  function isRed(card: Card): boolean {
    return card.suit === 'H' || card.suit === 'D'
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
    window.setTimeout(() => (copied = false), 1500)
  }

  function statusText(G: BhabhiState): string {
    if (G.phase === 'finished') return `${nameFor(G.bhabhi!)} is Bhabhi`
    if (!G.started) return session.playerID === '0' ? 'Start when everyone has joined' : 'Waiting for the host'
    if (G.turnPlayer === session.playerID) {
      if (G.phase === 'preTrick') return 'You have the power — lead a card'
      return G.ledSuit ? `Your turn — follow ${G.ledSuit}` : 'Your turn'
    }
    return `${nameFor(G.turnPlayer)} is playing`
  }
</script>

{#if !state}
  <main class="loading page"><div class="spinner"></div><p>Connecting to the table…</p></main>
{:else}
  {@const G = state.G}
  {@const myHand = [...(G.hands[session.playerID] ?? [])].sort((a, b) => a.suit.localeCompare(b.suit) || a.rank - b.rank)}
  {@const legal = new Set(legalCards(myHand, G.ledSuit).map((card) => card.id))}
  {@const myTurn = G.started && G.turnPlayer === session.playerID && G.phase !== 'finished'}

  <main class="table-page">
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
            disabled={seats.length < 3 || seats.some((seat) => !seat.name)}
            on:click={connection.moves.startGame}
          >Start game</button>
        {:else}
          <div class="waiting-pill">Waiting for the host to start…</div>
        {/if}
      </section>
    {:else}
      <section class="opponents" aria-label="Other players">
        {#each G.active.filter((id) => id !== session.playerID) as playerID}
          <div class:turn={G.turnPlayer === playerID} class:power={G.leader === playerID} class="opponent">
            <div class="avatar">{nameFor(playerID).slice(0, 1).toUpperCase()}</div>
            <strong>{nameFor(playerID)}</strong>
            <span>▰ {G.handCounts[playerID]}</span>
            {#if G.leader === playerID}<small>POWER</small>{/if}
          </div>
        {/each}
        {#each G.gotAway.filter((id) => id !== session.playerID) as playerID}
          <div class="opponent escaped">
            <div class="avatar">✓</div><strong>{nameFor(playerID)}</strong><span>Got away</span>
          </div>
        {/each}
      </section>

      <section class="play-area">
        <div class="status" class:mine={myTurn}>
          <span class="status-dot"></span>{statusText(G)}
        </div>
        <div class="trick">
          {#if G.trick.length === 0}
            <div class="empty-trick"><span>♠</span><p>Waiting for the lead</p></div>
          {:else}
            {#each G.trick as play (play.playerID)}
              <div class="played-card">
                <small>{nameFor(play.playerID)}</small>
                <div class:red={isRed(play.card)} class="card-face">{cardLabel(play.card)}</div>
              </div>
            {/each}
          {/if}
        </div>
        {#if G.events.length}
          <p class="event">{G.events[G.events.length - 1].text}</p>
        {/if}
      </section>

      <section class="hand-area">
        {#if G.phase === 'finished'}
          <div class="game-over">
            <p>Game over</p>
            <h2>{G.bhabhi === session.playerID ? 'You are Bhabhi' : `${nameFor(G.bhabhi!)} is Bhabhi`}</h2>
            <button class="secondary" on:click={onLeave}>Back to lobby</button>
          </div>
        {:else}
          <div class="hand-head">
            <span>Your hand</span><strong>{myHand.length} cards</strong>
          </div>
          {#if myTurn && G.phase === 'preTrick'}
            <button class="take-button" on:click={connection.moves.takeLeftHand}>
              Take {nameFor(G.active[(G.active.indexOf(session.playerID) + 1) % G.active.length])}’s cards
            </button>
          {/if}
          <div class="hand" aria-label="Your cards">
            {#each myHand as card (card.id)}
              <button
                class="playing-card"
                class:red={isRed(card)}
                class:selected={selectedCard === card.id}
                class:illegal={!myTurn || !legal.has(card.id)}
                on:click={() => selectCard(card, legal)}
                disabled={!myTurn || !legal.has(card.id)}
              >
                <span>{cardLabel(card)}</span>
                <b>{cardLabel(card).slice(-1)}</b>
              </button>
            {/each}
          </div>
          {#if selectedCard}
            <button class="primary play-button" on:click={playSelected}>Play selected card</button>
          {/if}
        {/if}
      </section>
    {/if}
  </main>
{/if}
