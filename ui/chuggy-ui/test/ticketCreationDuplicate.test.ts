/**
 * A duplicate whose original's configuration is no longer offered, as the
 * creation form takes it on: started where a new ticket starts, and holding
 * what it carried until a configuration is chosen.
 */

import { expect, test } from "vitest";

import type { DraftResponse } from "../../../src/contract/responses.ts";
import {
  creationBodyFrom,
  creationConfigurationChosen,
} from "../app/core/ticketCreation.ts";
import { ticketDuplicateSeed } from "../app/core/ticketDuplicate.ts";
import {
  creationBinding,
  creationDeclared,
  creationDraft,
  creationOffer,
} from "./ticketCreationFixture.ts";

const chuggy = "https://forge.test/kasofsk/chuggy";

const commanding = { commandedCheckStage: 1 };
const offers = [
  creationOffer(
    creationDeclared("n-development", chuggy, "development"),
    commanding,
  ),
  creationOffer(
    creationDeclared("n-sonnet", chuggy, "development-sonnet"),
    commanding,
  ),
];

/** Authored under a name the project no longer declares. */
const original: DraftResponse = {
  ...creationDraft,
  configurationRevision: "o-opus",
  configurationVersion: { name: "development-opus", number: 2 },
  authoring: {
    dependencies: [7, 40],
    program: [
      { key: 1, evaluators: [{ key: 1 }, { key: 2 }] },
      { key: 2, evaluators: [{ key: 1 }] },
    ],
  },
  brief: {
    intent: "ship the thing",
    links: [],
    checks: ["npm test"],
    repository: chuggy,
    finalization: { mode: "Push" },
  },
};

const seed = ticketDuplicateSeed({
  draft: original,
  offers,
  bound: [creationBinding(chuggy)],
  revoked: [],
  preferred: undefined,
  partial: false,
});

test("the form asks, and names no configuration it would send", () => {
  expect(seed.form.configuration).toBe("");
  const sent = creationBodyFrom(offers, seed.form, [creationBinding(chuggy)]);
  expect(
    sent.assembled === "Faults" && sent.faults.map((fault) => fault.field),
  ).toStrictEqual(["configuration"]);
});

test("choosing one leaves the carried checks, dependencies and program, and sends them", () => {
  const chosen = creationConfigurationChosen(seed.form, offers, "development");
  expect(chosen.checks).toStrictEqual(["npm test"]);
  expect(chosen.dependencies).toStrictEqual([7, 40]);
  expect(chosen.program).toStrictEqual(original.authoring.program);
  const sent = creationBodyFrom(offers, chosen, [creationBinding(chuggy)]);
  expect(sent.assembled === "Body" && sent.body).toMatchObject({
    configurationRevision: "n-development",
    authoring: original.authoring,
    brief: { checks: ["npm test"] },
  });
});
