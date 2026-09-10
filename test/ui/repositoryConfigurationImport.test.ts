import assert from "node:assert/strict";
import test from "node:test";

import {
  repositoryConfigurationImportAnswered,
  repositoryConfigurationImportEdited,
  repositoryConfigurationImportInitial,
  repositoryConfigurationImportSubmitted,
} from "../../ui/console/app/repositoryConfigurationImport.js";
import { unreadableReason } from "../../ui/console/app/outcomes.js";

const partition = { tenant: "acme", project: "atlas" };
const repository = "chuggy";
const commit = "a".repeat(40);
const source = { repository, commit };

/** The issue a submission settles on, or the status when it did not settle on one. */
function submissionIssue(edited: { repository: string; commit: string }) {
  const transition = repositoryConfigurationImportSubmitted(
    repositoryConfigurationImportEdited(edited),
    "token",
    partition,
  );
  assert.equal(transition.request, undefined);
  return transition.state.status === "Editing"
    ? (transition.state.issue ?? "")
    : transition.state.status;
}

test("an import accepts only a full lowercase 40-character commit hash", () => {
  for (const invalid of ["", "a".repeat(39), "A".repeat(40), "a".repeat(64)])
    assert.match(
      submissionIssue({ repository, commit: invalid }),
      /40-character lowercase/u,
    );
});

test("an import that names no repository is refused before the commit is read", () => {
  assert.match(submissionIssue({ repository: "", commit }), /repository/u);
});

test("submission enters an honest in-flight state and returns the contract request", () => {
  const transition = repositoryConfigurationImportSubmitted(
    repositoryConfigurationImportEdited(source),
    "token",
    partition,
  );
  assert.deepEqual(transition.state, {
    status: "Submitting",
    ...source,
  });
  assert.deepEqual(transition.request, {
    method: "POST",
    url: "/api/v1/tenants/acme/projects/atlas/configurations/imports",
    headers: {
      accept: "application/vnd.chuggy.v1+json",
      authorization: "Bearer token",
      "content-type": "application/vnd.chuggy.v1+json",
    },
    body: JSON.stringify({ repository, commit }),
  });
});

test("success emits the event that invalidates the registry", () => {
  const state = { status: "Submitting" as const, ...source };
  assert.deepEqual(
    repositoryConfigurationImportAnswered(state, {
      outcome: "Ok",
      body: { imported: true },
    }),
    {
      state: { status: "Succeeded", ...source },
      event: { event: "ConfigurationsChanged" },
    },
  );
});

test("a declaration refusal becomes structured display data", () => {
  const path = [".chug", "configurations", "work.json"].join("/");
  const result = repositoryConfigurationImportAnswered(
    { status: "Submitting", ...source },
    {
      outcome: "Rejected",
      code: "RepositoryConfigurationsRefused",
      status: 422,
      body: {
        faults: [
          {
            path,
            fault: "ConfigurationInvalid",
            configurationFault: "WorkInvalid",
          },
        ],
      },
    },
  );
  assert.deepEqual(result, {
    state: {
      status: "Rejected",
      ...source,
      faults: [
        {
          path,
          fault: "ConfigurationInvalid",
          label: "Invalid configuration",
          detail: "WorkInvalid",
        },
      ],
    },
  });
});

test("an unreadable refusal and unavailable transport settle visibly", () => {
  const state = { status: "Submitting" as const, ...source };
  assert.deepEqual(
    repositoryConfigurationImportAnswered(state, {
      outcome: "Rejected",
      code: "RepositoryConfigurationsRefused",
      status: 422,
      body: { faults: [{ surprise: true }] },
    }),
    { state: { status: "Unavailable", ...source, reason: unreadableReason } },
  );
  assert.deepEqual(
    repositoryConfigurationImportAnswered(state, {
      outcome: "Retryable",
      code: "RepositoryUnavailable",
      retryAfterSeconds: 1,
    }),
    {
      state: {
        status: "Unavailable",
        ...source,
        reason: "Import is temporarily unavailable: RepositoryUnavailable.",
      },
    },
  );
});

test("editing starts blank and replaces every settled state", () => {
  assert.deepEqual(repositoryConfigurationImportInitial(), {
    status: "Editing",
    repository: "",
    commit: "",
    issue: undefined,
  });
  assert.deepEqual(repositoryConfigurationImportEdited(source), {
    status: "Editing",
    ...source,
    issue: undefined,
  });
});
