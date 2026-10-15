/**
 * Plan change after a Store Hand-back (#659) — the ONE place this SDK reacts
 * to "the buyer just bought or switched a plan".
 *
 * The hosted store / Customer Portal only closes the modal. Waiting for the
 * Event Stream left the app on the old plan for about a minute, so on every
 * successful hand-back the SDK reconciles at once:
 *   - features: a forced REST re-resolve (past the 1 s debounce),
 *   - entitlement: a re-read of `/api/sdk/auth/user` (`hasActiveAccess`).
 * A `plan_switch_pending` hand-back means Stripe has not applied the switch
 * yet, so the features are re-checked on a bounded backoff until the snapshot
 * differs from the one before the hand-back, or the delays run out.
 *
 * The live complement is the stream's `paywall.access_changed` (#635), which
 * the backend sends when the grant really changes; whichever lands first wins.
 */

/** What a container reports when a hosted page finished. Only a purchase or a
 *  switch can move the plan; every other kind is ignored. */
export type PlanChange = { kind: 'purchase' } | { kind: 'switched'; reason: string }

/** The store's reason for a paid switch Stripe has not applied yet (#615). */
export const PLAN_SWITCH_PENDING = 'plan_switch_pending'

/** Gaps between re-checks after `plan_switch_pending`: ~30 s in all. */
export const PENDING_RECHECK_DELAYS_MS: readonly number[] = [1000, 2000, 4000, 8000, 15000]

export interface PlanChangeTargets {
  /** Force a REST re-resolve of the features snapshot. Never throws. */
  refreshFeatures(): Promise<void>
  /** Re-read the entitlement. Never throws. */
  revalidateEntitlement(): Promise<unknown>
  /** A comparable picture of the current features snapshot. */
  snapshot(): string
}

export class PlanChangeRefresher {
  private generation = 0
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly targets: PlanChangeTargets,
    private readonly delaysMs: readonly number[] = PENDING_RECHECK_DELAYS_MS,
  ) {}

  /** React to a finished hosted page. Resolves once the immediate refresh is
   *  done; pending re-checks continue in the background. */
  async handBack(change: { kind: string; reason?: string }): Promise<void> {
    if (change.kind !== 'purchase' && change.kind !== 'switched') return
    const generation = ++this.generation
    this.clearTimer()
    const before = this.targets.snapshot()
    await Promise.all([
      this.targets.refreshFeatures().catch(() => {}),
      this.targets.revalidateEntitlement().catch(() => {}),
    ])
    if (change.kind === 'switched' && change.reason === PLAN_SWITCH_PENDING) {
      this.scheduleRecheck(generation, before, 0)
    }
  }

  /** Stop any pending re-checks (SDK teardown). */
  cancel(): void {
    this.generation++
    this.clearTimer()
  }

  private scheduleRecheck(generation: number, before: string, step: number): void {
    if (generation !== this.generation || step >= this.delaysMs.length) return
    if (this.targets.snapshot() !== before) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.recheck(generation, before, step)
    }, this.delaysMs[step])
  }

  private async recheck(generation: number, before: string, step: number): Promise<void> {
    if (generation !== this.generation) return
    await this.targets.refreshFeatures().catch(() => {})
    if (generation !== this.generation) return
    if (this.targets.snapshot() !== before) {
      await this.targets.revalidateEntitlement().catch(() => {})
      return
    }
    this.scheduleRecheck(generation, before, step + 1)
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}
