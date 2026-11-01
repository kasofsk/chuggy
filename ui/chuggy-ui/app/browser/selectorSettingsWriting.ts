/**
 * The one door a write of the selector settings goes through, wherever a page
 * draws it: a draft seeded from the read and rebased when the read moves under
 * an open form, and a write fenced on the revision the draft was seeded at.
 *
 * EVERY WRITE THROUGH THIS DOOR IS THE WHOLE OVERRIDE SET, which is what makes
 * it one door rather than two: the settings page's sections and revisions, and
 * the Lead page's strip, each hold their own draft and their own call into it,
 * but the fencing, the rebase and the conflict handling are the same for all of
 * them. `TWriter` is each page's own roster of what on it can write, carried in
 * the write itself, so a page with several — a section, the history — can tell
 * which one a given answer belongs to.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { SelectorProjectSettingsResponse } from "../../../../src/contract/responses.ts";
import { apiWriteSelectorSettings } from "../core/apiRoutes.ts";
import { consoleWriteKey } from "../core/consoleWrite.ts";
import type { ConsoleWrite } from "../core/consoleWrite.ts";
import { selectorSettingsQuery } from "../core/projectQueries.ts";
import {
  selectorSettingsConflictOf,
  selectorSettingsDraft,
  selectorSettingsRebased,
  selectorSettingsRefusal,
} from "../core/selectorSettingsForm.ts";
import type {
  SelectorProjectOverrides,
  SelectorSettingsDraft,
} from "../core/selectorSettingsForm.ts";
import { useConsoleWrite } from "./consoleWrite.tsx";
import type { ConsoleWriting } from "./consoleWrite.tsx";
import { nowMs } from "./ports.ts";

export interface SelectorSettingsHeld {
  readonly draft: SelectorSettingsDraft;
  readonly setDraft: (draft: SelectorSettingsDraft) => void;
}

/**
 * The draft, seeded from the read and rebased when THE READ moves — not when
 * the draft and the read merely differ, since a conflict moves the draft's own
 * revision ahead of the read's. It is a rebase rather than a reseed because a
 * read can move under an open form at any moment, including between a Save
 * click and its answer, and a reseed would take back text the reader had typed
 * in that window.
 */
export function useSelectorSettingsDraft(
  settings: SelectorProjectSettingsResponse,
): SelectorSettingsHeld {
  const [draft, setDraft] = useState<SelectorSettingsDraft>(() =>
    selectorSettingsDraft(settings),
  );
  const [seen, setSeen] = useState(settings.revision);
  if (seen !== settings.revision) {
    setSeen(settings.revision);
    const rebased = selectorSettingsRebased(draft, settings);
    setDraft(rebased);
    return { draft: rebased, setDraft };
  }
  return { draft, setDraft };
}

/** One press: which part of the page asked, the override set, and the
 * revision the draft was seeded at. */
export interface SelectorSettingsPressed<TWriter extends string> {
  readonly writer: TWriter;
  readonly expectedRevision: number;
  readonly overrides: SelectorProjectOverrides;
}

/**
 * The whole override set written under the draft's revision. A write that
 * landed IS the newest read, so it is written into the settings key rather
 * than left for a refetch nothing schedules — the route raises no `Project`
 * frame, and the console would otherwise resend the revision it has just moved
 * and be told by itself that somebody else wrote.
 */
function selectorSettingsSaveWrite<TWriter extends string>(
  partition: PartitionIdentity,
): ConsoleWrite<
  SelectorSettingsPressed<TWriter>,
  SelectorProjectSettingsResponse
> {
  return {
    mutationKey: consoleWriteKey(
      "selector-settings",
      partition.tenant,
      partition.project,
    ),
    write: (ports, pressed) =>
      apiWriteSelectorSettings(ports, partition, {
        expectedRevision: pressed.expectedRevision,
        overrides: pressed.overrides,
      }),
    refusal: (failure) => selectorSettingsRefusal(failure, nowMs()),
    landed: (client, settings) =>
      Promise.resolve(
        client.setQueryData(
          selectorSettingsQuery(partition).queryKey,
          settings,
        ),
      ),
  };
}

/** What a widget draws of the page's write: the part of it no press reaches. */
export type SelectorSettingsShown = Pick<
  ConsoleWriting<
    SelectorSettingsPressed<string>,
    SelectorProjectSettingsResponse
  >,
  "isPending" | "isSuccess" | "error" | "data"
>;

/** The one door a write on a page goes through, and what it answered. */
export interface SelectorSettingsWriting<TWriter extends string> {
  readonly saving: ConsoleWriting<
    SelectorSettingsPressed<TWriter>,
    SelectorProjectSettingsResponse
  >;
  readonly write: (
    writer: TWriter,
    overrides: SelectorProjectOverrides,
    wrote: () => void,
  ) => void;
  readonly reload: () => void;
}

/**
 * The page's door. A conflict moves the draft, keeping what the reader typed
 * and taking the revision and the untouched overrides the route says stand, so
 * the next Save is a decision they make once rather than a button that can
 * only refuse.
 */
export function useSelectorSettingsWriting<TWriter extends string>(
  partition: PartitionIdentity,
  held: SelectorSettingsHeld,
): SelectorSettingsWriting<TWriter> {
  const client = useQueryClient();
  const saving = useConsoleWrite(selectorSettingsSaveWrite<TWriter>(partition));
  return {
    saving,
    reload: () => {
      void client.invalidateQueries({
        queryKey: selectorSettingsQuery(partition).queryKey,
      });
    },
    write: (writer, overrides, wrote) => {
      saving.mutate(
        { writer, expectedRevision: held.draft.revision, overrides },
        {
          onSuccess: wrote,
          onError: (refused) => {
            const conflict = selectorSettingsConflictOf(refused.failure);
            if (conflict !== undefined)
              held.setDraft(
                selectorSettingsRebased(held.draft, conflict.settings),
              );
          },
        },
      );
    },
  };
}

/** The write a widget draws, where the page's last press was its own; nothing
 * where it belongs to another. */
export function selectorSettingsShown<TWriter extends string>(
  writing: SelectorSettingsWriting<TWriter>,
  writer: TWriter,
): SelectorSettingsShown | undefined {
  return writing.saving.variables?.writer === writer
    ? writing.saving
    : undefined;
}
