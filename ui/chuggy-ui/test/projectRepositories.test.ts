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
import {
  forgeApps,
  projectRepositoryConfigurationDeferrals,
} from "../../../src/contract/rosters.ts";
import type { ApiResult } from "../app/core/apiRequest.ts";
import type { ProjectRepositoryBindAnswer } from "../app/core/apiRoutes.ts";
import type { PanelState } from "../app/core/freshness.ts";
import {
  repositoriesWorkerless,
  repositoryAddClosedPath,
  repositoryAddLeads,
  repositoryAddOpened,
  repositoryAddReturnPath,
  repositoryBindNote,
  repositoryBindOutcome,
  repositoryChoices,
  repositoryConfigureStatus,
  repositoryDeferrals,
  repositoryGrantLines,
  repositoryLabel,
  repositoryNextStep,
  repositoryOffersLine,
  repositoryRosterPolledMs,
  repositoryRosterRereadMs,
  repositoryRosterRereadsMax,
  repositoryWorkerLine,
  repositoryWorkerReading,
  type InstallationGrant,
  type RepositoryNextStep,
  type RepositoryNote,
  type RepositoryOffersStep,
  type RepositoryStepStatus,
} from "../app/core/projectRepositories.ts";
import { workRunner } from "../app/core/workRunner.ts";
import type { WorkRunner } from "../app/core/workRunner.ts";
import { repositoryRefusalsDrawn } from "./repositoryRefusals.ts";
import { sessionPlacementBody } from "./sessionPlacementFixture.ts";
import {
  executionPlacementBody,
  workRunnerAnswered,
  workRunnerFailed,
  workRunnerUnread,
} from "./workRunnerFixture.ts";

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
    [],
  );
  expect(choices.map((choice) => choice.bound)).toEqual([true, false]);
});

const elsewhere = reachable({
  fullName: "gdoteof/chuggy",
  url: "https://forge.test/gdoteof/chuggy",
});

const rehearsal = reachable({
  name: "chuggy-rehearsal",
  fullName: "kasofsk/chuggy-rehearsal",
  url: "https://forge.test/kasofsk/chuggy-rehearsal",
});

function grant(over: Partial<InstallationGrant>): InstallationGrant {
  return {
    account: "kasofsk",
    repositories: [reachable({}), rehearsal],
    truncated: false,
    ...over,
  };
}

/**
 * A job's credential is minted under the worker app on the repository's own
 * account, so the worker listing compared is that account's and no other's,
 * and only a listing that is all of what it grants can say what it lacks.
 */
test("the worker app lacks what its own account's whole listing does not hold, and a listing unread or partial lacks nothing", () => {
  const portal = [
    grant({}),
    grant({ account: "gdoteof", repositories: [elsewhere] }),
  ];
  const held = grant({ repositories: [reachable({})] });
  const cases: readonly (readonly [
    readonly InstallationGrant[],
    readonly string[],
  ])[] = [
    [[held], [rehearsal.url]],
    [[grant({})], []],
    [[grant({ repositories: [] })], [reachable({}).url, rehearsal.url]],
    [[{ ...held, truncated: true }], []],
    [[], []],
    [[{ ...held, account: "otherco" }], []],
    [
      [held, grant({ account: "gdoteof", repositories: [] })],
      [rehearsal.url, elsewhere.url],
    ],
    [
      [grant({}), grant({ account: "gdoteof", repositories: [rehearsal] })],
      [elsewhere.url],
    ],
  ];
  for (const [worker, lacked] of cases)
    expect(repositoriesWorkerless(portal, worker)).toStrictEqual(lacked);
});

test("a row is marked by the address the worker app was read not to grant", () => {
  expect(
    repositoryChoices([reachable({}), rehearsal], [], [rehearsal.url]).map(
      (choice) => choice.workerless,
    ),
  ).toEqual([false, true]);
});

/** A line is the status and what to do about it, and the link beside it names
 * the app whose page it opens, so two lines never offer one label. */
test("each app has one short line under the roster and a link of its own", () => {
  expect(Object.keys(repositoryGrantLines).toSorted()).toStrictEqual(
    [...forgeApps].toSorted(),
  );
  expect(repositoryGrantLines).toStrictEqual({
    portal: { status: "Not listed · grant it on GitHub", label: "Portal app" },
    worker: {
      status: "Worker app missing · grant it on GitHub",
      label: "Worker app",
    },
  });
  for (const app of forgeApps)
    expect(repositoryGrantLines[app].status.length).toBeLessThanOrEqual(60);
});

test("the picker's address is the page's own at its anchor", () => {
  expect(repositoryAddReturnPath("/vteng/chuggy/repositories")).toBe(
    "/vteng/chuggy/repositories#add",
  );
});

/** A word the return brought is drawn on the page, which an open picker
 * covers, so the word is read first. */
