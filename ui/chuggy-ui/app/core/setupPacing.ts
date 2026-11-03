/**
 * The setup program's pacing: how often a run looks again at what it waits
 * on, and how long it gives git to name the folder's remote.
 *
 * A run is paced as the modules that wait state unless it is handed text
 * naming quicker values. That text is a JSON object naming some of the fields
 * below, each a whole number of milliseconds from one up to the value it
 * replaces; any other text is read as naming nothing.
 *
 * Every wait that looks again ends at its first look once its bound has
 * passed on the clock, so however often a run looks, a wait lasts its bound
 * and at most one look more. A pacing can still change what a run reads: a
 * run that stops looking sooner does not see what happens after, and a git
 * that answers past a shorter wait is read as no remote.
 */

import { z } from "zod";

import { setupRemoteWaitMs } from "./setupRemote.ts";
import { setupLivePollMs } from "./setupRunner.ts";
import { setupSignInPollMs } from "./setupSignIn.ts";

export interface SetupPacing {
  /** How often a sign-in looks for the note its page leaves. */
  readonly signInPollMs: number;
  /** How often `runner` asks the site again whether it sees a runner live. */
  readonly livePollMs: number;
  /** How long git is given to name the folder's remote. */
  readonly remoteWaitMs: number;
}

export const setupPacing: SetupPacing = {
  signInPollMs: setupSignInPollMs,
  livePollMs: setupLivePollMs,
  remoteWaitMs: setupRemoteWaitMs,
};

function setupPacingField(msMax: number) {
  return z.number().int().min(1).max(msMax).optional();
}

const setupPacingSchema = z.strictObject({
  signInPollMs: setupPacingField(setupPacing.signInPollMs),
  livePollMs: setupPacingField(setupPacing.livePollMs),
  remoteWaitMs: setupPacingField(setupPacing.remoteWaitMs),
});

/** The pacing `text` names, each field it leaves out the program's own. */
export function setupPacingRead(text: string | undefined): SetupPacing {
  if (text === undefined) return setupPacing;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return setupPacing;
  }
  const named = setupPacingSchema.safeParse(parsed);
  if (!named.success) return setupPacing;
  return {
    signInPollMs: named.data.signInPollMs ?? setupPacing.signInPollMs,
    livePollMs: named.data.livePollMs ?? setupPacing.livePollMs,
    remoteWaitMs: named.data.remoteWaitMs ?? setupPacing.remoteWaitMs,
  };
}
