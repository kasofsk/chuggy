/**
 * The credential seam every authenticated client of the native API presents
 * through, and the one check each of them makes of what it is handed.
 *
 * THE SIGNAL BOUNDS THE CALLER'S WAIT AND NOT THE SOURCE'S WORK. A source may
 * be replacing one token for many waiting callers, so one caller's deadline
 * cannot be allowed to cancel the replacement the others are waiting on;
 * `presentedAccessToken` releases the caller instead, and the source's own
 * deadline bounds the work. A client calls it rather than awaiting the source
 * directly, so a source that ignores its signal still cannot hang a request.
 * An already-aborted caller never reaches the source at all, because a promise
 * started only to be abandoned is one nothing is left to settle.
 *
 * A REFUSAL IS A HINT AND NOT A VERDICT, which is why `invalidate` is named
 * for the token rather than for the response. A 401 is not proof the
 * credential is bad: this tree's own server answers one for every verification
 * failure, an unreachable JWKS endpoint included, so an issuer that is down
 * refuses a perfectly good token. A source that treats each refusal as reason
 * to mint would answer that outage by minting once per refused read, from the
 * issuer that is failing. So a source takes a refusal as licence to replace
 * what it holds and bounds how often it will act on one; what it holds when it
 * declines is a token that is no worse than the one a mint would fail to
 * fetch.
 */

export interface AccessTokenSource {
  /** The token to present, held or newly minted, bounded by `signal`. */
  token(signal: AbortSignal): Promise<string>;

  /** Offers `refused` as spent; a source may decline, and discards nothing once it holds something else. */
  invalidate(refused: string): void;
}

/** Refuses a token that cannot be a header value, which is every way one can be malformed here. */
export function checkedBearerToken(value: string): string {
  if (value.length === 0 || /[\r\n]/u.test(value))
    throw new RangeError("bearer token is empty or malformed");
  return value;
}

function accessTokenAbortable(
  read: () => Promise<string>,
  signal: AbortSignal,
): Promise<string> {
  const reason = (): Error =>
    signal.reason instanceof Error
      ? signal.reason
      : new Error("access token read aborted");
  if (signal.aborted) return Promise.reject(reason());
  const started = read();
  return new Promise((resolve, reject) => {
    const abort = (): void => {
      reject(reason());
    };
    signal.addEventListener("abort", abort, { once: true });
    void started.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (failure: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(
          failure instanceof Error
            ? failure
            : new Error("access token read failed"),
        );
      },
    );
  });
}

/** The token a request presents: read under the caller's deadline, and refused if it could not be a header. */
export function presentedAccessToken(
  source: AccessTokenSource,
  signal: AbortSignal,
): Promise<string> {
  return accessTokenAbortable(() => source.token(signal), signal).then(
    checkedBearerToken,
  );
}
