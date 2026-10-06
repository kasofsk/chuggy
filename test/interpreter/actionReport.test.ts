/**
 * Who a report is taken from and what becomes of it, over doubles of the
 * schemes and the store.
 *
 * EACH RULE IS ASKED ONE TERM AT A TIME. A roster is refused for one reason a
 * case, and a request misses its reporter by one part of its address a case,
 * because a rule held for one of its inputs reads as held for all of them.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { actionIdentityCharsMax } from "../../src/contract/actionDocument.ts";
import { nativeHttpPathSegmentCharsMax } from "../../src/contract/http.ts";
import {
  actionReporterActionsMax,
  actionReporterNameCharsMax,
  actionReporterRoster,
  actionReporterSecretFileCharsMax,
  actionReportersMax,
  actionReports,
  allActionReporterSchemes,
  rosterActionReporters,
  type ActionObservation,
  type ActionObservationRecorded,
  type ActionReport,
  type ActionReportRequest,
  type ActionReportSaid,
  type ActionReporter,
  type ActionReporterSchemePort,
  type ActionReporterVerified,
} from "../../src/interpreter/actionReport.ts";
import { asGitObjectId } from "../../src/interpreter/finalizer.ts";

const flux = {
  reporter: "rig-flux",
  scheme: "FluxSignature",
  secretFile: "/var/run/chuggy/reporters/flux/token",
  tenant: "vteng",
  project: "chuggy",
  actions: ["rig"],
};

const build = {
  reporter: "rig-build",
  scheme: "BearerSecret",
  secretFile: "/var/run/chuggy/reporters/build/token",
  tenant: "vteng",
  project: "chuggy",
  actions: ["build-api", "build-console", "publish"],
};

function read(roster: unknown) {
  return actionReporterRoster(JSON.stringify(roster));
}

/** The reporters of a roster this suite expects to be read. */
function named(roster: unknown): readonly ActionReporter[] {
  const found = read(roster);
  if (found.read !== "Roster")
    throw new Error(`the roster was refused: it ${found.why}`);
  return found.reporters;
}

/** Why a roster this suite expects to be refused was. */
function refused(roster: unknown): string {
  const found = read(roster);
  assert.equal(found.read, "Refused", JSON.stringify(roster).slice(0, 120));
  return found.read === "Refused" ? found.why : "";
}

test("a roster names each reporter's scheme, its secret's file, its project and the actions it may report", () => {
  assert.deepEqual(allActionReporterSchemes, ["BearerSecret", "FluxSignature"]);
  assert.deepEqual(read([flux, build]), {
    read: "Roster",
    reporters: [
      {
        claims: {
          reporter: "rig-flux",
          partition: { tenant: "vteng", project: "chuggy" },
          actions: ["rig"],
        },
        scheme: "FluxSignature",
        secretFile: "/var/run/chuggy/reporters/flux/token",
      },
      {
        claims: {
          reporter: "rig-build",
          partition: { tenant: "vteng", project: "chuggy" },
          actions: ["build-api", "build-console", "publish"],
        },
        scheme: "BearerSecret",
        secretFile: "/var/run/chuggy/reporters/build/token",
      },
    ],
  });
  assert.deepEqual(read([]), { read: "Roster", reporters: [] });
});

test("a roster that is not JSON, or not a list of reporters, is refused and says where", () => {
  assert.deepEqual(actionReporterRoster("[{"), {
    read: "Refused",
    why: "is not JSON",
  });
  assert.deepEqual(actionReporterRoster(""), {
    read: "Refused",
    why: "is not JSON",
  });
  for (const [roster, where] of [
    [{ reporters: [build] }, "[]"],
    [null, "[]"],
    [[build, "rig-flux"], "[1]"],
    [[{ ...build, permissions: "write" }], "[0]"],
    [[flux, { ...build, secret: "hunter2" }], "[1]"],
  ] as const)
    assert.equal(
      refused(roster),
      `is not a roster of reporters at ${where}`,
      JSON.stringify(roster).slice(0, 120),
    );
});

