import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { SDK_HEADERS, SDK_NAME } from './sdk-headers'
import { version } from '../../package.json'

describe('SDK_HEADERS (#122)', () => {
  it('names this SDK by its registry key next to its version', () => {
    expect(SDK_NAME).toBe('onelo-js')
    expect(SDK_HEADERS).toEqual({ 'X-SDK-Version': version, 'X-Onelo-Sdk-Name': 'onelo-js' })
  })

  it('is the ONLY place the version header is spelled out', () => {
    // A call site that writes `'X-SDK-Version': SDK_VERSION` by hand sends a
    // version WITHOUT a name — exactly the row the dashboard shows as
    // "not identified". Every site must spread SDK_HEADERS instead.
    const root = join(__dirname, '..')
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.ts$/.test(entry) && !/\.test\.ts$/.test(entry) && !p.endsWith('sdk-headers.ts')) {
          if (readFileSync(p, 'utf8').includes("'X-SDK-Version'")) offenders.push(relative(root, p))
        }
      }
    }
    walk(root)
    expect(offenders, 'spread SDK_HEADERS from core/sdk-headers instead').toEqual([])
  })
})
