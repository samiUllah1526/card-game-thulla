<script lang="ts">
  import { onDestroy } from 'svelte'
  import Lobby from './components/Lobby.svelte'
  import JoinGame from './components/JoinGame.svelte'
  import GameTable from './components/GameTable.svelte'
  import type { Session } from './games/bhabhi-thulla/types'
  import { connectGame, type GameConnection } from './multiplayer/gameClient'
  import { fetchMatchGate, fetchMe, openWatch, registerSeat } from './multiplayer/authClient'
  import type { PublicUser } from './multiplayer/authTypes'
  import { clearSession, loadSession, parseJoinPath, parseWatchPath } from './multiplayer/lobby'
  import type { WatchSnapshot } from './multiplayer/watchTypes'

  const joinCodeAtLoad = parseJoinPath()
  const watchAtLoad = parseWatchPath()
  const stored = loadSession()
  const reconnect =
    !watchAtLoad && stored && (!joinCodeAtLoad || stored.matchID === joinCodeAtLoad) ? stored : null

  let joinCode: string | null = reconnect || watchAtLoad ? null : joinCodeAtLoad
  let session: Session | null = null
  let connection: GameConnection | null = null
  let user: PublicUser | null = null
  let authReady = false
  let gateReady = !reconnect && !watchAtLoad
  let ended = false
  let watchingID: string | null = null
  let watchSnapshot: WatchSnapshot | null = null
  let stopWatch: (() => void) | null = null

  if (reconnect && joinCodeAtLoad) {
    history.replaceState({}, '', '/')
  }

  if (watchAtLoad) {
    void (async () => {
      try {
        const gate = await fetchMatchGate(watchAtLoad)
        if (gate.closed) ended = true
        else beginWatch(watchAtLoad)
      } catch {
        beginWatch(watchAtLoad)
      } finally {
        gateReady = true
      }
    })()
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

  function beginWatch(matchID: string) {
    connection?.stop()
    connection = null
    session = null
    joinCode = null
    ended = false
    watchingID = matchID
    watchSnapshot = null
    stopWatch?.()
    stopWatch = openWatch(matchID, (event) => {
      if ('G' in event) watchSnapshot = event
      else endWatch()
    })
    const nextPath = `/watch/${encodeURIComponent(matchID)}`
    if (window.location.pathname !== nextPath) history.replaceState({}, '', nextPath)
  }

  function leaveWatch() {
    stopWatch?.()
    stopWatch = null
    watchingID = null
    watchSnapshot = null
    ended = false
    if (parseWatchPath() || parseJoinPath()) history.replaceState({}, '', '/')
  }

  function endWatch() {
    stopWatch?.()
    stopWatch = null
    watchingID = null
    watchSnapshot = null
    ended = true
    if (parseWatchPath() || parseJoinPath()) history.replaceState({}, '', '/')
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

  onDestroy(() => {
    connection?.stop()
    stopWatch?.()
  })
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
{:else if watchingID}
  <GameTable
    watching
    snapshot={watchSnapshot}
    session={{ matchID: watchingID, playerID: '', credentials: '', playerName: '' }}
    connection={null}
    onLeave={leaveWatch}
    onClosed={endWatch}
  />
{:else if session && connection}
  <GameTable {session} {connection} onLeave={leave} onClosed={closeTable} />
{:else if joinCode}
  <JoinGame
    code={joinCode}
    {user}
    onJoined={sitDown}
    onBack={leaveJoinPage}
    onEnded={linkEnded}
    onWatch={() => {
      if (joinCode) beginWatch(joinCode)
    }}
  />
{:else}
  <Lobby {user} onUser={(next) => (user = next)} onJoined={sitDown} onWatch={beginWatch} />
{/if}
