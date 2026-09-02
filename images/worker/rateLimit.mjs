/**
 * Whether the runtime's own frames said the account was held rather than that
 * the work failed. A work attempt's run evidence and a session pod's turn both
 * read it, so a rate limit is one fact with one reading.
 *
 * IT READS DECLARED FIELDS, NEVER TEXT. `@anthropic-ai/claude-agent-sdk`'s
 * `sdk.d.ts` declares two frames that name a hold, each with a closed set of
 * values:
 *
 *   `SDKRateLimitEvent` — `{type:"rate_limit_event", rate_limit_info:{status}}`,
 *     the status being `allowed`, `allowed_warning` or `rejected`.
 *   `SDKAssistantMessage` — `{type:"assistant", error}`, the error being one of
 *     a closed set that includes `rate_limit`, which is what the runtime sets
 *     when the provider refused the request.
 *
 * A SUBSTRING MATCH READ NEITHER, which is why kasofsk/chuggy#386 was filed. The
 * label this replaces looked for `rate_limit` inside the result's `subtype` and
 * `stop_reason`; neither field's declared values contain it, and the run the
 * issue reports carried `terminal_reason: "api_error"` with the rejection on a
 * frame nothing looked at. A run the provider refused was charged a retry the
 * work never spent.
 *
 * `terminal_reason: "api_error"` IS NOT READ, though the issue quotes it. It is
 * the generic arm: the runtime dispatches it on an error kind, and the
 * rate-limited kind is the `error` field above, so `api_error` adds no case the
 * assistant frame does not already carry. Reading it alone — or beside a
 * rate-limit frame of any status, since one is emitted whenever the information
 * changes — would price every API error as a hold and leave the retry budget
 * unenforceable.
 *
 * THE LATEST STATUS IS THE ONE THAT COUNTS, for that same reason: a run rejected
 * at one point and allowed again later was not being held when it ended.
 */

const rateLimitEventType = "rate_limit_event";
const rateLimitRejectedStatus = "rejected";
const assistantMessageType = "assistant";
const rateLimitErrorKind = "rate_limit";

/** What has been seen so far, which until a frame says otherwise is nothing. */
export function rateLimitSightings() {
  return { status: undefined, refused: false };
}

/** Folds one runtime frame into the sightings it may carry. */
export function observeRateLimit(sightings, event) {
  if (event?.type === rateLimitEventType) {
    const status = event.rate_limit_info?.status;
    if (typeof status === "string") sightings.status = status;
    return sightings;
  }
  if (
    event?.type === assistantMessageType &&
    event.error === rateLimitErrorKind
  )
    sightings.refused = true;
  return sightings;
}

/** Whether what was seen says the provider was refusing the account. */
export function rateLimited(sightings) {
  return (
    sightings?.refused === true || sightings?.status === rateLimitRejectedStatus
  );
}
