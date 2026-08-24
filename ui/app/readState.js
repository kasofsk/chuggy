/**
 * @template Held
 * @param {{ held: Held | undefined }} state
 * @param {{ result: "Deferred", code: string, retryAfterSeconds: number }
 *   | { result: "Unavailable", reason: string }} result
 */
export function readStateFailure(state, result) {
  if (result.result === "Deferred")
    return {
      state: /** @type {const} */ ("Error"),
      held: state.held,
      error: {
        kind: /** @type {const} */ ("Deferred"),
        code: result.code,
        retryAfterSeconds: result.retryAfterSeconds,
      },
    };
  return {
    state: /** @type {const} */ ("Error"),
    held: state.held,
    error: {
      kind: /** @type {const} */ ("Unavailable"),
      reason: result.reason,
    },
  };
}
