import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { publishSessionCreated, subscribeSessionCreated } from './session-channel'

/**
 * The hand-off is two-way, and that is the part worth pinning.
 *
 * A one-way announcement was not enough: the tab the email opened has to know
 * whether anyone TOOK the session, because that decides whether it shows a
 * notice or carries on into the app. Get the acknowledgement wrong and either
 * both tabs become the app (what Adrian rejected on 2026-08-18) or the user is
 * stranded on a notice with no app anywhere.
 */

class FakeChannel {
  static live: FakeChannel[] = []
  handlers: Array<(e: { data: unknown }) => void> = []
  closed = false
  constructor(public name: string) { FakeChannel.live.push(this) }
  postMessage(data: unknown) {
    for (const c of FakeChannel.live) {
      if (c !== this && !c.closed) c.handlers.forEach((h) => h({ data }))
    }
  }
  addEventListener(_t: string, h: (e: { data: unknown }) => void) { this.handlers.push(h) }
  removeEventListener(_t: string, h: (e: { data: unknown }) => void) {
    this.handlers = this.handlers.filter((x) => x !== h)
  }
  close() { this.closed = true }
}

beforeEach(() => {
  FakeChannel.live = []
  vi.stubGlobal('BroadcastChannel', FakeChannel as unknown as typeof BroadcastChannel)
})

afterEach(() => { vi.unstubAllGlobals() })

describe('session hand-off', () => {
  it('reaches a tab that is listening', async () => {
    const onSession = vi.fn()
    const unsubscribe = subscribeSessionCreated(onSession)

    publishSessionCreated()

    expect(onSession).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('is fire-and-forget — nobody listening is not an error', () => {
    // The announcing tab's behaviour does not depend on being heard: it shows
    // its farewell notice either way. An acknowledgement used to decide that,
    // and the "nobody answered" branch let the email tab carry on into the app —
    // making it show an app, a store or a login form depending on timing. That
    // exception is gone (Adrian, 2026-08-19).
    expect(() => publishSessionCreated()).not.toThrow()
  })

  it('a stopped subscriber hears nothing', () => {
    const onSession = vi.fn()
    subscribeSessionCreated(onSession)()   // subscribe and immediately stop

    publishSessionCreated()

    expect(onSession).not.toHaveBeenCalled()
  })

  it('degrades quietly where BroadcastChannel does not exist', () => {
    // Safari before 15.4. No hand-off, but nothing throws: the waiting tab keeps
    // waiting, exactly as before this existed.
    vi.stubGlobal('BroadcastChannel', undefined)
    expect(() => publishSessionCreated()).not.toThrow()
    expect(() => subscribeSessionCreated(() => {})()).not.toThrow()
  })
})

describe('the surface travels with the announcement', () => {
  it('hands the waiting tab the screen it must show', async () => {
    // THE fix for 2026-08-18. A refused user has no session, so a tab that asks
    // the backend "what now?" is told — correctly — that nobody is signed in and
    // shows the sign-in form. Both tabs did that. The screen the other tab was
    // handed cannot be re-derived, so it travels.
    let received: string | undefined = 'not-called'
    const unsubscribe = subscribeSessionCreated((url) => { received = url })

    publishSessionCreated('https://st.onelo.tools/no-plan/hosted?token=npt_x')

    expect(received).toBe('https://st.onelo.tools/no-plan/hosted?token=npt_x')
    unsubscribe()
  })

  it('carries nothing when a real sign-in happened', async () => {
    // The ordinary case: a session exists and is read from storage. There is no
    // surface to show, and inventing one would put a screen over a signed-in app.
    let received: string | undefined = 'not-called'
    const unsubscribe = subscribeSessionCreated((url) => { received = url })

    publishSessionCreated()

    expect(received).toBeUndefined()
    unsubscribe()
  })
})