test("an entry missing a field, or holding one out of its bound, refuses the roster at that field", () => {
  const long = (chars: number) => "x".repeat(chars);
  for (const field of Object.keys(build)) {
    const rest: Record<string, unknown> = { ...build };
    delete rest[field];
    assert.equal(
      refused([rest]),
      `is not a roster of reporters at [0,"${field}"]`,
    );
  }
  for (const [field, value] of [
    ["reporter", ""],
    ["reporter", long(actionReporterNameCharsMax + 1)],
    ["reporter", "rig\u0000build"],
    ["reporter", 7],
    ["scheme", "Basic"],
    ["scheme", "bearersecret"],
    ["secretFile", ""],
    ["secretFile", long(actionReporterSecretFileCharsMax + 1)],
    ["tenant", ""],
    ["tenant", long(nativeHttpPathSegmentCharsMax + 1)],
    ["tenant", "ven\ud800"],
    ["project", ""],
    ["project", long(nativeHttpPathSegmentCharsMax + 1)],
    ["actions", "publish"],
    ["actions", null],
  ] as const)
    assert.equal(
      refused([{ ...build, [field]: value }]),
      `is not a roster of reporters at [0,"${field}"]`,
      `${field} ${JSON.stringify(value).slice(0, 40)}`,
    );
  for (const action of [
    "",
    "-publish",
    "publish/all",
    long(actionIdentityCharsMax + 1),
  ])
    assert.equal(
      refused([{ ...build, actions: ["build-api", action] }]),
      'is not a roster of reporters at [0,"actions",1]',
      action.slice(0, 40),
    );
});

test("each bound of a roster is admitted at and refused past", () => {
  const long = (chars: number) => "x".repeat(chars);
  const actions = (count: number) =>
    Array.from({ length: count }, (_, index) => `action-${String(index)}`);
  const entries = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      ...build,
      project: `project-${String(index)}`,
    }));

  const [widest] = named([
    {
      ...build,
      reporter: "\u{1F680}".repeat(actionReporterNameCharsMax),
      secretFile: long(actionReporterSecretFileCharsMax),
      tenant: long(nativeHttpPathSegmentCharsMax),
      project: long(nativeHttpPathSegmentCharsMax),
      actions: [
        long(actionIdentityCharsMax),
        ...actions(actionReporterActionsMax - 1),
      ],
    },
  ]);
  assert.equal(widest?.claims.actions.length, actionReporterActionsMax);
  assert.equal(
    refused([{ ...build, actions: actions(actionReporterActionsMax + 1) }]),
    'is not a roster of reporters at [0,"actions"]',
  );

  assert.equal(named(entries(actionReportersMax)).length, actionReportersMax);
  assert.equal(
    refused(entries(actionReportersMax + 1)),
    "is not a roster of reporters at []",
  );
});

test("a reporter proving itself by a signature over its body is named for exactly one action", () => {
  assert.equal(named([flux]).length, 1);
  for (const actions of [[], ["rig", "rig-canary"]])
    assert.equal(
      refused([{ ...flux, actions }]),
      "names the FluxSignature reporter rig-flux for other than one action",
      JSON.stringify(actions),
    );
  assert.equal(
    named([{ ...build, actions: [] }]).length,
    1,
    "a reporter proving itself at each address may be named for any number",
  );
});

test("an action has at most one reporter", () => {
  for (const roster of [
    [{ ...build, actions: ["publish", "build-api", "publish"] }],
    [build, { ...build, reporter: "another", actions: ["publish"] }],
    [build, { ...flux, actions: ["publish"] }],
    [flux, { ...flux, reporter: "rig-flux-again" }],
  ])
    assert.match(
      refused(roster),
      /^names the action (?:publish|rig) of vteng\/chuggy twice$/u,
      JSON.stringify(roster).slice(0, 160),
    );
});

test("an action is one project's: a namesake elsewhere has a reporter of its own, and a name or a file may be used again", () => {
  assert.equal(
    named([
      build,
      { ...build, project: "console" },
      { ...build, tenant: "acme" },
      { ...build, actions: ["Publish", "publish.all"] },
      { ...build, reporter: "rig-build", actions: ["deploy"] },
    ]).length,
    5,
  );
});

function request(
  address: Partial<ActionReportRequest> = {},
): ActionReportRequest {
  return {
    tenant: "vteng",
    project: "chuggy",
    action: "publish",
    headers: { authorization: "Bearer presented" },
    body: new TextEncoder().encode("{}"),
    ...address,
  };
}

const commit = asGitObjectId("a".repeat(40));
const report: ActionReport = { commit, outcome: "Succeeded" };
const saidReport: ActionReportSaid = { said: "Report", report };

/** A scheme answering as told, recording the file and the request it was asked with. */
function scheme(
  label: string,
  asked: string[],
  said: ActionReportSaid | undefined,
): ActionReporterSchemePort {
  return {
    said: (secretFile, presented) => {
      asked.push(`${label} ${secretFile} ${presented.action}`);
      return Promise.resolve(said);
    },
  };
}

test("a request is verified as the one reporter named for the action it addresses, by that reporter's scheme and file", async () => {
  const asked: string[] = [];
  const reporters = rosterActionReporters(named([flux, build]), {
    BearerSecret: scheme("bearer", asked, saidReport),
    FluxSignature: scheme("flux", asked, { said: "Refused" }),
  });

  assert.deepEqual(await reporters.verified(request()), {
    claims: named([build])[0]?.claims,
    said: saidReport,
  });
  assert.deepEqual(await reporters.verified(request({ action: "rig" })), {
    claims: named([flux])[0]?.claims,
    said: { said: "Refused" },
  });
  assert.deepEqual(asked, [
    `bearer ${build.secretFile} publish`,
    `flux ${flux.secretFile} rig`,
  ]);
});

