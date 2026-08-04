/**
 * Compatibility facade for the canonical Web URL Policy.
 */
export {
  assertPublicHost,
  createBrowserRequestGuard,
  isPrivateOrLocalAddress,
  isPublicAddress,
  parseExternalUrl,
  UrlPolicyError,
  validateExternalUrl,
  validateInitialUrl,
  validateRedirectTarget,
  validateRedirectUrl,
  validateResolvedHost,
} from '../web/url-policy'
export type { BrowserRouteLike, UrlLookup, UrlPolicyOptions } from '../web/url-policy'
