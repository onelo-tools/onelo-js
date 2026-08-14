/**
 * Which OS the page is actually running on — `ios`, `android`, or `web`.
 *
 * Sent as `X-Onelo-OS`, and distinct from `X-Onelo-Sdk-Platform: js` (which
 * says WHICH SDK, not which store the app ships through).
 *
 * Why a web SDK needs this at all: onelo-js does not only run in browsers. In a
 * Capacitor or Cordova shell it runs INSIDE an App Store app, where App Review
 * guideline 3.1.1 governs how digital content may be sold — so the
 * "Require plan on sign-up" gate must be suppressed there just as it is for
 * Swift on iOS (see applications.paywall_gate_on_apple, migration
 * 20260814000001, and knowledge-base/apple-app-store-rules.md).
 *
 * The detection is not a user-agent guess. Capacitor and Cordova inject these
 * globals precisely so embedded code can identify its container, and
 * `Capacitor.getPlatform()` is their documented API for exactly this question.
 * A plain browser has neither global and reports `web`, which the backend
 * treats as non-Apple — Safari on an iPhone is a browser, not an App Store app,
 * and the guideline does not reach it.
 */
export function hostOS(): 'ios' | 'android' | 'web' {
  if (typeof window === 'undefined') return 'web'
  const w = window as unknown as {
    Capacitor?: { getPlatform?: () => string; platform?: string }
    cordova?: { platformId?: string }
  }

  const cap = w.Capacitor
  if (cap) {
    const p = (typeof cap.getPlatform === 'function' ? cap.getPlatform() : cap.platform) ?? ''
    if (p === 'ios') return 'ios'
    if (p === 'android') return 'android'
  }

  const cordovaPlatform = w.cordova?.platformId
  if (cordovaPlatform === 'ios') return 'ios'
  if (cordovaPlatform === 'android') return 'android'

  return 'web'
}
