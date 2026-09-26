<script lang="ts">
  import { config } from '../config'

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
      onCycle()
      return
    }
    clicks += 1
    if (windowTimer) window.clearTimeout(windowTimer)
    windowTimer = window.setTimeout(() => {
      clicks = 0
    }, config.peek.clickWindowMs)
    if (clicks >= config.peek.secretClicks) {
      clicks = 0
      if (windowTimer) window.clearTimeout(windowTimer)
      promptOpen = true
      draft = ''
    }
  }

  function close() {
    promptOpen = false
    draft = ''
  }

  function submit() {
    const value = draft
    close()
    if (value) onSubmit(value)
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
