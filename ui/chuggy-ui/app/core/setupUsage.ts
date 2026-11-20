/**
 * Whether the person's own usage holds their work back before it starts, and
 * `usage`, which raises where it does.
 *
 * Read only where the checklist's next thing is the project's first ticket,
 * or that ticket waiting on a pause of the person's account, from the read
 * the console's Usage page makes of the person's own agent accounts, of the
 * agent the runner setup puts in place works as. A window whose newest
 * reading, its reset still ahead, is at or over its threshold holds the work,
 * by the comparison `agent_account_pause` makes. A reading at
 * `setupUsageFullPercent` or more of its window leaves no threshold under
 * which a run could finish, and a provider's own limit is no threshold at
 * all, so of those, the one that lifts last is said rather than offered,
 * with whether the work starts by itself once it lifts. Every other window
 * over is offered a threshold above its reading: the reading rounded up to
 * the next `setupUsageOfferedStep`, one step more, and never past the whole
 * window. No reading and no pause, a read that was not got, and every window
 * under its threshold say nothing.
 *
 * `usage` writes the person's settings for that agent whole, as the Usage
 * page does: each threshold it was given in place of the one read, and every
 * other field as it was read, through ports that let out that one write.
 */

import { nativeHttpRoutes } from "../../../../src/contract/http.ts";
import { agentAccountSettingsSchema } from "../../../../src/contract/requests.ts";
import type { AgentAccount } from "../../../../src/contract/responses.ts";
import type {
  AccountAgent,
  RunUsageWindow,
} from "../../../../src/contract/rosters.ts";
import { runUsageWindows } from "../../../../src/contract/rosters.ts";

import {
  agentAccountPercentFault,
  agentAccountReadingStale,
  agentPauseHard,
} from "./agentAccounts.ts";
import type { AgentAccountSettings } from "./agentAccounts.ts";
import type { ApiPorts } from "./apiRequest.ts";
import type { Copy } from "./copy.ts";
import { apiAgentAccounts, apiWriteAgentAccountSettings } from "./apiRoutes.ts";
import { failureWords } from "./failureWords.ts";
import { sharePercent } from "./figures.ts";
import type { SetupUsageRaised } from "./setupArguments.ts";

/** The agent the runner setup puts in place works as, on the Claude credential it is given. */
export const setupUsageAgent: AccountAgent = "Claude";

/** The whole percentages an offered threshold is a multiple of. */
export const setupUsageOfferedStep = 5;

/** The reading, in whole percent of its window, from which no threshold leaves room for a run to finish. */
export const setupUsageFullPercent = 95;

const setupUsageWhole = 100;

/** One window whose reading holds the person's work: the reading and the threshold it is at or over, each in whole percent, and the threshold offered in its place. */
export interface SetupUsageOver {
  readonly window: RunUsageWindow;
  readonly reading: number;
  readonly threshold: number;
  readonly offered: number;
}

/** What holds the person's work that raising a threshold would not lift: a window so near its whole that no threshold helps, until it resets, or the provider's own limit, until it lifts where the read says when. */
export type SetupUsageHeld =
  | {
      readonly held: "Full";
      readonly window: RunUsageWindow;
      readonly reading: number;
      readonly resetsAt: string;
    }
  | { readonly held: "Limit"; readonly resetsAt: string | undefined };

/**
 * What the person's usage holds their work to: what no threshold lifts, where
 * something does, with whether nothing else holds the work once it lifts; and
 * each window over its threshold that raising it lifts. At least one of the
 * two is there.
 */
export interface SetupUsage {
  readonly held:
    { readonly by: SetupUsageHeld; readonly starts: boolean } | undefined;
  readonly over: readonly SetupUsageOver[];
}

/** What `usage` came to: each threshold written, the figure the site would not take, or the read or the write not answered, in the word a failed request is drawn as. */
export type SetupUsageAnswered =
  | {
      readonly answered: "Raised";
      readonly raised: readonly {
        readonly window: RunUsageWindow;
        readonly percent: number;
      }[];
    }
  | { readonly answered: "Refused"; readonly refusal: Copy }
  | { readonly answered: "Failed"; readonly failure: Copy };

/** The settings field each window's threshold is. */
export const setupUsageFields = {
  five_hour: "fiveHourPercent",
  seven_day: "sevenDayPercent",
} as const satisfies Readonly<
  Record<RunUsageWindow, keyof Omit<AgentAccountSettings, "pausesThreads">>
>;

/** The threshold offered for a reading: rounded up to the next step, one step more, at most the whole window. */
export function setupUsageOffered(reading: number): number {
  const step = setupUsageOfferedStep;
  return Math.min(setupUsageWhole, Math.ceil(reading / step) * step + step);
}

/** Each window whose reading, its reset ahead, is at or over its threshold, in the wire's order. */
function setupUsageOverOf(
  account: AgentAccount,
  nowMs: number,
): readonly (SetupUsageOver & { readonly resetsAt: string })[] {
  return account.readings.flatMap((reading) => {
    const threshold = account.settings[setupUsageFields[reading.window]];
    if (agentAccountReadingStale(reading, nowMs)) return [];
    if (reading.utilization < threshold / setupUsageWhole) return [];
    const percent = sharePercent(reading.utilization);
    return [
      {
        window: reading.window,
        reading: percent,
        threshold,
        offered: setupUsageOffered(percent),
        resetsAt: reading.resetsAt,
      },
    ];
  });
}

