/**
 * Fail-safe visibility controller for an SDK modal's own close (✕) button.
 *
 * Background (#40 — hosted close-affordance unification): the CANONICAL ✕ is
 * rendered by the hosted page itself (`HostedCloseX`), so it looks and behaves
 * identically on every platform. The SDK must NOT draw a second, always-on ✕ on
 * top of the hosted one — that produced the double-✕ bug. But the SDK still needs
 * a minimal fail-safe: the hosted ✕ only exists AFTER the page mounts, so during
 * the skeleton / load-error window there is no web ✕ and the user must not be
 * trapped.
 *
 * This controller makes the SDK's own button behave exactly like the native
 * SDKs' fail-safe ✕:
 *   - hidden on mount,
 *   - shown only after a grace period WITHOUT an `onelo:ready` (a normal fast
 *     load posts `onelo:ready` first, so the ✕ never flashes — #44 no-flash),
 *   - hidden again the moment the hosted page signals ready (`markReady`).
 *
 * The original inline `display` value is preserved (the portal chip is
 * `display:flex`; the feedback ✕ has none), so restoring it never breaks layout.
 */
export function installFailsafeClose(
  btn: HTMLElement,
  graceMs = 3500,
): { markReady: () => void; rearm: () => void; dispose: () => void } {
  // Capture whatever display the caller set inline (e.g. 'flex' for the portal
  // chip, '' for the plain feedback ✕) so we restore THAT, not a hardcoded value.
  const shownDisplay = btn.style.display || ''

  let ready = false
  let timer: ReturnType<typeof setTimeout>

  // Hide now, and reveal after the grace UNLESS the hosted page signals ready
  // first. Used on mount and again after a re-navigation (see `rearm`).
  const arm = (): void => {
    ready = false
    btn.style.display = 'none'
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (!ready) btn.style.display = shownDisplay
    }, graceMs)
  }
  arm()

  return {
    markReady(): void {
      if (ready) return
      ready = true
      clearTimeout(timer)
      btn.style.display = 'none'
    },
    // Re-arm after the iframe navigates to a NEW document — e.g. the portal
    // auto-advancing to /store/hosted, which carries NO canonical hosted ✕. A
    // prior markReady() latched the button hidden; without re-arming, the user
    // lands on a page with no ✕ and no way out. Re-arming hides it again and
    // restarts the grace, so the fail-safe ✕ returns unless the new page also
    // signals ready.
    rearm: arm,
    dispose(): void {
      clearTimeout(timer)
    },
  }
}
