import { version as SDK_VERSION } from '../../package.json'

/**
 * How this SDK identifies itself to the backend on every request that
 * carries its version (#122).
 *
 * `X-Onelo-Sdk-Name` is the registry key the dashboard compares the version
 * against (`LATEST_SDK_VERSIONS['onelo-js']`). Before it existed the
 * dashboard GUESSED the SDK from `app_type`, so a version sent by this SDK
 * from a "mobile" app was judged against onelo-swift. The name travels next
 * to the version, from one place, so the two can never disagree.
 *
 * This is NOT `X-Onelo-Sdk-Platform` (feature-discovery language tag, where
 * Electron also says `js`): that vocabulary cannot name a registry row.
 */
export const SDK_NAME = 'onelo-js'

export const SDK_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'X-SDK-Version': SDK_VERSION,
  'X-Onelo-Sdk-Name': SDK_NAME,
})
