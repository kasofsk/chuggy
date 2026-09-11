/**
 * What a create asks for, and what one create came to.
 *
 * THE REFUSALS ARE READ FROM THE ENVELOPE AND NOT FROM THE STATUS. A create
 * earns refusals a bind never does and the bind's own besides, because the
 * route finishes by binding what it made.
 */

import { expect, test } from "vitest";

import { nativeHttpError } from "../../../src/contract/http.ts";
import type { ProjectRepositoryCreatedResponse } from "../../../src/contract/responses.ts";
import type { ApiResult } from "../app/core/apiRequest.ts";
import {
  repositoryCreateNameFault,
  repositoryCreateOutcome,
  repositoryCreatedRows,
  repositoryRulesetStatus,
  repositoryVisibilityLabel,
} from "../app/core/projectRepositoryCreate.ts";
import { repositoryRefusalsDrawn } from "./repositoryRefusals.ts";

function created(
  over: Partial<ProjectRepositoryCreatedResponse>,
): ProjectRepositoryCreatedResponse {
  return {
    repository: "https://forge.test/kasofsk/scratch",
    created: {
      account: "kasofsk",
      name: "scratch",
      url: "https://forge.test/kasofsk/scratch",
    },
    seeded: true,
    ruleset: { result: "Created" },
    configurations: { result: "Bootstrapped", revision: "r1" },
    ...over,
  };
}

function status(result: ApiResult<ProjectRepositoryCreatedResponse>): string {
  const outcome = repositoryCreateOutcome(result);
  return outcome.outcome === "Refused" ? outcome.status : "Created";
}

function rejected(
  code: string,
  message: string,
): ApiResult<ProjectRepositoryCreatedResponse> {
  return {
    outcome: "Rejected",
    code,
    status: 422,
    body: nativeHttpError(code, message),
  };
}

test("a name the wire's own field refuses is refused before it is sent", () => {
  expect(repositoryCreateNameFault("")).toBe("Empty");
  expect(repositoryCreateNameFault("scratch")).toBeUndefined();
});

test("each visibility is named as a person reads it", () => {
  expect(repositoryVisibilityLabel("private")).toBe("Private");
  expect(repositoryVisibilityLabel("public")).toBe("Public");
});

test("the ruleset is the one line it came to, a refusal carrying its own", () => {
  expect(repositoryRulesetStatus({ result: "Created" })).toBe("Created");
  expect(
    repositoryRulesetStatus({ result: "Refused", message: "no branch yet" }),
  ).toBe("Refused · no branch yet");
  expect(repositoryRulesetStatus({ result: "Skipped" })).toBe("Skipped");
  expect(repositoryRulesetStatus({ result: "Unavailable" })).toBe(
    "Unavailable",
  );
});

test("every step the create took is a row of its own", () => {
  expect(repositoryCreatedRows(created({}))).toEqual([
    { label: "Seed", detail: "Seeded" },
    { label: "Ruleset", detail: "Created" },
    { label: "Configurations", detail: "Bootstrapped" },
  ]);
  expect(
    repositoryCreatedRows(
      created({
        seeded: false,
        ruleset: { result: "Skipped" },
        configurations: { result: "Deferred", reason: "StepFailed" },
      }),
    ),
  ).toEqual([
    { label: "Seed", detail: "Not seeded" },
    { label: "Ruleset", detail: "Skipped" },
    { label: "Configurations", detail: "Deferred · StepFailed" },
  ]);
});

/** The envelope carries a code and a message and nothing else, so which app is
 * missing is read out of the message against the roster's own words. */
test("a missing claim names the app the message names", () => {
  expect(
    status(
      rejected(
        "InstallationMissing",
        "This tenant has claimed no worker installation on the account.",
      ),
    ),
  ).toBe("Missing: worker");
  expect(
    status(
      rejected(
        "InstallationMissing",
        "This tenant has claimed no portal installation on the account.",
      ),
    ),
  ).toBe("Missing: portal");
  expect(status(rejected("InstallationMissing", "A claim is missing."))).toBe(
    "Missing",
  );
});

test("each refusal is the one line the dialog draws under itself", () => {
  expect(
    status(
      rejected(
        "PersonalAccountCreatesOnGitHub",
        "Create the repository on the forge and bind it here.",
      ),
    ),
  ).toBe("Create on GitHub, then add");
  expect(
    status(rejected("ForgeRefused", "The forge refused the seed: no content.")),
  ).toBe("Refused · The forge refused the seed: no content.");
  expect(status(rejected("RepositoryNotInstalled", "Not installed."))).toBe(
    "Not installed",
  );
  expect(status(rejected("InvalidRequest", "Bad body."))).toBe("Refused");
  expect(
    status({
      outcome: "Conflict",
      code: "RepositoryExists",
      body: nativeHttpError("RepositoryExists", "Already there."),
    }),
  ).toBe("Exists — add it");
  repositoryRefusalsDrawn(status);
});

test("a create that took answers what it made", () => {
  const outcome = repositoryCreateOutcome({
    outcome: "Ok",
    value: created({}),
  });
  expect(outcome).toEqual({ outcome: "Created", created: created({}) });
});
