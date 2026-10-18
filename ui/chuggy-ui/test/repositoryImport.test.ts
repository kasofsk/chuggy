/**
 * A repository's last import as its line says it, and what an Import now's
 * answer leaves to be said, for every way either can come out.
 */

import { expect, test } from "vitest";

import type { RepositoryConfigurationImportAttemptResponse } from "../../../src/contract/responses.ts";
import {
  repositoryConfigurationImportAbsences,
  repositoryConfigurationImportResults,
} from "../../../src/contract/rosters.ts";
import {
  repositoryImportLine,
  repositoryImportNote,
} from "../app/core/repositoryImport.ts";
import { repositoryImportTone } from "../app/core/tones.ts";

const commit = "cfaca0a0f14ec03845a4e01458ac6c3a56d52a23";
const attemptedAt = "2026-10-17T09:30:00.000000Z";

/** Every outcome a kept attempt can carry, each with a commit read and with none. */
const outcomes: readonly RepositoryConfigurationImportAttemptResponse["outcome"][] =
  repositoryConfigurationImportResults.flatMap(
    (result): RepositoryConfigurationImportAttemptResponse["outcome"][] =>
      result === "SnapshotAbsent"
        ? repositoryConfigurationImportAbsences.map((absent) => ({
            result,
            absent,
          }))
        : [{ result }],
  );

test("every kept outcome is one word and a tone, a head that named no commit an empty repository", () => {
  const drawn = outcomes.flatMap((outcome) =>
    [commit, undefined].map((read) => {
      const line = repositoryImportLine({
        attemptedAt,
        ...(read === undefined ? {} : { commit: read }),
        outcome,
      });
      return [
        `${outcome.result}${"absent" in outcome ? `/${outcome.absent}` : ""}${read === undefined ? "" : "@"}`,
        line.word,
        repositoryImportTone(line.word),
      ];
    }),
  );
  expect(drawn).toStrictEqual([
    ["Imported@", "Imported", "pass"],
    ["Imported", "Imported", "pass"],
    ["SnapshotAbsent/Commit@", "Missing", "fail"],
    ["SnapshotAbsent/Commit", "Empty", "neutral"],
    ["SnapshotAbsent/ConfigurationDirectory@", "Undeclared", "neutral"],
    ["SnapshotAbsent/ConfigurationDirectory", "Undeclared", "neutral"],
    ["Unavailable@", "Unavailable", "parked"],
    ["Unavailable", "Unavailable", "parked"],
    ["SnapshotRefused@", "Unreadable", "fail"],
    ["SnapshotRefused", "Unreadable", "fail"],
    ["DeclarationsRefused@", "Invalid", "fail"],
    ["DeclarationsRefused", "Invalid", "fail"],
    ["IdentityConflict@", "Conflict", "fail"],
    ["IdentityConflict", "Conflict", "fail"],
    ["StaleBinding@", "Stale", "parked"],
    ["StaleBinding", "Stale", "parked"],
  ]);
});

test("a line names when and at which commit, and a repository never attempted says Never", () => {
  expect(
    repositoryImportLine({
      attemptedAt,
      commit,
      outcome: { result: "Imported" },
    }),
  ).toStrictEqual({
    word: "Imported",
    attemptedAt,
    commit: { text: "cfaca0a", title: commit },
  });
  expect(repositoryImportLine(undefined)).toStrictEqual({ word: "Never" });
  expect(repositoryImportTone("Never")).toBe("neutral");
});

/** Each refusal the route answers with a code of its own is the word the line draws the attempt it kept in. */
test.each([
  [{ outcome: "Ok", value: { imported: true } }, undefined],
  [
    {
      outcome: "Rejected",
      code: "RepositoryConfigurationsAbsent",
      status: 422,
      body: {},
    },
    "Undeclared",
  ],
  [
    {
      outcome: "Rejected",
      code: "RepositorySnapshotRefused",
      status: 422,
      body: {},
    },
    "Unreadable",
  ],
  [
    {
      outcome: "Rejected",
      code: "RepositoryConfigurationsRefused",
      status: 422,
      body: {},
    },
    "Invalid",
  ],
  [{ outcome: "Rejected", code: "Other", status: 422, body: {} }, "Refused"],
  [
    { outcome: "Conflict", code: "ConfigurationIdentityConflict", body: {} },
    "Conflict",
  ],
  [
    { outcome: "Conflict", code: "RepositoryBindingChanged", body: {} },
    "Stale",
  ],
  [
    {
      outcome: "Retryable",
      code: "RepositoryUnavailable",
      retryAfterSeconds: 1,
    },
    "Unavailable",
  ],
  [{ outcome: "Absent" }, "Not found"],
  [{ outcome: "Unauthenticated" }, "Not signed in"],
  [{ outcome: "Unreachable", reason: "offline" }, "Unreachable"],
] as const)("an import answered %j leaves %s to be said", (answered, note) => {
  expect(repositoryImportNote(answered)).toBe(note);
});
