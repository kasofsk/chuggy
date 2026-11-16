/**
 * A project's own thread settings, reached through the project access that
 * bounds them.
 *
 * A WRITE REPLACES THE WHOLE OVERRIDE SET under the revision it was read at, so
 * clearing an override and setting one are the same write and a rollback is a
 * replay of a historical revision rather than a second verb.
 */

import {
  sessionEfforts,
  sessionModelSchema,
  textCodePointsCount,
  type SessionEffort,
} from "../contract/http.ts";
import { resolvedThreadStandingRules } from "../contract/threadSeeding.ts";
import { assertNever } from "../domain/assertNever.ts";
import type { Principal, ProjectAccess } from "./nativeWeb.ts";
import type { Authority } from "./operationInbox.ts";
import type { Partition } from "./projectStore.ts";

/** What a project sets for its threads, each absent field taking the default. */
export interface SelectorProjectOverrides {
  readonly northStar?: string;
  /** The standing rules this project's threads act under, in place of the default. */
  readonly threadStandingRules?: string;
  /** The model a thread opened from now runs on, in place of the site's session model. */
  readonly threadModel?: string;
  /** The effort a thread opened from now runs at, in place of the runtime's own. */
  readonly threadEffort?: SessionEffort;
}

/** What a project's threads run under once its overrides are resolved. */
export interface SelectorEffectiveSettings {
  readonly northStar?: string;
  /** Always a value: a project that overrides nothing runs its threads under the code default. */
  readonly threadStandingRules: string;
}

/** Resolves the overrides a thread's briefing reads to what it runs under. */
export function selectorEffectiveSettings(
  overrides: SelectorProjectOverrides,
): SelectorEffectiveSettings {
  return {
    ...(overrides.northStar === undefined
      ? {}
      : { northStar: overrides.northStar }),
    threadStandingRules: resolvedThreadStandingRules(
      overrides.threadStandingRules,
    ),
  };
}

/** What a project set, what that resolves to, and the revision a write must expect. */
export interface SelectorProjectSettingsRecord {
  readonly partition: Partition;
  readonly revision: number;
  readonly overrides: SelectorProjectOverrides;
  readonly effective: SelectorEffectiveSettings;
}

/** Who moved a project's settings to the revision now standing, and when. */
export interface SelectorSettingsMovement {
  readonly administrator: Authority;
  readonly recordedAt: string;
}

/**
 * The standing row and the write that put it there, which one statement
 * answers. `movedBy` is absent only at revision zero, which nobody wrote.
 */
export interface SelectorProjectSettingsStanding {
  readonly settings: SelectorProjectSettingsRecord;
  readonly movedBy?: SelectorSettingsMovement;
}

/** One retained override set, and the administrator who wrote it. */
export interface SelectorProjectSettingsRevision {
  readonly revision: number;
  readonly overrides: SelectorProjectOverrides;
  readonly administrator: Authority;
  readonly recordedAt: string;
}

/**
 * What one durable write answers with: the row it wrote, the fence it lost, or
 * a write that did not complete and can be made again. Each is a condition an
 * administrator can act on, so each is a variant rather than a fault.
 */
export type SelectorProjectSettingsRefusal = "SettingsWriteContended";

export type SelectorProjectSettingsWriteOutcome =
  | {
      readonly written: "Settings";
      readonly settings: SelectorProjectSettingsRecord;
    }
  | { readonly written: "FenceMoved" }
  | {
      readonly written: "Refused";
      readonly refusal: SelectorProjectSettingsRefusal;
    };

/** The durable per-project settings, whose write reports the row it wrote. */
export interface SelectorProjectSettingsStore {
  read(partition: Partition): Promise<SelectorProjectSettingsStanding>;
  write(
    partition: Partition,
    expectedRevision: number,
    overrides: SelectorProjectOverrides,
    administrator: Authority,
  ): Promise<SelectorProjectSettingsWriteOutcome>;
  /** Newest first: no cursor is the newest page, and a cursor answers only revisions older than it. */
  history(
    partition: Partition,
    beforeRevision: number | undefined,
    limit: number,
  ): Promise<readonly SelectorProjectSettingsRevision[]>;
}

export type SelectorProjectSettingsRead =
  | { readonly result: "NotFound" }
  | {
      readonly result: "Found";
      readonly settings: SelectorProjectSettingsRecord;
    };

export type SelectorProjectSettingsWritten =
  | { readonly result: "NotFound" }
  | {
      readonly result: "Conflict";
      readonly settings: SelectorProjectSettingsRecord;
      readonly movedBy?: SelectorSettingsMovement;
    }
  | {
      readonly result: "Written";
      readonly settings: SelectorProjectSettingsRecord;
    }
  | {
      readonly result: "Refused";
      readonly refusal: SelectorProjectSettingsRefusal;
    };

