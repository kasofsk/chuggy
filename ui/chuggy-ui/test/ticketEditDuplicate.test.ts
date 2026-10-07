/**
 * What a duplicate's form is seeded with: the edit's own reading of the
 * original's draft, on the configuration the edit's matching finds, less a
 * repository no live binding offers and a dependency on a revoked ticket —
 * and the line naming what was not carried.
 */

import { expect, test } from "vitest";

import type {
  DraftResponse,
  TicketResponse,
} from "../../../src/contract/responses.ts";
import type { PanelState } from "../app/core/freshness.ts";
import { creationBodyFrom } from "../app/core/ticketCreation.ts";
import type { CreationOffer } from "../app/core/ticketCreation.ts";
import {
  ticketDuplicateDroppedSentence,
  ticketDuplicateRevoked,
  ticketDuplicateSeed,
} from "../app/core/ticketDuplicate.ts";
import { editFormFrom } from "../app/core/ticketEdit.ts";
import {
  creationBinding,
  creationDeclared,
  creationDraft,
  creationOffer,
} from "./ticketCreationFixture.ts";
import { ticketInstants } from "./ticketInstants.ts";

const chuggy = "https://forge.test/kasofsk/chuggy";
const other = "https://forge.test/kasofsk/other";

const brief = {
  title: "Ship it",
  intent: "ship the thing",
  links: ["https://example.test/one"],
  images: ["artifact-1"],
  checks: ["npm test"],
  repository: chuggy,
  branch: "refs/heads/topic/one",
  finalization: { mode: "PullRequest" as const, target: "refs/heads/main" },
};

/** A revoked ticket's draft, authored under an older commit's development. */
const original: DraftResponse = {
  ...creationDraft,
  state: "Released",
  authoringVersion: 5,
  releasedAuthoringVersion: 5,
  configurationRevision: "o-development",
  configurationVersion: { name: "development", number: 3 },
  authoring: {
    dependencies: [7, 40],
    program: [{ key: 1, evaluators: [{ key: 1 }, { key: 2 }] }],
  },
  brief,
};

function offered(revision: string, name: string, repository = chuggy) {
  return creationOffer(creationDeclared(revision, repository, name), {
    commandedCheckStage: 1,
  });
}

const development = offered("n-development", "development");
const sonnet = offered("n-sonnet", "development-sonnet");

function seeded(
  draft: DraftResponse,
  over: {
    readonly offers?: readonly CreationOffer[];
    readonly bound?: ReturnType<typeof creationBinding>[];
    readonly revoked?: readonly number[];
    readonly preferred?: string;
  } = {},
) {
  return ticketDuplicateSeed({
    draft,
    offers: over.offers ?? [development, sonnet],
    bound: over.bound ?? [creationBinding(chuggy)],
    revoked: over.revoked ?? [],
    preferred: over.preferred,
    partial: false,
  });
}

test("a duplicate holds every field the edit reads from the draft", () => {
  const seed = seeded(original);
  expect(seed.form).toStrictEqual(
    editFormFrom(original, [creationBinding(chuggy)], "development"),
  );
  expect(ticketDuplicateDroppedSentence(seed.dropped)).toBe(undefined);
});

test("an untouched duplicate sends the brief its draft holds", () => {
  const seed = seeded(original);
  const sent = creationBodyFrom([development, sonnet], seed.form, [
    creationBinding(chuggy),
  ]);
  expect(sent.assembled === "Body" && sent.body.brief).toStrictEqual(brief);
  expect(sent.assembled === "Body" && sent.body.authoring).toStrictEqual(
    original.authoring,
  );
  expect(sent.assembled === "Body" && sent.body.configurationRevision).toBe(
    "n-development",
  );
});

test("a draft recording no landing sends the repository's default", () => {
  const unlanded = {
    intent: brief.intent,
    links: brief.links,
    repository: chuggy,
    branch: brief.branch,
  };
  const seed = seeded(
    { ...original, brief: unlanded },
    { bound: [creationBinding(chuggy, "PullRequestMerge")] },
  );
  const sent = creationBodyFrom([development, sonnet], seed.form, [
    creationBinding(chuggy, "PullRequestMerge"),
  ]);
  expect(
    sent.assembled === "Body" && sent.body.brief.finalization,
  ).toStrictEqual({ mode: "PullRequestMerge" });
});

