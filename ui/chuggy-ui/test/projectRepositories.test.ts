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
  ProjectRepositoryConfigurationsResponse,
} from "../../../src/contract/responses.ts";
import type { ApiResult } from "../app/core/apiRequest.ts";
import type { ProjectRepositoryBindAnswer } from "../app/core/apiRoutes.ts";
import {
  repositoryBindLines,
  repositoryBindOutcome,
  repositoryBindStatus,
  repositoryChoices,
  repositoryConfigureStatus,
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

function answered(
  configurations: ProjectRepositoryConfigurationsResponse,
): ApiResult<ProjectRepositoryBindAnswer> {
  return {
    outcome: "Ok",
    value: {
      repository: "https://forge.test/kasofsk/chuggy",
      landing: { mode: "Push" },
      configurations,
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
  expect(status(answered({ result: "Imported", count: 2 }))).toBe("Bound");
  expect(status(alreadyBound)).toBe("Already bound");
});

test("a new binding draws what its own configurations came to", () => {
  expect(repositoryBindLines(repositoryBindOutcome(alreadyBound))).toEqual([
    "Already bound",
  ]);
  expect(
    repositoryBindLines(
      repositoryBindOutcome(answered({ result: "Imported", count: 3 })),
    ),
  ).toEqual(["Bound", "Imported"]);
  expect(
    repositoryBindLines(
      repositoryBindOutcome(
        answered({ result: "Bootstrapped", revision: "r1" }),
      ),
    ),
  ).toEqual(["Bound", "Bootstrapped"]);
  expect(
    repositoryBindLines(
      repositoryBindOutcome(
        answered({ result: "Deferred", reason: "StepFailed" }),
      ),
    ),
  ).toEqual(["Bound", "Deferred · StepFailed"]);
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

/** A retired binding is the one refusal that says what to do, so it alone gets its own word. */
test("a configuration step asked for again draws its outcome, or the refusal it met", () => {
  const configured = (
    configurations: ProjectRepositoryConfigurationsResponse,
  ): string =>
    repositoryConfigureStatus({
      outcome: "Ok",
      value: {
        repository: "https://forge.test/kasofsk/chuggy",
        configurations,
      },
    });
  expect(configured({ result: "Imported", count: 1 })).toBe("Imported");
  expect(configured({ result: "Bootstrapped", revision: "bootstrap" })).toBe(
    "Bootstrapped",
  );
  expect(
    configured({ result: "Deferred", reason: "DefaultBranchUnavailable" }),
  ).toBe("Deferred · DefaultBranchUnavailable");
  expect(
    repositoryConfigureStatus({
      outcome: "Conflict",
      code: "RepositoryRetired",
      body: undefined,
    }),
  ).toBe("Retired");
  expect(
    repositoryConfigureStatus({
      outcome: "Conflict",
      code: "SomethingElse",
      body: undefined,
    }),
  ).toBe("Conflict");
  expect(
    repositoryConfigureStatus({
      outcome: "Rejected",
      code: "InvalidRequest",
      status: 400,
      body: undefined,
    }),
  ).toBe("Refused");
  expect(repositoryConfigureStatus({ outcome: "Absent" })).toBe("Not found");
});
