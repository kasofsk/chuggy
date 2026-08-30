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
 *
 * A REFUSAL IS TOLD TO THE SOURCE. Authentication is the one failure a client
 * can attribute to its credential rather than to the server, so a 401 discards
 * the token that earned it; without that a source holding a token invalidated
 * early — a rotated signing key, a clock that skewed past the refresh margin —
 * hands the same bad token out until its own margin expires.
 */

export interface AccessTokenSource {
  /** The token to present, held or newly minted, bounded by `signal`. */
  token(signal: AbortSignal): Promise<string>;

  /** Discards `refused` if that is still the held token, so the next read mints. */
  invalidate(refused: string): void;
}

/** Refuses a token that cannot be a header value, which is every way one can be malformed here. */
export function checkedBearerToken(value: string): string {
  if (value.length === 0 || /[\r\n]/u.test(value))
    throw new RangeError("bearer token is empty or malformed");
  return value;
}

function accessTokenAbortable(
  read: Promise<string>,
  signal: AbortSignal,
): Promise<string> {
  const reason = (): Error =>
    signal.reason instanceof Error
      ? signal.reason
      : new Error("access token read aborted");
  if (signal.aborted) return Promise.reject(reason());
  return new Promise((resolve, reject) => {
    const abort = (): void => {
      reject(reason());
    };
    signal.addEventListener("abort", abort, { once: true });
    void read.then(
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
  return accessTokenAbortable(source.token(signal), signal).then(
    checkedBearerToken,
  );
}