/** When a hold lifts, in epoch milliseconds, where the read says. */
function setupUsageLiftMs(held: SetupUsageHeld): number | undefined {
  return held.resetsAt === undefined ? undefined : Date.parse(held.resetsAt);
}

/** Of what no threshold lifts, the one that lifts last, and whether every other is known to lift by then, which no lift the read does not name is. */
function setupUsageHeldOf(
  holds: readonly SetupUsageHeld[],
): { readonly by: SetupUsageHeld; readonly before: boolean } | undefined {
  const unnamed = holds.filter((held) => setupUsageLiftMs(held) === undefined);
  const named = holds
    .filter((held) => setupUsageLiftMs(held) !== undefined)
    .toSorted(
      (one, other) =>
        (setupUsageLiftMs(one) ?? 0) - (setupUsageLiftMs(other) ?? 0),
    );
  const last = unnamed[0] ?? named.at(-1);
  if (last === undefined) return undefined;
  return { by: last, before: unnamed.length === 0 || holds.length === 1 };
}

/** What the person's usage holds their work to at `nowMs`, or nothing where it holds nothing. */
export function setupUsageOf(
  account: AgentAccount,
  nowMs: number,
): SetupUsage | undefined {
  const overAll = setupUsageOverOf(account, nowMs);
  const full = overAll.filter((each) => each.reading >= setupUsageFullPercent);
  const over = overAll.filter((each) => each.reading < setupUsageFullPercent);
  const limit: readonly SetupUsageHeld[] =
    account.pause !== undefined && agentPauseHard(account.pause)
      ? [{ held: "Limit", resetsAt: account.limit?.resetsAt }]
      : [];
  const held = setupUsageHeldOf([
    ...limit,
    ...full.map(({ window, reading, resetsAt }): SetupUsageHeld => ({
      held: "Full",
      window,
      reading,
      resetsAt,
    })),
  ]);
  if (held === undefined && over.length === 0) return undefined;
  for (const each of over)
    if (each.offered <= each.reading || each.offered <= each.threshold)
      throw new Error("a threshold offered is above the reading it lifts");
  return {
    held:
      held === undefined
        ? undefined
        : { by: held.by, starts: held.before && over.length === 0 },
    over: over.map(({ window, reading, threshold, offered }) => ({
      window,
      reading,
      threshold,
      offered,
    })),
  };
}

/** The person's own account of `setupUsageAgent`, or nothing where the read was not got. */
async function setupUsageAccount(
  ports: ApiPorts,
): Promise<
  | { readonly read: "Got"; readonly account: AgentAccount | undefined }
  | { readonly read: "Failed"; readonly failure: Copy }
> {
  const result = await apiAgentAccounts(ports);
  if (result.outcome !== "Ok")
    return { read: "Failed", failure: failureWords(result).word };
  return {
    read: "Got",
    account: result.value.accounts.find(
      (held) => held.agent === setupUsageAgent,
    ),
  };
}

/** What the person's usage holds their work to, read through ports that only read. */
export async function setupUsageRead(
  ports: ApiPorts,
  nowMs: number,
): Promise<SetupUsage | undefined> {
  const held = await setupUsageAccount(ports);
  return held.read === "Got" && held.account !== undefined
    ? setupUsageOf(held.account, nowMs)
    : undefined;
}

/** The one write `usage` makes, by its method and its address. */
export function setupUsageWrites(): readonly string[] {
  const path = nativeHttpRoutes.agentAccountSettings.replace(
    ":agent",
    encodeURIComponent(setupUsageAgent),
  );
  return [`PUT ${path}`];
}

/** The settings as read, with each threshold `raised` names in place of its own. */
function setupUsageSettings(
  read: AgentAccountSettings,
  raised: SetupUsageRaised,
): AgentAccountSettings {
  let settings = read;
  for (const window of runUsageWindows) {
    const percent = raised[window];
    if (percent !== undefined)
      settings = { ...settings, [setupUsageFields[window]]: percent };
  }
  return settings;
}

/** Reads the person's settings and writes them back with each threshold `raised` names, through ports that let out only that write. */
export async function setupUsageRaise(
  ports: ApiPorts,
  raised: SetupUsageRaised,
): Promise<SetupUsageAnswered> {
  const held = await setupUsageAccount(ports);
  if (held.read === "Failed")
    return { answered: "Failed", failure: held.failure };
  if (held.account === undefined)
    throw new Error("an account read names every agent of the roster");
  const settings = setupUsageSettings(held.account.settings, raised);
  if (!agentAccountSettingsSchema.safeParse(settings).success)
    return { answered: "Refused", refusal: agentAccountPercentFault };
  const written = await apiWriteAgentAccountSettings(
    ports,
    setupUsageAgent,
    settings,
  );
  if (written.outcome !== "Ok")
    return { answered: "Failed", failure: failureWords(written).word };
  return {
    answered: "Raised",
    raised: runUsageWindows.flatMap((window) => {
      const percent = raised[window];
      return percent === undefined ? [] : [{ window, percent }];
    }),
  };
}
