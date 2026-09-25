/** The session plane's own language: how a session bearer is written, and what names a store stream. */

import { isBoundedText, sessionStoreStreamCharsMax } from "./http.ts";

/** What marks a token as a session bearer rather than an OIDC one, so the API never probes. */
export const sessionBearerPrefix = "chgs_";

/** The whole language of session bearer secrets, which no compact JWS inhabits. */
export const sessionBearerPattern = /^chgs_[A-Za-z0-9_-]{32,240}$/u;

/** What neither a directory name nor a stored key holds. */
const sessionStoreStreamRefused = /[\p{Cc}\s]/u;

/**
 * Whether one stream name is one a stored row holds. A route reading a stream
 * out of a path must refuse before it brands, because a caller's bad segment is
 * a status to answer with rather than a raise to catch.
 */
export function isSessionStoreStream(value: string): boolean {
  return (
    isBoundedText(value, sessionStoreStreamCharsMax) &&
    !sessionStoreStreamRefused.test(value)
  );
}