test("the page opens with the picker open at its anchor, unless the return brought a word", () => {
  const word = { standing: "Failed", status: "Unavailable" } as const;
  expect([
    repositoryAddOpened("add", undefined),
    repositoryAddOpened("", undefined),
    repositoryAddOpened("elsewhere", undefined),
    repositoryAddOpened("add", word),
    repositoryAddOpened("", word),
  ]).toStrictEqual([true, false, false, false, false]);
});

/** The anchor is what opens the picker when the page is drawn, so it goes
 * with the picker, and an address that never carried it is left as it is. */
test("the address a closed picker leaves is the page's own, and nothing where it was not the picker's", () => {
  const path = "/vteng/chuggy/repositories";
  expect([
    repositoryAddClosedPath(path, "add"),
    repositoryAddClosedPath(path, ""),
    repositoryAddClosedPath(path, "elsewhere"),
  ]).toStrictEqual([path, undefined, undefined]);
});

/**
 * Unread is not the same as lacking nothing, and the one reader it matters to
 * is the one who chose a row before the worker app's listings were read. To
 * everyone else a line that comes and goes is a roster that shifts for nothing.
 */
test("the worker app's line is what a row marks, and that its listings are unread only where a row was chosen first", () => {
  expect(
    [undefined, [rehearsal.url], []].map((workerless) => [
      repositoryWorkerLine(workerless, false),
      repositoryWorkerLine(workerless, true),
    ]),
  ).toStrictEqual([
    [undefined, "Reading"],
    ["Missing", "Missing"],
    [undefined, undefined],
  ]);
  expect(repositoryWorkerReading).toBe("Worker app · loading…");
});

/** How long the forge was once seen to take to list a grant just made. */
const repositoryGrantLagSeenMs = 5 * 60_000;

/**
 * The forge can be slow to list a grant, so the readings one opening makes by
 * itself have to go on for longer than that with room to spare. They stop,
 * because a picker left open is not a reason to go on asking the forge.
 */
