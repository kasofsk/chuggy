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
const commit = "a".repeat(40);

test("an import accepts only a full lowercase 40-character commit hash", () => {
  for (const invalid of ["", "a".repeat(39), "A".repeat(40), "a".repeat(64)]) {
    const transition = repositoryConfigurationImportSubmitted(
      repositoryConfigurationImportEdited(invalid),
      "token",
      partition,
    );
    assert.equal(transition.state.status, "Editing");
    assert.match(
      transition.state.status === "Editing"
        ? (transition.state.issue ?? "")
        : "",
      /40-character lowercase/u,
    );
    assert.equal(transition.request, undefined);
  }
});

test("submission enters an honest in-flight state and returns the contract request", () => {
  const transition = repositoryConfigurationImportSubmitted(
    repositoryConfigurationImportEdited(commit),
    "token",
    partition,
  );
  assert.deepEqual(transition.state, { status: "Submitting", commit });
  assert.deepEqual(transition.request, {
    method: "POST",
    url: "/api/v1/tenants/acme/projects/atlas/configurations/imports",
    headers: {
      accept: "application/vnd.chuggy.v1+json",
      authorization: "Bearer token",
      "content-type": "application/vnd.chuggy.v1+json",
    },
    body: JSON.stringify({ commit }),
  });
});

test("success emits the event that invalidates the registry", () => {
  const state = { status: "Submitting" as const, commit };
  assert.deepEqual(
    repositoryConfigurationImportAnswered(state, {
      outcome: "Ok",
      body: { imported: true },
    }),
    {
      state: { status: "Succeeded", commit },
      event: { event: "ConfigurationsChanged" },
    },
  );
});

test("a declaration refusal becomes structured display data", () => {
  const path = [".chug", "configurations", "work.json"].join("/");
  const result = repositoryConfigurationImportAnswered(
    { status: "Submitting", commit },
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
      commit,
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
  const state = { status: "Submitting" as const, commit };
  assert.deepEqual(
    repositoryConfigurationImportAnswered(state, {
      outcome: "Rejected",
      code: "RepositoryConfigurationsRefused",
      status: 422,
      body: { faults: [{ surprise: true }] },
    }),
    { state: { status: "Unavailable", commit, reason: unreadableReason } },
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
        commit,
        reason: "Import is temporarily unavailable: RepositoryUnavailable.",
      },
    },
  );
});

test("editing starts blank and replaces every settled state", () => {
  assert.deepEqual(repositoryConfigurationImportInitial(), {
    status: "Editing",
    commit: "",
    issue: undefined,
  });
  assert.deepEqual(repositoryConfigurationImportEdited(commit), {
    status: "Editing",
    commit,
    issue: undefined,
  });
});
