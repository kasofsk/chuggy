/**
 * The host clock, read through the one call the domain may never make.
 *
 * An adapter is defined by what it is allowed to touch, and this is the
 * smallest honest instance of that: one ambient capability, one line. Nothing
 * in the core reads it — the machine `model/` proves has no notion of time, and
 * a decider that acquired one would stop being replayable.
 *
 * It is also the purity rule's positive control. `Date.now()` here must stay
 * clean while the identical call inside `src/domain/` is a finding, because a
 * rule that has only ever been observed saying no has not been shown to be
 * scoped to the directory it names — and an over-broad purity rule is a purity
 * rule somebody eventually switches off.
 */

/** Milliseconds since the Unix epoch, from the host clock. */
export function nowMillis(): number {
  return Date.now();
}
