/**
 * What a project binds, what the picker offers, and what one bind came to.
 *
 * THE MARK IS THE ADDRESS AND NOTHING DERIVED FROM IT. A binding names a
 * repository by the address the forge listing gives it, so a row marked bound
 * by its name would mark the wrong one the day two accounts hold a repository
 * of the same name.
 */

import { expect, test } from "vitest";

import type { ForgeRepositoryResponse } from "../../../src/contract/responses.ts";
import type { ApiResult } from "../app/core/apiRequest.ts";
import type { ProjectRepositoryBindAnswer } from "../app/core/apiRoutes.ts";
import {
  repositoryBindLines,
  repositoryBindOutcome,
  repositoryBindStatus,
  repositoryChoices,
  repositoryLabel,
} from "../app/core/projectRepositories.ts";
import { repositoryRefusalsDrawn } from "./repositoryRefusals.ts";

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
        landing: { mode: "Push" as const },
      },
    ],
  );
  expect(choices.map((choice) => choice.bound)).toEqual([true, false]);
});

function status(result: ApiResult<ProjectRepositoryBindAnswer>): string {
  return repositoryBindStatus(repositoryBindOutcome(result));
}

function answered(): ApiResult<ProjectRepositoryBindAnswer> {
  return {
    outcome: "Ok",
    value: {
      repository: "https://forge.test/kasofsk/chuggy",
      landing: { mode: "Push" },
    },
  };
}

const alreadyBound: ApiResult<ProjectRepositoryBindAnswer> = {
  outcome: "Ok",
  value: { repository: "https://forge.test/kasofsk/chuggy" },
};

/** The route answers `201` carrying the configurations and `200` carrying the
 * repository alone, and the classifier keeps neither status, so the body is
 * what tells the two apart. */
test("a bind of a repository already bound says so", () => {
  expect(status(answered())).toBe("Bound");
  expect(status(alreadyBound)).toBe("Already bound");
});

test("a new binding draws its status", () => {
  expect(repositoryBindLines(repositoryBindOutcome(alreadyBound))).toEqual([
    "Already bound",
  ]);
  expect(repositoryBindLines(repositoryBindOutcome(answered()))).toEqual([
    "Bound",
  ]);
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
  repositoryRefusalsDrawn(status);
});
