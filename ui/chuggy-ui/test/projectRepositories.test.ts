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
  ForgeAppsResponse,
  ForgeInstallationResponse,
  ForgeInstallationsResponse,
  ForgeRepositoryResponse,
  ProjectRepositoryConfigurationsResponse,
} from "../../../src/contract/responses.ts";
import { projectRepositoryConfigurationDeferrals } from "../../../src/contract/rosters.ts";
import type { ApiResult } from "../app/core/apiRequest.ts";
import type { ProjectRepositoryBindAnswer } from "../app/core/apiRoutes.ts";
import type { PanelState } from "../app/core/freshness.ts";
import {
  repositoryBindNote,
  repositoryBindOutcome,
  repositoryChoices,
  repositoryConfigureStatus,
  repositoryConfigurationsStatus,
  repositoryDeferrals,
  repositoryLabel,
  repositoryOffersWithheld,
  type RepositoryBindNote,
  type RepositoryStepStatus,
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
  expect(repositoryLabel("https://forge.test/kasofsk/chuggy.git")).toBe(
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
  return repositoryBindNote(repositoryBindOutcome(result)).status;
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
test("a bind of a repository already bound says so, and offers nothing further", () => {
  expect(repositoryBindNote(repositoryBindOutcome(alreadyBound))).toStrictEqual(
    { status: "Already bound", ticketOffered: false },
  );
  expect(status(answered({ result: "Imported", count: 2 }))).not.toBe(
    "Already bound",
  );
});

function boundNote(
  configurations: ProjectRepositoryConfigurationsResponse,
): RepositoryBindNote {
  return repositoryBindNote(repositoryBindOutcome(answered(configurations)));
}

/** The picker's row marks a new binding Bound, so its one line says what its
 * configurations came to instead, and offers a ticket once there is one. */
test("a new binding says what its configurations came to, and offers a ticket where one was", () => {
  expect(boundNote({ result: "Imported", count: 3 })).toStrictEqual({
    status: "Configurations imported",
    ticketOffered: true,
  });
  expect(boundNote({ result: "Bootstrapped", revision: "r1" })).toStrictEqual({
    status: "Default configuration added",
    ticketOffered: true,
  });
  for (const reason of projectRepositoryConfigurationDeferrals)
    expect(boundNote({ result: "Deferred", reason })).toStrictEqual({
      status: repositoryDeferrals[reason].status,
      ticketOffered: false,
    });
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

/** A retired binding is the one refusal Retry cannot outlast, so it alone withdraws it. */
test("a configuration step asked for again draws its outcome, or the refusal it met", () => {
  const configured = (
    configurations: ProjectRepositoryConfigurationsResponse,
  ): RepositoryStepStatus =>
    repositoryConfigureStatus({
      outcome: "Ok",
      value: {
        repository: "https://forge.test/kasofsk/chuggy",
        configurations,
      },
    });
  expect(configured({ result: "Imported", count: 1 })).toStrictEqual({
    status: "Imported",
    retry: false,
  });
  expect(
    configured({ result: "Bootstrapped", revision: "bootstrap" }),
  ).toStrictEqual({ status: "Bootstrapped", retry: false });
  expect(
    configured({ result: "Deferred", reason: "DefaultBranchUnavailable" }),
  ).toStrictEqual({ status: "GitHub unavailable", retry: true });
  expect(
    configured({ result: "Deferred", reason: "NoBootstrapImage" }),
  ).toStrictEqual({
    status: "No worker image · ask an operator",
    retry: false,
  });
  expect(
    configured({ result: "Deferred", reason: "BootstrapDiffers" }),
  ).toStrictEqual({
    status: "Bootstrap differs · add configurations",
    retry: false,
  });
  expect(
    configured({ result: "Deferred", reason: "IdentityConflict" }),
  ).toStrictEqual({
    status: "Configuration conflict · ask an operator",
    retry: false,
  });
  expect(
    repositoryConfigureStatus({
      outcome: "Conflict",
      code: "RepositoryRetired",
      body: undefined,
    }),
  ).toStrictEqual({ status: "Retired", retry: false });
  expect(
    repositoryConfigureStatus({
      outcome: "Conflict",
      code: "SomethingElse",
      body: undefined,
    }),
  ).toStrictEqual({ status: "Conflict", retry: true });
  expect(
    repositoryConfigureStatus({
      outcome: "Rejected",
      code: "InvalidRequest",
      status: 400,
      body: undefined,
    }),
  ).toStrictEqual({ status: "Refused", retry: true });
  expect(repositoryConfigureStatus({ outcome: "Absent" })).toStrictEqual({
    status: "Not found",
    retry: true,
  });
});

/**
 * The roster is the contract's, which the contract's own tests hold to the
 * interpreter's, so a new reason fails here until it has a phrase and a retry
 * decision. Only a reason the next attempt can find gone is retried.
 */
test("every deferral has one short phrase, and only one a retry can clear offers Retry", () => {
  expect(Object.keys(repositoryDeferrals).toSorted()).toStrictEqual(
    [...projectRepositoryConfigurationDeferrals].toSorted(),
  );
  for (const reason of projectRepositoryConfigurationDeferrals) {
    const drawn = repositoryDeferrals[reason];
    expect(drawn.status.length).toBeGreaterThan(0);
    expect(drawn.status.length).toBeLessThanOrEqual(60);
    expect(drawn.status.includes(" · ")).toBe(!drawn.retry);
    expect(repositoryConfigurationsStatus({ result: "Deferred", reason })).toBe(
      drawn.status,
    );
  }
  expect(
    projectRepositoryConfigurationDeferrals.filter(
      (reason) => repositoryDeferrals[reason].retry,
    ),
  ).toStrictEqual([
    "DefaultBranchUnavailable",
    "SnapshotAbsent",
    "SnapshotUnavailable",
    "StaleBinding",
    "StepFailed",
  ]);
});

function ready<T>(value: T): PanelState<T> {
  return { state: "Ready", value, observedAtMs: undefined };
}

function claim(
  app: ForgeInstallationResponse["app"],
  account: string,
): ForgeInstallationResponse {
  return {
    forge: "github",
    app,
    account,
    accountKind: "User",
    installationId: `${app}-${account}`,
    claimedAt: "2026-09-11T00:00:00Z",
  };
}

function claimed(
  ...installations: ForgeInstallationResponse[]
): PanelState<ForgeInstallationsResponse> {
  return ready({ installations, truncated: false });
}

const authorizing: PanelState<ForgeAppsResponse> = ready({
  apps: [],
  authorization: {
    clientId: "Iv1.portal",
    authorizeUrl: "https://forge.test/login/oauth/authorize",
  },
});

const unauthorizing: PanelState<ForgeAppsResponse> = ready({ apps: [] });

/**
 * The listing answers only a workspace admin, and Connect GitHub is offered
 * only where the deployment answers a client to authorize, so a line that
 * named a step either withholds is a step the reader cannot take.
 */
test("Add and Create withheld say why, and name a step only where it is offered", () => {
  const cases: readonly (readonly [
    PanelState<ForgeInstallationsResponse>,
    PanelState<ForgeAppsResponse>,
    string | undefined,
  ])[] = [
    [{ state: "Pending" }, authorizing, undefined],
    [
      { state: "Absent", reason: "withheld" },
      authorizing,
      "A workspace admin adds repositories",
    ],
    [
      { state: "Failed", reason: "down" },
      authorizing,
      "Accounts failed to load",
    ],
    [claimed(), authorizing, "Connect a GitHub account first"],
    [claimed(), unauthorizing, "GitHub not configured · ask an operator"],
    [
      claimed(),
      { state: "Absent", reason: "no app" },
      "GitHub not configured · ask an operator",
    ],
    [claimed(), { state: "Failed", reason: "down" }, "GitHub unavailable"],
    [claimed(), { state: "Pending" }, undefined],
    [
      claimed(claim("worker", "kasofsk")),
      authorizing,
      "No account has the portal app",
    ],
    [
      claimed(claim("portal", "kasofsk"), claim("worker", "gdoteof")),
      authorizing,
      "No account has both apps",
    ],
    [
      claimed(claim("portal", "kasofsk"), claim("worker", "kasofsk")),
      unauthorizing,
      undefined,
    ],
  ];
  for (const [accounts, apps, line] of cases) {
    expect(repositoryOffersWithheld(accounts, apps)).toBe(line);
    expect((line ?? "").length).toBeLessThanOrEqual(60);
  }
});
