<script lang="ts">
  import { config } from '../config'
  import { peekLog } from '../games/bhabhi-thulla/peekLog'

  /** Called with the typed table code when the user submits. */
  export let onSubmit: (password: string) => void
  /** After unlock: further secret taps cycle the viewed seat. */
  export let onCycle: () => void = () => {}
  export let unlocked = false

  let clicks = 0
  let windowTimer: number | undefined
  let promptOpen = false
  let draft = ''

  export function tap() {
    if (unlocked) {
      peekLog('secret tap — already unlocked, cycling viewed seat')
      onCycle()
      return
    }
    clicks += 1
    if (windowTimer) window.clearTimeout(windowTimer)
    windowTimer = window.setTimeout(() => {
      if (clicks > 0 && clicks < config.peek.secretClicks) {
        peekLog('secret tap timed out — need 3 quick taps on waste (or ♠ in lobby)', {
          got: clicks,
          need: config.peek.secretClicks,
          windowMs: config.peek.clickWindowMs,
        })
      }
      clicks = 0
    }, config.peek.clickWindowMs)
    if (clicks >= config.peek.secretClicks) {
      clicks = 0
      if (windowTimer) window.clearTimeout(windowTimer)
      promptOpen = true
      draft = ''
      peekLog('opened table-code prompt — enter PEEK_PASSWORD from .env, then OK')
    } else {
      const left = config.peek.secretClicks - clicks
      peekLog('secret tap', {
        progress: `${clicks}/${config.peek.secretClicks}`,
        hint:
          left === 1
            ? 'one more quick tap on waste (or ♠)'
            : `${left} more quick taps on waste (or ♠)`,
      })
    }
  }

  function close() {
    if (promptOpen) peekLog('table-code prompt cancelled')
    promptOpen = false
    draft = ''
  }

  function submit() {
    const value = draft.trim()
    close()
    if (!value) {
      peekLog('empty table code — nothing sent')
      return
    }
    peekLog('submitting table code', { length: value.length })
    onSubmit(value)
  }
</script>

{#if promptOpen}
  <div class="peek-prompt" role="dialog" aria-modal="true" aria-label="Table code">
    <form class="peek-card" on:submit|preventDefault={submit}>
      <p class="peek-kicker">Table code</p>
      <input
        type="password"
        bind:value={draft}
        placeholder="Enter code"
        autocomplete="off"
      />
      <div class="peek-actions">
        <button type="button" class="secondary" on:click={close}>Cancel</button>
        <button type="submit" class="primary" disabled={!draft}>OK</button>
      </div>
    </form>
  </div>
{/if}
