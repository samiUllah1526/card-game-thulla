<script lang="ts">
  import { onDestroy } from 'svelte'
  import Lobby from './components/Lobby.svelte'
  import JoinGame from './components/JoinGame.svelte'
  import GameTable from './components/GameTable.svelte'
  import type { Session } from './games/bhabhi-thulla/types'
  import { connectGame, type GameConnection } from './multiplayer/gameClient'
  import { fetchMatchGate, fetchMe, registerSeat } from './multiplayer/authClient'
  import type { PublicUser } from './multiplayer/authTypes'
  import { clearSession, loadSession, parseJoinPath } from './multiplayer/lobby'

  const joinCodeAtLoad = parseJoinPath()
  const stored = loadSession()
  const reconnect = stored && (!joinCodeAtLoad || stored.matchID === joinCodeAtLoad) ? stored : null

  let joinCode: string | null = reconnect ? null : joinCodeAtLoad
  let session: Session | null = null
  let connection: GameConnection | null = null
  let user: PublicUser | null = null
  let authReady = false
  let gateReady = !reconnect
  let ended = false

  if (reconnect && joinCodeAtLoad) {
    history.replaceState({}, '', '/')
  }

  if (reconnect) {
    void (async () => {
      try {
        const gate = await fetchMatchGate(reconnect.matchID)
        if (gate.closed) {
          clearSession()
          ended = true
        } else {
          await registerSeat(reconnect).catch(() => {})
          session = reconnect
          connection = connectGame(reconnect)
        }
      } catch {
        session = reconnect
        connection = connectGame(reconnect)
      } finally {
        gateReady = true
      }
    })()
  }

  void fetchMe()
    .then((next) => {
      user = next
    })
    .catch(() => {
      user = null
    })
    .finally(() => {
      authReady = true
    })

  $: if (authReady && user && session) void registerSeat(session)

  async function sitDown(nextSession: Session) {
    connection?.stop()
    ended = false
    await registerSeat(nextSession).catch(() => {})
    session = nextSession
    connection = connectGame(nextSession)
    joinCode = null
    if (parseJoinPath()) history.replaceState({}, '', '/')
  }

  function leaveJoinPage() {
    joinCode = null
    if (parseJoinPath()) history.replaceState({}, '', '/')
    const existing = loadSession()
    if (existing) void sitDown(existing)
  }

  function leave() {
    connection?.stop()
    connection = null
    session = null
    clearSession()
    ended = false
  }

  function closeTable() {
    connection?.stop()
    connection = null
    session = null
    clearSession()
    ended = true
    joinCode = null
    if (parseJoinPath()) history.replaceState({}, '', '/')
  }

  function linkEnded() {
    const saved = loadSession()
    if (saved && joinCode && saved.matchID === joinCode) clearSession()
    ended = true
    joinCode = null
    if (parseJoinPath()) history.replaceState({}, '', '/')
  }

  function dismissEnded() {
    ended = false
  }

  onDestroy(() => connection?.stop())
</script>

{#if !gateReady || (joinCode && !authReady)}
  <main class="loading page"><div class="spinner"></div><p>Checking the table…</p></main>
{:else if ended}
  <main class="lobby page">
    <section class="panel ended-panel">
      <p class="eyebrow">Table closed</p>
      <h2>This table has ended</h2>
      <p>The score and chat stay stored with the server.</p>
      <button class="primary" type="button" on:click={dismissEnded}>Back to lobby</button>
    </section>
  </main>
{:else if session && connection}
  <GameTable {session} {connection} onLeave={leave} onClosed={closeTable} />
{:else if joinCode}
  <JoinGame
    code={joinCode}
    {user}
    onJoined={sitDown}
    onBack={leaveJoinPage}
    onEnded={linkEnded}
  />
{:else}
  <Lobby {user} onUser={(next) => (user = next)} onJoined={sitDown} />
{/if}
