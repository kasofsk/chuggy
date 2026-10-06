/**
 * The one door a write of the selector settings goes through, wherever a page
 * draws it: a draft seeded from the read and rebased when the read moves under
 * an open form, and a write fenced on the revision the draft was seeded at.
 *
 * EVERY WRITE THROUGH THIS DOOR IS THE WHOLE OVERRIDE SET, which is what makes
 * it one door rather than two: the settings page's sections and revisions, and
 * the Lead page's strip, each hold their own draft and their own call into it,
 * but the fencing, the rebase and the conflict handling are the same for all of
 * them. `TWriter` is each page's own roster of what on it can write, so a page
 * with several — a section, the history — can tell which one a given answer
 * belongs to; a page with one still names it, so Idle reads the same way
 * everywhere.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { SelectorProjectSettingsResponse } from "../../../../src/contract/responses.ts";
import { apiWriteSelectorSettings } from "../core/apiRoutes.ts";
import { projectResourceKey } from "../core/projectQueryKeys.ts";
import {
  selectorSettingsAnswered,
  selectorSettingsDraft,
  selectorSettingsRebased,
} from "../core/selectorSettingsForm.ts";
import type {
  SelectorProjectOverrides,
  SelectorSettingsDraft,
  SelectorSettingsSaved,
} from "../core/selectorSettingsForm.ts";
import { useApiPorts } from "./api.ts";

/** No frame names either read, so the partition's own refetch is what reaches
 * them. */
export const selectorSettingsResource = "selector-settings";

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

/**
 * What a write's own answer does to the page: a write that landed IS the newest
 * read, so it is written into the settings key rather than left for a refetch
 * nothing schedules — the route raises no `Project` frame, and the console
 * would otherwise resend the revision it has just moved and be told by itself
 * that somebody else wrote. A conflict moves the draft instead, keeping what
 * the reader typed and taking the revision and the untouched overrides the
 * route says stand, so the next Save is a decision they make once rather than a
 * button that can only refuse.
 */
function selectorSettingsApply(
  answered: SelectorSettingsSaved,
  held: SelectorSettingsHeld,
  wrote: (settings: SelectorProjectSettingsResponse) => void,
): void {
  switch (answered.saved) {
    case "Written":
      wrote(answered.settings);
      return;
    case "Conflict":
      held.setDraft(selectorSettingsRebased(held.draft, answered.settings));
      return;
    case "Idle":
    case "Writing":
    case "Failed":
      return;
  }
}

/** The one door a write on a page goes through, and what it answered. */
export interface SelectorSettingsWriting<TWriter extends string> {
  readonly saved: SelectorSettingsSaved;
  readonly writer: TWriter | undefined;
  readonly write: (
    writer: TWriter,
    overrides: SelectorProjectOverrides,
    wrote: () => void,
  ) => void;
  readonly reload: () => void;
}

export function useSelectorSettingsWriting<TWriter extends string>(
  partition: PartitionIdentity,
  held: SelectorSettingsHeld,
): SelectorSettingsWriting<TWriter> {
  const ports = useApiPorts();
  const client = useQueryClient();
  const [saved, setSaved] = useState<SelectorSettingsSaved>({ saved: "Idle" });
  const [writer, setWriter] = useState<TWriter | undefined>(undefined);
  const key = projectResourceKey(
    partition,
    "Project",
    selectorSettingsResource,
  );
  return {
    saved,
    writer,
    reload: () => {
      void client.invalidateQueries({ queryKey: key });
    },
    write: (asked, overrides, wrote) => {
      setWriter(asked);
      setSaved({ saved: "Writing" });
      void (async () => {
        const answered = selectorSettingsAnswered(
          await apiWriteSelectorSettings(ports, partition, {
            expectedRevision: held.draft.revision,
            overrides,
          }),
        );
        setSaved(answered);
        selectorSettingsApply(answered, held, (settings) => {
          client.setQueryData(key, settings);
          wrote();
        });
      })();
    },
  };
}

/** Which writer's answer a widget is drawing: its own last write, or Idle
 * where the last write on the page's door belongs to another. */
export function selectorSettingsSaved<TWriter extends string>(
  writing: SelectorSettingsWriting<TWriter>,
  writer: TWriter,
): SelectorSettingsSaved {
  return writing.writer === writer ? writing.saved : { saved: "Idle" };
}