test("an open picker's own readings keep one pace until they are spent, and outlast twice the lag a grant was seen to take", () => {
  expect(repositoryRosterPolledMs).toBeGreaterThan(0);
  expect([
    repositoryRosterRereadMs(0),
    repositoryRosterRereadMs(repositoryRosterRereadsMax - 1),
    repositoryRosterRereadMs(repositoryRosterRereadsMax),
    repositoryRosterRereadMs(repositoryRosterRereadsMax + 1),
  ]).toStrictEqual([
    repositoryRosterPolledMs,
    repositoryRosterPolledMs,
    undefined,
    undefined,
  ]);
  expect(
    repositoryRosterRereadsMax * repositoryRosterPolledMs,
  ).toBeGreaterThanOrEqual(2 * repositoryGrantLagSeenMs);
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
): RepositoryNote {
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
  ).toStrictEqual({ status: "Added", retry: false });
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
 * carried a step either withholds is a step the reader cannot take.
 */
test("the line under Add and Create says what is missing, and carries a step only where it is offered", () => {
  const cases: readonly (readonly [
    PanelState<ForgeInstallationsResponse>,
    PanelState<ForgeAppsResponse>,
    string | undefined,
    RepositoryOffersStep | undefined,
  ])[] = [
    [{ state: "Pending" }, authorizing, undefined, undefined],
    [
      { state: "Absent", reason: "withheld" },
      authorizing,
      "A workspace admin adds repositories",
      undefined,
    ],
    [
      { state: "Failed", reason: "down" },
      authorizing,
      "Accounts failed to load",
      undefined,
    ],
    [claimed(), authorizing, "Connect a GitHub account first", "Connect"],
    [
      claimed(),
      unauthorizing,
      "GitHub not configured · ask an operator",
      undefined,
    ],
    [
      claimed(),
      { state: "Absent", reason: "no app" },
      "GitHub not configured · ask an operator",
      undefined,
    ],
    [
      claimed(),
      { state: "Failed", reason: "down" },
      "GitHub unavailable",
      undefined,
    ],
    [claimed(), { state: "Pending" }, undefined, undefined],
    [
      claimed(claim("worker", "kasofsk")),
      authorizing,
      "No account has the portal app",
      undefined,
    ],
    [
      claimed(claim("portal", "kasofsk"), claim("worker", "kasofsk")),
      unauthorizing,
      undefined,
      undefined,
    ],
  ];
  for (const [accounts, apps, status, step] of cases) {
    expect(repositoryOffersLine(accounts, apps)).toStrictEqual(
      status === undefined ? undefined : { status, step },
    );
    expect((status ?? "").length).toBeLessThanOrEqual(60);
  }
});

/**
 * A job's git credential is minted under the worker app, so a repository bound
 * from an account without it is a first job that fails. The line stands where
 * another account holds both apps too, because Add offers the lacking
 * account's repositories all the same.
 */
test("an account holding the portal app without the worker app is named, with the worker's install", () => {
  const workerMissing = (account: string): unknown => ({
    status: `Worker app missing · ${account}`,
    step: "InstallWorker",
  });
  const lacking: readonly (readonly [
    PanelState<ForgeInstallationsResponse>,
    string,
  ])[] = [
    [claimed(claim("portal", "kasofsk")), "kasofsk"],
    [
      claimed(claim("portal", "kasofsk"), claim("worker", "gdoteof")),
      "kasofsk",
    ],
    [
      claimed(
        claim("portal", "kasofsk"),
        claim("worker", "kasofsk"),
        claim("portal", "gdoteof"),
        claim("portal", "initech"),
      ),
      "gdoteof",
    ],
  ];
  for (const [accounts, account] of lacking)
    for (const apps of [authorizing, unauthorizing])
      expect(repositoryOffersLine(accounts, apps)).toStrictEqual(
        workerMissing(account),
      );
});

const steps: readonly (readonly [
  WorkRunner,
  RepositoryNextStep | undefined,
])[] = [
  ["NoRunner", "AddRunner"],
  ["Clear", "NewTicket"],
  ["Held", undefined],
];

test.each(steps)(
  "a line that offers a ticket, over a runner read of %s, leads to %s",
  (runner, step) => {
    expect(repositoryNextStep(true, runner)).toBe(step);
  },
);

test.each(steps)(
  "a line that offers no ticket leads nowhere, over a runner read of %s",
  (runner) => {
    expect(repositoryNextStep(false, runner)).toBeUndefined();
  },
);

/** The step a bind's line draws, from the bind's own answer and the two reads
 * the page holds when it comes back. */
function bindStep(
  placement: Parameters<typeof workRunner>[0],
  runners: Parameters<typeof workRunner>[1],
): RepositoryNextStep | undefined {
  const note = boundNote({ result: "Bootstrapped", revision: "r1" });
  return repositoryNextStep(note.ticketOffered, workRunner(placement, runners));
}

const toRunners = workRunnerAnswered(executionPlacementBody("Pool"));
const noneRegistered = workRunnerAnswered(
  sessionPlacementBody({ project: "Unregistered" }),
);

test("a bind in a project with no runner leads to adding one", () => {
  expect(bindStep(toRunners, noneRegistered)).toBe("AddRunner");
});

test.each(["Offline", "Live"] as const)(
  "a bind in a project with a runner that is %s leads to a first ticket",
  (project) => {
    expect(
      bindStep(
        toRunners,
        workRunnerAnswered(sessionPlacementBody({ project })),
      ),
    ).toBe("NewTicket");
  },
);

test("a bind in a project whose work is hosted leads to a first ticket", () => {
  expect(
    bindStep(
      workRunnerAnswered(executionPlacementBody("InCluster")),
      noneRegistered,
    ),
  ).toBe("NewTicket");
});

test("a bind whose runners read has not come back leads nowhere yet", () => {
  expect(bindStep(toRunners, workRunnerUnread)).toBeUndefined();
  expect(bindStep(workRunnerUnread, noneRegistered)).toBeUndefined();
});

test("a bind whose runners read failed leads to a first ticket, as it did", () => {
  expect(bindStep(toRunners, workRunnerFailed)).toBe("NewTicket");
  expect(bindStep(workRunnerFailed, noneRegistered)).toBe("NewTicket");
});

const bound = {
  repository: "https://forge.test/kasofsk/chuggy",
  boundAt: "2026-09-11T00:00:00Z",
  landing: { mode: "Push" as const },
};

const both = [claim("portal", "kasofsk"), claim("worker", "kasofsk")];

test("an empty roster carries Add where an account grants repositories and no step comes first", () => {
  expect(
    repositoryAddLeads({ bindings: [], installations: both, line: undefined }),
  ).toBe(true);
});

/** A line with no step names nothing to do first, so Add still leads under it. */
test("a line that names no step does not take the lead from Add", () => {
  expect(
    repositoryAddLeads({
      bindings: [],
      installations: both,
      line: { status: "GitHub unavailable", step: undefined },
    }),
  ).toBe(true);
});

test("Add does not lead while the bindings are unread, or once one is bound", () => {
  const view = { installations: both, line: undefined };
  expect(repositoryAddLeads({ ...view, bindings: undefined })).toBe(false);
  expect(repositoryAddLeads({ ...view, bindings: [bound] })).toBe(false);
  expect(
    repositoryAddLeads({
      ...view,
      bindings: [{ ...bound, retiredAt: "2026-09-14T00:00:00Z" }],
    }),
  ).toBe(false);
});

test("Add does not lead where no account holds the portal app it reads under", () => {
  const view = { bindings: [], line: undefined };
  expect(repositoryAddLeads({ ...view, installations: [] })).toBe(false);
  expect(
    repositoryAddLeads({
      ...view,
      installations: [claim("worker", "kasofsk")],
    }),
  ).toBe(false);
});

test.each(["Connect", "InstallWorker"] as const)(
  "Add does not lead under a line whose step is %s, which comes first",
  (step) => {
    expect(
      repositoryAddLeads({
        bindings: [],
        installations: both,
        line: { status: "a line", step },
      }),
    ).toBe(false);
  },
);
