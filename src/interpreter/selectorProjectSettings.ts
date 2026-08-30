/**
 * A project's own selector settings, reached through the project access that
 * bounds them.
 *
 * THE INSTALLATION'S SETTINGS ARE DEFAULTS AND NOT CEILINGS, WITH ONE
 * EXCEPTION. A project may override every field upward, and what bounds that is
 * the `ManageProjectSelector` access check rather than a limit above it. The
 * exception is `mode`: an installation pause is the operator's kill switch and
 * stops the whole sweep before any project is resolved, so a project cannot
 * unpause itself and `resolvedSelectorSettings` clamps `mode` to `Paused`
 * rather than reporting a selector that will never run. Per-project pause is
 * therefore the only direction that override travels today.
 *
 * A WRITE REPLACES THE WHOLE OVERRIDE SET under the revision it was read at, so
 * clearing an override and setting one are the same write and a rollback is a
 * replay of a historical revision rather than a second verb.
 */

import { assertNever } from "../domain/assertNever.ts";
import type { Principal, ProjectAccess } from "./nativeWeb.ts";
import type { Authority } from "./operationInbox.ts";
import type { Partition } from "./projectStore.ts";
import type {
  SelectorProjectOverrides,
  SelectorResolvedSettings,
} from "./selector.ts";

/** What a project set, what that resolves to, and the revision a write must expect. */
export interface SelectorProjectSettingsRecord {
  readonly partition: Partition;
  readonly revision: number;
  readonly overrides: SelectorProjectOverrides;
  readonly effective: SelectorResolvedSettings;
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
 * the refusal a project's `Automatic` dispatch meets while no policy host is
 * production-ready. The refusal is a condition an administrator can act on, so
 * it is a variant rather than a fault.
 */
export type SelectorProjectSettingsWriteOutcome =
  | {
      readonly written: "Settings";
      readonly settings: SelectorProjectSettingsRecord;
    }
  | { readonly written: "FenceMoved" }
  | { readonly written: "AutomaticDispatchUnavailable" };

/** The durable per-project settings, whose write reports the row it wrote. */
export interface SelectorProjectSettingsStore {
  read(partition: Partition): Promise<SelectorProjectSettingsRecord>;
  write(
    partition: Partition,
    expectedRevision: number,
    overrides: SelectorProjectOverrides,
    administrator: Authority,
  ): Promise<SelectorProjectSettingsWriteOutcome>;
  history(
    partition: Partition,
    afterRevision: number,
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
    }
  | {
      readonly result: "Written";
      readonly settings: SelectorProjectSettingsRecord;
    }
  | {
      readonly result: "Refused";
      readonly refusal: "AutomaticDispatchUnavailable";
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
    afterRevision: number,
    limit: number,
  ): Promise<SelectorProjectSettingsHistoryRead>;
}

/** The most revisions one history page carries, which is one bounded read. */
export const selectorProjectSettingsHistoryLimitMax = 100;

/** The longest text any single settings field carries, matching what the column holds. */
export const selectorProjectSettingsTextCharsMax = 65_536;

/** The most names one allowlist carries, matching the installation controls. */
export const selectorProjectSettingsAllowlistNamesMax = 64;

/** The longest name an allowlist entry carries, matching the installation controls. */
export const selectorProjectSettingsNameCharsMax = 256;

function checkedText(value: string | undefined, what: string): void {
  if (value === undefined) return;
  if (value.length < 1 || value.length > selectorProjectSettingsTextCharsMax)
    throw new RangeError(`${what} must be bounded text`);
}

function checkedAllowlist(
  values: readonly string[] | undefined,
  what: string,
): void {
  if (values === undefined) return;
  if (
    values.length > selectorProjectSettingsAllowlistNamesMax ||
    values.some(
      (value) =>
        value.length < 1 || value.length > selectorProjectSettingsNameCharsMax,
    )
  )
    throw new RangeError(`${what} must contain bounded names`);
}

function checkedLimit(value: number | undefined, what: string): void {
  if (value === undefined) return;
  if (!Number.isSafeInteger(value) || value < 1)
    throw new RangeError(`${what} must be a positive safe integer`);
}

/** Refuses an override no column would hold, before the row is offered one. */
export function checkedSelectorProjectOverrides(
  overrides: SelectorProjectOverrides,
): SelectorProjectOverrides {
  checkedText(overrides.northStar, "selector north star");
  checkedText(overrides.basePrompt, "selector base prompt");
  checkedAllowlist(overrides.modelAllowlist, "selector model allowlist");
  checkedAllowlist(overrides.toolAllowlist, "selector tool allowlist");
  const limits = overrides.limits ?? {};
  for (const [what, value] of Object.entries(limits))
    checkedLimit(value, `selector ${what}`);
  checkedLimit(
    overrides.operationalContextMaxAgeMs,
    "selector operationalContextMaxAgeMs",
  );
  if (
    limits.candidatePagesPerDecision !== undefined &&
    limits.candidatePagesPerDecision !== 1
  )
    throw new RangeError(
      "candidatePagesPerDecision must be one until multi-page policy tools land",
    );
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
        : { result: "Found", settings: await store.read(partition) },
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
        case "FenceMoved":
          return { result: "Conflict", settings: await store.read(partition) };
        case "AutomaticDispatchUnavailable":
          return {
            result: "Refused",
            refusal: "AutomaticDispatchUnavailable",
          };
        default:
          return assertNever(written);
      }
    },
    history: async (principal, partition, afterRevision, limit) =>
      (await administrator(principal, partition)) === undefined
        ? { result: "NotFound" }
        : {
            result: "Found",
            revisions: await store.history(
              partition,
              checkedSelectorProjectRevision(afterRevision),
              checkedHistoryLimit(limit),
            ),
          },
  };
}