test("a draft holding no brief asks for what an edit of it would", () => {
  const unbriefed: DraftResponse = {
    ...creationDraft,
    configurationRevision: original.configurationRevision,
    authoring: original.authoring,
  };
  const seed = seeded(unbriefed);
  const sent = creationBodyFrom([development, sonnet], seed.form, [
    creationBinding(chuggy),
  ]);
  const fields =
    sent.assembled === "Faults" ? sent.faults.map((fault) => fault.field) : [];
  expect(fields).toContain("repository");
  expect(fields).toContain("intent");
});

test("the configuration is the offer at the draft's own revision first", () => {
  const atOwn = offered("o-development", "development · old");
  const seed = seeded(original, { offers: [development, atOwn, sonnet] });
  expect(seed.form.configuration).toBe("development · old");
});

test("otherwise it is the one offer declared under the draft's name", () => {
  expect(seeded(original).form.configuration).toBe("development");
});

test("a name declared by two repositories carries no configuration, and says so", () => {
  const seed = seeded(original, {
    offers: [
      { ...development, name: "development · kasofsk/chuggy" },
      {
        ...offered("x-development", "development", other),
        name: "development · kasofsk/other",
      },
    ],
  });
  expect(seed.form.configuration).toBe("");
  expect(seed.dropped.configuration).toBe("development");
});

test("a configuration no longer offered starts where a new ticket starts", () => {
  const gone = {
    ...original,
    configurationVersion: { name: "opus", number: 1 },
  };
  expect(seeded(gone).form.configuration).toBe("");
  expect(
    seeded(gone, { preferred: "development-sonnet" }).form.configuration,
  ).toBe("development-sonnet");
  const sole = seeded(gone, { offers: [sonnet] });
  expect(sole.form.configuration).toBe("development-sonnet");
  expect(ticketDuplicateDroppedSentence(sole.dropped)).toBe(
    "Not carried · configuration opus, no longer offered",
  );
});

test("a repository whose binding is retired is not carried, and is named", () => {
  const seed = seeded(original, {
    bound: [creationBinding(chuggy, "Push", "2026-09-01T00:00:00Z")],
  });
  expect(seed.form.repository).toBe("");
  expect(seed.form.landingMode).toBe("PullRequest");
  expect(ticketDuplicateDroppedSentence(seed.dropped)).toBe(
    "Not carried · repository kasofsk/chuggy, no longer bound",
  );
});

test("a dependency on a revoked ticket is not carried, and the others are, listed or not", () => {
  const seed = seeded(original, { revoked: [7] });
  expect(seed.form.dependencies).toStrictEqual([40]);
  expect(ticketDuplicateDroppedSentence(seed.dropped)).toBe(
    "Not carried · dependency on ticket 7, revoked",
  );
});

test("everything not carried is said in one line", () => {
  const seed = seeded(
    { ...original, configurationVersion: { name: "opus", number: 1 } },
    {
      bound: [creationBinding(chuggy, "Push", "2026-09-01T00:00:00Z")],
      revoked: [7, 40],
    },
  );
  expect(ticketDuplicateDroppedSentence(seed.dropped)).toBe(
    "Not carried · repository kasofsk/chuggy, no longer bound · dependency on ticket 7, revoked · dependency on ticket 40, revoked · configuration opus, no longer offered",
  );
});

function read(phase: TicketResponse["phase"]): PanelState<TicketResponse> {
  return {
    state: "Ready",
    value: { ticket: 7, phase, sequence: 3, ...ticketInstants },
    observedAtMs: undefined,
  };
}

test("a dependency is revoked by its own read, and one that could not be read is carried", () => {
  expect(
    ticketDuplicateRevoked(
      [7, 8, 9],
      [read("Revoked"), read("Done"), { state: "Failed", reason: "down" }],
    ),
  ).toStrictEqual([7]);
});

test("nothing is decided while a dependency is still being read", () => {
  expect(
    ticketDuplicateRevoked([7, 8], [read("Revoked"), { state: "Pending" }]),
  ).toBe(undefined);
});
