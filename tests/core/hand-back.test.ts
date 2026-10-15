/**
 * #615 — the one Store Hand-back decoder. Every wire shape the hosted store and
 * portal send, and what each web container makes of it.
 */
import { describe, it, expect } from 'vitest'
import { classifyHandBack } from '../../src/core/hand-back'

describe('classifyHandBack', () => {
  it.each([
    ['purchase (P1/P2)', { type: 'onelo:code', code: 'oac_1' }, { kind: 'purchase', code: 'oac_1' }],
    ['interval switch (P3)', { type: 'onelo:done', reason: 'plan_switched' }, { kind: 'switched', reason: 'plan_switched' }],
    ['lagging paid switch (P3t)', { type: 'onelo:done', reason: 'plan_switch_pending' }, { kind: 'switched', reason: 'plan_switch_pending' }],
    ['scheduled downgrade (P5)', { type: 'onelo:done', reason: 'switch_scheduled' }, { kind: 'switched', reason: 'switch_scheduled' }],
    ['portal Done (P8)', { type: 'onelo:portal_done' }, { kind: 'portal_closed', event: null }],
    ['portal Done + event', { type: 'onelo:portal_done', event: 'account_revoked' }, { kind: 'portal_closed', event: 'account_revoked' }],
    ['expired link (P14, #619)', { type: 'onelo:cancel', reason: 'expired' }, { kind: 'expired' }],
    ['plain cancel', { type: 'onelo:cancel' }, { kind: 'cancelled' }],
    ['error', { type: 'onelo:error', message: 'boom' }, { kind: 'error', message: 'boom' }],
  ])('%s', (_n, data, expected) => {
    expect(classifyHandBack(data)).toEqual(expected)
  })

  it.each([
    ['ready', { type: 'onelo:ready' }],
    ['resize', { type: 'onelo:resize', preset: 'wide' }],
    ['renew request', { type: 'onelo:renew_request', kind: 'portal', request_id: 'r' }],
    ['code without a string code', { type: 'onelo:code', code: 5 }],
    ['foreign', { type: 'something' }],
    ['null', null],
    ['string', 'onelo:done'],
  ])('ignores %s', (_n, data) => {
    expect(classifyHandBack(data)).toBeNull()
  })
})