export type SelectorProjectSettingsHistoryRead =
  | { readonly result: "NotFound" }
  | {
      readonly result: "Found";
      readonly revisions: readonly SelectorProjectSettingsRevision[];
    };

export interface SelectorProjectSettingsAdministration {
  read(
    principal: Principal,
    partition: Partition,
  ): Promise<SelectorProjectSettingsRead>;
  write(
    principal: Principal,
    partition: Partition,
    expectedRevision: number,
    overrides: SelectorProjectOverrides,
  ): Promise<SelectorProjectSettingsWritten>;
  history(
    principal: Principal,
    partition: Partition,
    beforeRevision: number | undefined,
    limit: number,
  ): Promise<SelectorProjectSettingsHistoryRead>;
}

/** The most revisions one history page carries, which is one bounded read. */
export const selectorProjectSettingsHistoryLimitMax = 100;

/** The longest text any single settings field carries, matching what the column holds. */
export const selectorProjectSettingsTextCharsMax = 65_536;

function checkedText(value: string | undefined, what: string): void {
  if (value === undefined) return;
  if (
    value.length < 1 ||
    textCodePointsCount(value) > selectorProjectSettingsTextCharsMax
  )
    throw new RangeError(`${what} must be bounded text`);
}

/** Refuses a model no session could be handed, by the wire's own rule. */
function checkedSessionModel(value: string | undefined, what: string): void {
  if (value === undefined) return;
  if (!sessionModelSchema.safeParse(value).success)
    throw new RangeError(`${what} must be a bounded model name`);
}

/** Refuses an effort the runtime does not name. */
function checkedSessionEffort(value: string | undefined, what: string): void {
  if (value === undefined) return;
  if (!(sessionEfforts as readonly string[]).includes(value))
    throw new RangeError(`${what} must be one of ${sessionEfforts.join(", ")}`);
}

/** Refuses an override no column would hold, before the row is offered one. */
export function checkedSelectorProjectOverrides(
  overrides: SelectorProjectOverrides,
): SelectorProjectOverrides {
  checkedText(overrides.northStar, "selector north star");
  checkedText(overrides.threadStandingRules, "thread standing rules");
  checkedSessionModel(overrides.threadModel, "threadModel");
  checkedSessionEffort(overrides.threadEffort, "threadEffort");
  return overrides;
}

/** Refuses a revision no fence could stand on; zero is the project that never overrode anything. */
export function checkedSelectorProjectRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(
      "selector project settings revision must be a non-negative safe integer",
    );
  return value;
}

function checkedHistoryLimit(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > selectorProjectSettingsHistoryLimitMax
  )
    throw new RangeError("selector settings history limit is out of range");
  return value;
}

/** Exposes a project's selector settings only through current `ManageProjectSelector` access. */
export function selectorProjectSettingsAdministration(
  access: ProjectAccess,
  store: SelectorProjectSettingsStore,
): SelectorProjectSettingsAdministration {
  const administrator = (principal: Principal, partition: Partition) =>
    access.authorize(principal, partition, "ManageProjectSelector");
  return {
    read: async (principal, partition) =>
      (await administrator(principal, partition)) === undefined
        ? { result: "NotFound" }
        : { result: "Found", settings: (await store.read(partition)).settings },
    write: async (principal, partition, expectedRevision, overrides) => {
      const authority = await administrator(principal, partition);
      if (authority === undefined) return { result: "NotFound" };
      const written = await store.write(
        partition,
        checkedSelectorProjectRevision(expectedRevision),
        checkedSelectorProjectOverrides(overrides),
        authority,
      );
      switch (written.written) {
        case "Settings":
          return { result: "Written", settings: written.settings };
        case "FenceMoved": {
          const standing = await store.read(partition);
          return {
            result: "Conflict",
            settings: standing.settings,
            ...(standing.movedBy === undefined
              ? {}
              : { movedBy: standing.movedBy }),
          };
        }
        case "Refused":
          return { result: "Refused", refusal: written.refusal };
        default:
          return assertNever(written);
      }
    },
    history: async (principal, partition, beforeRevision, limit) =>
      (await administrator(principal, partition)) === undefined
        ? { result: "NotFound" }
        : {
            result: "Found",
            revisions: await store.history(
              partition,
              beforeRevision === undefined
                ? undefined
                : checkedSelectorProjectRevision(beforeRevision),
              checkedHistoryLimit(limit),
            ),
          },
  };
}
