/**
 * The reader's own agent accounts as the console draws them, derived: the
 * words for a window and a pause, whether a reading still counts, a draft of
 * one agent's settings read by the wire's own schema, and what a press's
 * refusal says.
 *
 * A READING IS STALE ONCE ITS WINDOW HAS RESET. The pause rule counts a reading
 * only while its reset is ahead, so a stale one pauses nothing until the next
 * reading arrives, and the mark is how a reader sees that.
 */

import { agentAccountSettingsSchema } from "../../../../src/contract/requests.ts";
import type {
  AgentAccount,
  AgentAccountsResponse,
  AgentPause,
} from "../../../../src/contract/responses.ts";
import type {
  AgentPauseReason,
  RunUsageWindow,
} from "../../../../src/contract/rosters.ts";
import type { ApiFailure } from "./apiRequest.ts";
import { failureWords } from "./failureWords.ts";

export type AgentAccountSettings = AgentAccount["settings"];

export type AgentAccountReading = AgentAccount["readings"][number];

/** The status a paused agent is drawn with. */
export const agentPausedWord = "Paused";

/** What stands where a press already lets the next claim through the limit. */
export const agentPausePressedLine = "Trying once";

export function runUsageWindowLabel(window: RunUsageWindow): string {
  switch (window) {
    case "five_hour":
      return "Five-hour window";
    case "seven_day":
      return "Weekly window";
  }
}

export function agentPauseReasonLabel(reason: AgentPauseReason): string {
  switch (reason) {
    case "five_hour":
    case "seven_day":
      return runUsageWindowLabel(reason);
    case "limit":
      return "Provider limit";
  }
}

/** The status and every reason holding the agent, in the wire's order. */
export function agentPauseLine(pause: AgentPause): string {
  return [agentPausedWord, ...pause.reasons.map(agentPauseReasonLabel)].join(
    " · ",
  );
}

/** A pause a provider's limit holds, which only a press tries past. */
export function agentPauseHard(pause: AgentPause): boolean {
  return pause.reasons.includes("limit");
}

/** Whether a press is offered: a limit holds the agent and no press is unspent. */
export function agentPausePressable(pause: AgentPause | undefined): boolean {
  return pause !== undefined && agentPauseHard(pause) && !pause.pressed;
}

/** The agents of the reader's account a pause holds, in roster order. */
export function agentAccountsPaused(
  read: AgentAccountsResponse,
): readonly (AgentAccount & { readonly pause: AgentPause })[] {
  return read.accounts.filter(
    (account): account is AgentAccount & { readonly pause: AgentPause } =>
      account.pause !== undefined,
  );
}

export function agentAccountReading(
  account: AgentAccount,
  window: RunUsageWindow,
): AgentAccountReading | undefined {
  return account.readings.find((reading) => reading.window === window);
}

export const agentAccountReadingStaleWord = "Stale";

/** Why a stale reading is marked, said where a reader hovers the mark. */
export const agentAccountReadingStaleLine =
  "Its window has reset; it pauses nothing until the next reading";

/** A reading whose window has reset since it was read, or whose reset the clock cannot read. */
export function agentAccountReadingStale(
  reading: AgentAccountReading,
  nowMs: number,
): boolean {
  const resetsAtMs = Date.parse(reading.resetsAt);
  return !Number.isFinite(resetsAtMs) || resetsAtMs <= nowMs;
}

/** One agent's settings as typed: each threshold as the digits in its box. */
export interface AgentAccountDraft {
  readonly fiveHourPercent: string;
  readonly sevenDayPercent: string;
  readonly pausesThreads: boolean;
}

export type AgentAccountPercentName = "fiveHourPercent" | "sevenDayPercent";

/** The window each threshold box is for. */
export const agentAccountPercentWindows: Readonly<
  Record<AgentAccountPercentName, RunUsageWindow>
> = { fiveHourPercent: "five_hour", sevenDayPercent: "seven_day" };

const agentAccountPercentSchema =
  agentAccountSettingsSchema.shape.fiveHourPercent;

/** What a refused threshold box says: the whole percentages the wire takes. */
export const agentAccountPercentFault = `Whole percent, ${String(agentAccountPercentSchema.minValue)} to ${String(agentAccountPercentSchema.maxValue)}`;

export function agentAccountDraftOf(
  settings: AgentAccountSettings,
): AgentAccountDraft {
  return {
    ...settings,
    fiveHourPercent: String(settings.fiveHourPercent),
    sevenDayPercent: String(settings.sevenDayPercent),
  };
}

/** Bare digits as the number they say; `NaN` for anything else, so the
 * wire's own schema is what refuses it. */
function agentAccountDraftPercent(typed: string): number {
  const trimmed = typed.trim();
  return /^\d+$/u.test(trimmed) ? Number(trimmed) : NaN;
}

/** The draft as the body the route takes, or the boxes the wire refused. */
export type AgentAccountDraftRead =
  | { readonly settings: AgentAccountSettings; readonly faults: undefined }
  | {
      readonly settings: undefined;
      readonly faults: ReadonlySet<AgentAccountPercentName>;
    };

export function agentAccountDraftRead(
  draft: AgentAccountDraft,
): AgentAccountDraftRead {
  const read = agentAccountSettingsSchema.safeParse({
    ...draft,
    fiveHourPercent: agentAccountDraftPercent(draft.fiveHourPercent),
    sevenDayPercent: agentAccountDraftPercent(draft.sevenDayPercent),
  });
  if (read.success) return { settings: read.data, faults: undefined };
  const faults = new Set<AgentAccountPercentName>();
  for (const issue of read.error.issues) {
    const name = issue.path[0];
    if (name === "fiveHourPercent" || name === "sevenDayPercent")
      faults.add(name);
  }
  return { settings: undefined, faults };
}

export function agentAccountDraftSame(
  draft: AgentAccountDraft,
  settings: AgentAccountSettings,
): boolean {
  const read = agentAccountDraftRead(draft).settings;
  return (
    read !== undefined &&
    read.fiveHourPercent === settings.fiveHourPercent &&
    read.sevenDayPercent === settings.sevenDayPercent &&
    read.pausesThreads === settings.pausesThreads
  );
}

/** A press refused because no limit holds the agent any longer says so. */
export function agentAccountPressRefusal(failure: ApiFailure): string {
  return failure.outcome === "Conflict" && failure.code === "NotHardPaused"
    ? "No limit holds it"
    : failureWords(failure).word;
}
