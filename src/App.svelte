<script lang="ts">
  import { onDestroy } from 'svelte'
  import Lobby from './components/Lobby.svelte'
  import GameTable from './components/GameTable.svelte'
  import type { Session } from './games/bhabhi-thulla/types'
  import { connectGame, type GameConnection } from './multiplayer/gameClient'
  import { fetchMe } from './multiplayer/authClient'
  import type { PublicUser } from './multiplayer/authTypes'
  import { clearSession, loadSession } from './multiplayer/lobby'

  let session: Session | null = loadSession()
  let connection: GameConnection | null = session ? connectGame(session) : null
  let user: PublicUser | null = null

  void fetchMe()
    .then((next) => {
      user = next
    })
    .catch(() => {
      user = null
    })

  function join(nextSession: Session) {
    connection?.stop()
    session = nextSession
    connection = connectGame(nextSession)
  }

  function leave() {
    connection?.stop()
    connection = null
    session = null
    clearSession()
  }

  onDestroy(() => connection?.stop())
</script>

{#if session && connection}
  <GameTable {session} {connection} onLeave={leave} />
{:else}
  <Lobby {user} onUser={(next) => (user = next)} onJoined={join} />
{/if}
