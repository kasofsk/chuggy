/**
 * What a project binds, what the picker offers, and what one bind came to.
 *
 * THE MARK IS THE ADDRESS AND NOTHING DERIVED FROM IT. A binding names a
 * repository by the address the forge listing gives it, so a row marked bound
 * by its name would mark the wrong one the day two accounts hold a repository
 * of the same name.
 */

import { expect, test } from "vitest";

import type {
  ForgeRepositoryResponse,
  ProjectRepositoryBoundResponse,
} from "../../../src/contract/responses.ts";
import type { ApiResult } from "../app/core/apiRequest.ts";
import {
  repositoryBindOutcome,
  repositoryBindStatus,
  repositoryChoices,
  repositoryLabel,
} from "../app/core/projectRepositories.ts";

function reachable(
  over: Partial<ForgeRepositoryResponse>,
): ForgeRepositoryResponse {
  return {
    name: "chuggy",
    fullName: "kasofsk/chuggy",
    url: "https://forge.test/kasofsk/chuggy",
    defaultBranch: "main",
    private: true,
    ...over,
  };
}

test("a repository is labelled by the account and the name it is under", () => {
  expect(repositoryLabel("https://forge.test/kasofsk/chuggy")).toBe(
    "kasofsk/chuggy",
  );
  expect(repositoryLabel("chuggy")).toBe("chuggy");
});

test("a row is marked bound by the address the binding names", () => {
  const choices = repositoryChoices(
    [
      reachable({}),
      reachable({
        fullName: "gdoteof/chuggy",
        url: "https://forge.test/gdoteof/chuggy",
      }),
    ],
    [
      {
        repository: "https://forge.test/kasofsk/chuggy",
        boundAt: "2026-09-11T00:00:00Z",
      },
    ],
  );
  expect(choices.map((choice) => choice.bound)).toEqual([true, false]);
});

function status(
  result: ApiResult<ProjectRepositoryBoundResponse>,
  boundBefore = false,
): string {
  return repositoryBindStatus(repositoryBindOutcome(result, boundBefore));
}

const bound: ApiResult<ProjectRepositoryBoundResponse> = {
  outcome: "Ok",
  value: { repository: "https://forge.test/kasofsk/chuggy" },
};

/** The route answers `201` for a new binding and `200` for one that stood, and
 * the classifier keeps neither status, so the bindings already read are what
 * tell the two apart. */
test("a bind of a row the page already showed bound says so", () => {
  expect(status(bound)).toBe("Bound");
  expect(status(bound, true)).toBe("Already bound");
});

test("each refusal is the one line the picker draws under itself", () => {
  expect(
    status({
      outcome: "Rejected",
      code: "RepositoryNotInstalled",
      status: 422,
      body: undefined,
    }),
  ).toBe("Not installed");
  expect(
    status({ outcome: "Conflict", code: "RepositoryBound", body: undefined }),
  ).toBe("Bound elsewhere");
  expect(
    status({ outcome: "Conflict", code: "OperationConflict", body: undefined }),
  ).toBe("Conflict");
  expect(
    status({
      outcome: "Retryable",
      code: "ForgeUnavailable",
      retryAfterSeconds: 5,
    }),
  ).toBe("Deferring");
  expect(status({ outcome: "Absent" })).toBe("Not found");
});
