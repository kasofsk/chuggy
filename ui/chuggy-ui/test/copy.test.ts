/**
 * The copy catalog as the console formats it: the base language's words, a
 * vernacular layered over them, and the descriptors the decision layer hands
 * the layer that draws them.
 */

import { expect, test } from "vitest";

import { phaseRoster } from "../../../src/contract/rosters.ts";
import { copyCatalogEn, copyTextEn } from "../app/copy/catalog.ts";
import { copyBundleOf, copyTextOf } from "../app/copy/copyBundle.ts";
import { phaseLabel } from "../app/core/codeLabels.ts";
import type { Copy } from "../app/core/copy.ts";
import { epicGraphStanding } from "../app/core/epics.ts";

/** A vernacular that calls a ticket a job and the inbox a tray, and nothing else. */
const jobs = `
-tickets = { $case ->
    [upper] Jobs
   *[lower] jobs
}
-inbox = { $case ->
    [upper] Tray
   *[lower] tray
}
`;

test("the catalog loads every file of the base language", () => {
  const generated = Object.values(
    import.meta.glob<Readonly<Record<string, string>>>(
      "../app/copy/generated/*Ftl.ts",
      { eager: true },
    ),
  ).flatMap((module) => Object.values(module));
  expect([...copyCatalogEn].sort()).toStrictEqual(generated.sort());
});

test("a vernacular's term is the word inside every base message that references it", () => {
  const text = copyTextOf(copyBundleOf("en-x-jobs", copyCatalogEn, [jobs]));
  expect(text({ id: "shell-nav-tickets" })).toBe("Jobs");
  expect(text({ id: "shell-inbox-unread", args: { count: 3 } })).toBe(
    "Tray, 3 unread",
  );
  expect(text({ id: "shell-nav-epics" })).toBe("Epics");
});

test("the base language reads as it did with no layer over it", () => {
  expect(copyTextEn({ id: "shell-nav-tickets" })).toBe("Tickets");
  expect(copyTextEn({ id: "shell-inbox-unread", args: { count: 3 } })).toBe(
    "Inbox, 3 unread",
  );
  expect(copyTextEn({ id: "shell-project-new" })).toBe("New project");
});

test("every phase is a descriptor of its own, which reads as the phase's word", () => {
  const labels = phaseRoster.map(phaseLabel);
  expect(new Set(labels.map((label) => label.id)).size).toBe(
    phaseRoster.length,
  );
  expect(labels.map(copyTextEn)).toStrictEqual([
    "Pending",
    "Working",
    "Evaluating",
    "Finalizing",
    "Done",
    "Escalated",
    "Revoked",
  ]);
});

test("an epic's node stands at its phase, or as a draft where it has none", () => {
  expect(epicGraphStanding({ phase: "Work" })).toStrictEqual({
    id: "standing-work",
  });
  expect(epicGraphStanding({})).toStrictEqual({ id: "standing-draft" });
});

test("an id the catalog lacks, or a message without its variables, does not compile", () => {
  const unknown: Copy = {
    // @ts-expect-error the catalog has no such id
    id: "shell-nav-tickest",
  };
  // @ts-expect-error the message is formatted with a count
  const unformatted: Copy = { id: "shell-inbox-unread" };
  const misnamed: Copy = {
    id: "shell-inbox-unread",
    // @ts-expect-error the message's variable is named count
    args: { counted: 3 },
  };
  expect([unknown, unformatted, misnamed]).toHaveLength(3);
});