test("a request addressed to an action no reporter is named for is verified as nobody, and no scheme is asked", async () => {
  const asked: string[] = [];
  const reporters = rosterActionReporters(named([flux, build]), {
    BearerSecret: scheme("bearer", asked, saidReport),
    FluxSignature: scheme("flux", asked, saidReport),
  });

  for (const address of [
    { tenant: "acme" },
    { project: "console" },
    { action: "deploy" },
    { action: "Publish" },
    { action: "" },
    { tenant: "chuggy", project: "vteng" },
  ])
    assert.equal(
      await reporters.verified(request(address)),
      undefined,
      JSON.stringify(address),
    );
  assert.deepEqual(asked, []);
  assert.equal(
    await rosterActionReporters([], {
      BearerSecret: scheme("bearer", asked, saidReport),
    }).verified(request()),
    undefined,
    "a deployment naming no reporter verifies nobody",
  );
  assert.deepEqual(asked, []);
});

test("a request its reporter's scheme does not verify, or whose scheme has no adapter, is verified as nobody", async () => {
  const asked: string[] = [];
  const reporters = rosterActionReporters(named([flux, build]), {
    BearerSecret: scheme("bearer", asked, undefined),
  });

  assert.equal(await reporters.verified(request()), undefined);
  assert.equal(await reporters.verified(request({ action: "rig" })), undefined);
  assert.deepEqual(asked, [`bearer ${build.secretFile} publish`]);
});

/** The service over a reporter port answering as told and a store answering as told, recording what was stored. */
function reportsOver(
  verified: ActionReporterVerified | undefined,
  recorded: ActionObservationRecorded | Error,
  stored: ActionObservation[],
) {
  return actionReports({
    reporters: { verified: () => Promise.resolve(verified) },
    observations: {
      record: (observation) => {
        stored.push(observation);
        return recorded instanceof Error
          ? Promise.reject(recorded)
          : Promise.resolve(recorded);
      },
    },
  });
}

/** What the roster's build reporter is verified as, saying what a case chooses. */
function verifiedAs(
  entry: unknown,
  said: ActionReportSaid = saidReport,
): ActionReporterVerified {
  const [reporter] = named([entry]);
  assert.ok(reporter !== undefined);
  return { claims: reporter.claims, said };
}

test("a verified report is recorded as its reporter's, of the action addressed, and answered as the store answered", async () => {
  for (const [recorded, result] of [
    ["Recorded", "Recorded"],
    ["Repeated", "Repeated"],
    ["Undeclared", "NotFound"],
  ] as const) {
    const stored: ActionObservation[] = [];
    assert.deepEqual(
      await reportsOver(verifiedAs(build), recorded, stored).report(request()),
      { result },
    );
    assert.deepEqual(stored, [
      {
        partition: { tenant: "vteng", project: "chuggy" },
        action: "publish",
        reporter: "rig-build",
        report,
      },
    ]);
  }
});

test("a request verified as nobody is not found, and nothing is recorded", async () => {
  const stored: ActionObservation[] = [];
  assert.deepEqual(
    await reportsOver(undefined, "Recorded", stored).report(request()),
    { result: "NotFound" },
  );
  assert.deepEqual(stored, []);
});

test("a reporter is held to its claims: one named for another tenant, project or action records nothing here", async () => {
  for (const claimed of [
    { ...build, tenant: "acme" },
    { ...build, project: "console" },
    { ...build, actions: ["build-api", "build-console"] },
    { ...build, actions: [] },
  ]) {
    const stored: ActionObservation[] = [];
    assert.deepEqual(
      await reportsOver(verifiedAs(claimed), "Recorded", stored).report(
        request(),
      ),
      { result: "NotFound" },
      JSON.stringify(claimed),
    );
    assert.deepEqual(stored, []);
  }
});

test("a verified body no report can be read from is refused, and nothing is recorded", async () => {
  const stored: ActionObservation[] = [];
  assert.deepEqual(
    await reportsOver(
      verifiedAs(build, { said: "Refused" }),
      "Recorded",
      stored,
    ).report(request()),
    { result: "Refused" },
  );
  assert.deepEqual(stored, []);
});

test("a row that could not be written is answered as unavailable", async () => {
  const stored: ActionObservation[] = [];
  assert.deepEqual(
    await reportsOver(
      verifiedAs(build),
      new Error("the database is not there"),
      stored,
    ).report(request()),
    { result: "Unavailable" },
  );
  assert.equal(stored.length, 1);
});
