/**
 * The runner pages' words and drafts, derived: what a route and its source
 * are called, which route a draft starts on, what a refused write says, the
 * package a machine is handed with its commands and its guide, and where the
 * control that hands it over is drawn.
 */

import { expect, test } from "vitest";

import type {
  ExecutionPlacementResponse,
  SessionPlacementResponse,
} from "../../../src/contract/responses.ts";
import {
  placementRouteSources,
  placementRoutes,
  sessionRunnerStandings,
} from "../../../src/contract/rosters.ts";
import { copyTextEn } from "../app/copy/catalog.ts";
import type { Copy } from "../app/core/copy.ts";
import { copyOrDataText } from "../app/core/copy.ts";
import {
  runnerAskRead,
  runnerCapabilitiesTyped,
  runnerCapabilityLabel,
  runnerInstalledVersion,
  runnerOutdated,
  runnerPackages,
  runnerRegisterCommand,
  runnerRouteLabel,
  runnerRouteSourceLabel,
  runnerStandingLabel,
  runnersPlacementDraft,
  runnersPlacementMoved,
  runnersPlacementOptions,
  runnersPlacementRefusal,
  runnersPlacementUnhosted,
  runnersPlacementWrites,
} from "../app/core/runners.ts";
import type { RunnersLeadPlacement } from "../app/core/runners.ts";

/** What a read of typed capabilities says, its refusal in the catalog's words. */
function typedSaid<T extends object>(
  read: T | { readonly refused: Copy },
): T | { readonly refused: string } {
  return "refused" in read ? { refused: copyTextEn(read.refused) } : read;
}

const hosted: ExecutionPlacementResponse = {
  work: { route: "InCluster", source: "Project" },
  evaluation: { route: "Pool", source: "Default" },
  choices: ["InCluster", "Pool"],
};

const sessions: SessionPlacementResponse = {
  thread: { route: "Pool", source: "Default" },
  lead: { route: "InCluster", source: "Override" },
  leadOffering: "Own",
  leadOfferings: ["Own"],
  choices: ["InCluster", "Pool"],
  runners: { mine: "Live", project: "Live" },
};

/** A route the reader may not choose is where the kind runs until they choose
 * another, so the draft starts there rather than on one they may. */
test("a draft starts on each kind's route as read, whether or not the reader may choose it", () => {
  const read = {
    work: "InCluster",
    evaluation: "Pool",
    thread: "Pool",
    lead: { route: "InCluster", offering: "Own" },
  };
  expect(runnersPlacementDraft(hosted, sessions)).toStrictEqual(read);
  expect(
    runnersPlacementDraft(
      { ...hosted, choices: ["Pool"] },
      { ...sessions, choices: ["Pool"] },
    ),
  ).toStrictEqual(read);
});

/** The read is the newest one, so a kind the reader left alone follows what
 * anyone else did to it. */
test("a kind the reader moved is where they moved it, and every other is as read", () => {
  const read = {
    work: "InCluster",
    evaluation: "Pool",
    thread: "Pool",
    lead: { route: "InCluster", offering: "Own" },
  } as const;
  expect(runnersPlacementMoved(read, {})).toStrictEqual(read);
  expect(runnersPlacementMoved(read, { thread: "InCluster" })).toStrictEqual({
    ...read,
    thread: "InCluster",
  });
});

test("a kind offers the reader's choices, after its route as read where that is not one of them", () => {
  expect(runnersPlacementOptions("InCluster", ["Pool"])).toStrictEqual([
    { choice: "InCluster", choosable: false },
    { choice: "Pool", choosable: true },
  ]);
  expect(runnersPlacementOptions("Pool", ["InCluster", "Pool"])).toStrictEqual([
    { choice: "InCluster", choosable: true },
    { choice: "Pool", choosable: true },
  ]);
  expect(runnersPlacementOptions("Pool", ["Pool"])).toStrictEqual([
    { choice: "Pool", choosable: true },
  ]);
});

const ownHosted: RunnersLeadPlacement = { route: "InCluster", offering: "Own" };
const subsidized: RunnersLeadPlacement = {
  route: "InCluster",
  offering: "Subsidized",
};

/** A write names both its kinds, so a placement is written whole where either
 * moved and not at all where neither did. */
test("a save writes only the placements the draft moved, each whole", () => {
  const read = {
    work: "InCluster",
    evaluation: "Pool",
    thread: "Pool",
    lead: ownHosted,
  } as const;
  expect(runnersPlacementWrites(read, read)).toStrictEqual({
    execution: undefined,
    session: undefined,
  });
  expect(runnersPlacementWrites(read, { ...read, work: "Pool" })).toStrictEqual(
    { execution: { work: "Pool", evaluation: "Pool" }, session: undefined },
  );
  expect(
    runnersPlacementWrites(read, { ...read, evaluation: "InCluster" }),
  ).toStrictEqual({
    execution: { work: "InCluster", evaluation: "InCluster" },
    session: undefined,
  });
  expect(
    runnersPlacementWrites(read, { ...read, thread: "InCluster" }),
  ).toStrictEqual({
    execution: undefined,
    session: { thread: "InCluster", lead: "InCluster", leadOffering: "Own" },
  });
});

/** A write naming no offering keeps the one the project's row stores, which
 * may be a subsidized lead the deployment withdrew, so the session write names
 * the lead as read, and the editor never moves it. */
test("a session write names the lead and its offering as read, and moves only the thread", () => {
  const read = {
    work: "InCluster",
    evaluation: "Pool",
    thread: "Pool",
    lead: ownHosted,
  } as const;
  expect(
    runnersPlacementWrites(read, { ...read, lead: subsidized }).session,
  ).toBeUndefined();
  const subsidizedRead = { ...read, lead: subsidized };
  expect(
    runnersPlacementWrites(subsidizedRead, {
      ...subsidizedRead,
      thread: "InCluster",
    }).session,
  ).toStrictEqual({
    thread: "InCluster",
    lead: "InCluster",
    leadOffering: "Subsidized",
  });
});

test("a route is named hosted runs or runners, and an override of the site's is the site", () => {
  expect(
    placementRoutes.map((route) => copyTextEn(runnerRouteLabel(route))),
  ).toStrictEqual(["Hosted runs", "Runners"]);
  expect(
    placementRouteSources.map((source) =>
      copyTextEn(runnerRouteSourceLabel(source)),
    ),
  ).toStrictEqual(["Site", "Project", "Default"]);
});

test("a runner standing is one word, and no runner at all is None", () => {
  expect(
    sessionRunnerStandings.map((each) => copyTextEn(runnerStandingLabel(each))),
  ).toStrictEqual(["None", "Offline", "Live"]);
});

test("a write refused for the hosted grant is told apart from any other refusal", () => {
  const unhosted = {
    outcome: "Rejected",
    code: "HostedRunsNotGranted",
    status: 403,
    body: undefined,
  } as const;
  const invalid = {
    outcome: "Rejected",
    code: "InvalidRequest",
    status: 400,
    body: undefined,
  } as const;
  expect(runnersPlacementUnhosted(unhosted)).toBe(true);
  expect(copyOrDataText(copyTextEn, runnersPlacementRefusal(unhosted))).toBe(
    "Needs hosted runs",
  );
  expect(runnersPlacementUnhosted(invalid)).toBe(false);
  expect(copyOrDataText(copyTextEn, runnersPlacementRefusal(invalid))).toBe(
    "Refused",
  );
});

test("the Linux package: what it needs, the command that installs its pinned release, and its guide", () => {
  expect(runnerPackages.linux).toStrictEqual({
    label: { id: "runners-package-linux" },
    program: "chuggy-linux",
    needs: { id: "runners-package-needs-linux" },
    installCommand:
      "npm i -g https://github.com/kasofsk/chuggy-linux/releases/download/v0.55.0/chuggy-linux-0.55.0.tgz",
    guideAddress: "https://github.com/kasofsk/chuggy-linux#configure",
    chatHostGuideAddress: "https://github.com/kasofsk/chuggy-linux#a-chat-host",
    restartIntervalSecs: 10,
    exitsMeant: { 3: "Unrestarted", 75: "Updated" },
  });
  expect(copyTextEn(runnerPackages.linux.label)).toBe("Linux");
  expect(copyTextEn(runnerPackages.linux.needs)).toBe(
    "Linux · Node 24 · Docker or Podman",
  );
});

test("a Mac's package is the reader's other choice, and what they ask of either is read as they asked it", () => {
  expect(runnerPackages.darwin).toStrictEqual({
    label: { id: "runners-package-darwin" },
    program: "chuggy-darwin",
    needs: { id: "runners-package-needs-darwin" },
    installCommand:
      "npm i -g https://github.com/kasofsk/chuggy-darwin/releases/download/v0.25.0/chuggy-darwin-0.25.0.tgz",
    guideAddress: "https://github.com/kasofsk/chuggy-darwin#run",
    chatHostGuideAddress: "https://github.com/kasofsk/chuggy-darwin#chat-host",
    restartIntervalSecs: 10,
    exitsMeant: { 0: "Unrestarted", 75: "Updated" },
  });
  expect(copyTextEn(runnerPackages.darwin.label)).toBe("Mac");
  expect(copyTextEn(runnerPackages.darwin.needs)).toBe(
    "macOS · Node 24 · Colima",
  );
  const asked = runnerAskRead("darwin", true, "Agent:Claude, Tool:Xcode");
  expect(asked).toStrictEqual({
    ask: {
      package: "darwin",
      host: true,
      capabilities: ["Agent:Claude", "Tool:Xcode"],
    },
  });
  expect(runnerAskRead("linux", false, "")).toStrictEqual({
    ask: { package: "linux", host: false, capabilities: [] },
  });
});

test("capabilities typed are refused where one is not a capability, is a platform, or is named twice", () => {
  expect(typedSaid(runnerCapabilitiesTyped("  "))).toStrictEqual({
    capabilities: [],
  });
  expect(
    typedSaid(runnerCapabilitiesTyped("has-dash, Tool:Bazel\nx_1")),
  ).toStrictEqual({
    capabilities: ["has-dash", "Tool:Bazel", "x_1"],
  });
  expect(typedSaid(runnerCapabilitiesTyped("Tool:Ba.zel"))).toStrictEqual({
    refused: "Tool:Ba.zel · use letters, digits, _, : and -",
  });
  expect(
    typedSaid(runnerCapabilitiesTyped("Tool:Bazel - Tool:Go")),
  ).toStrictEqual({
    refused: "- · start with a letter or digit",
  });
  expect(
    typedSaid(runnerCapabilitiesTyped(`T${"o".repeat(63)}`)),
  ).toStrictEqual({
    refused: `T${"o".repeat(63)} · at most 63 characters`,
  });
  expect(
    typedSaid(runnerCapabilitiesTyped("Platform:MacOS:Arm64")),
  ).toStrictEqual({
    refused: "Platform:MacOS:Arm64 is detected, not typed",
  });
  expect(typedSaid(runnerCapabilitiesTyped("a a"))).toStrictEqual({
    refused: "A capability is listed twice",
  });
  expect(
    typedSaid(runnerAskRead("linux", false, "Tool:Bazel Tool:Bazel")),
  ).toStrictEqual({
    refused: "A capability is listed twice",
  });
});

test("the register command names the package's program, the console's own origin and the token, and what was asked of it", () => {
  expect(
    runnerRegisterCommand(
      runnerPackages.linux,
      "https://chuggy.test",
      "tok_en-1",
      "Pool",
    ),
  ).toBe("chuggy-linux register --api https://chuggy.test --token=tok_en-1");
  expect(
    runnerRegisterCommand(
      runnerPackages.darwin,
      "https://chuggy.test",
      "tok_en-1",
      "Pool",
    ),
  ).toBe("chuggy-darwin register --api https://chuggy.test --token=tok_en-1");
  expect(
    runnerRegisterCommand(
      runnerPackages.darwin,
      "https://chuggy.test",
      "tok_en-1",
      "Personal",
      { host: true, capabilities: ["Agent:Claude", "Tool:Xcode"] },
    ),
  ).toBe(
    "chuggy-darwin register --personal --api https://chuggy.test --token=tok_en-1 --host --capability Agent:Claude --capability Tool:Xcode",
  );
  expect(
    runnerRegisterCommand(
      runnerPackages.linux,
      "https://chuggy.test",
      "tok_en-1",
      "Pool",
      { host: true, capabilities: [] },
    ),
  ).toBe(
    "chuggy-linux register --api https://chuggy.test --token=tok_en-1 --host",
  );
});

test("a member's own runner is registered by the same command, marked personal", () => {
  expect(
    runnerRegisterCommand(
      runnerPackages.linux,
      "https://chuggy.test",
      "tok_en-1",
      "Personal",
    ),
  ).toBe(
    "chuggy-linux register --personal --api https://chuggy.test --token=tok_en-1",
  );
});

/** A base64url token may start with a dash, which an argument parser takes for
 * a flag unless the token is joined to its own. */
test("a token that starts with a dash stays the token's value", () => {
  expect(
    runnerRegisterCommand(
      runnerPackages.linux,
      "https://chuggy.test",
      "-tok",
      "Pool",
    ),
  ).toBe("chuggy-linux register --api https://chuggy.test --token=-tok");
});

test("a platform is drawn by its parts and any other capability as spelled", () => {
  expect(runnerCapabilityLabel("Platform:Linux:Amd64")).toBe("Linux Amd64");
  expect(runnerCapabilityLabel("Agent:Claude")).toBe("Agent:Claude");
});

test("a runner is outdated only below a pinned plain release, part by part", () => {
  expect(runnerOutdated("0.13.0", "0.14.1")).toBe(true);
  expect(runnerOutdated("0.9.0", "0.10.0")).toBe(true);
  expect(runnerOutdated("0.14.0", "0.14.1")).toBe(true);
  expect(runnerOutdated("0.14.1", "0.14.1")).toBe(false);
  expect(runnerOutdated("0.10.0", "0.9.0")).toBe(false);
  expect(runnerOutdated("1.0.0", "0.99.99")).toBe(false);
  expect(runnerOutdated("0.14.0", undefined)).toBe(false);
  expect(runnerOutdated("0.14.0-rc.1", "0.14.1")).toBe(false);
  expect(runnerOutdated("0.13.0", "0.14.1+build")).toBe(false);
  expect(runnerOutdated("0.13", "0.14.1")).toBe(false);
});

test("the release each platform's install command installs is the one its archive and its tag name", () => {
  for (const offered of Object.values(runnerPackages)) {
    const tagged = /\/download\/v([^/]+)\//u.exec(offered.installCommand)?.[1];
    expect(tagged).toMatch(/^[0-9]+\.[0-9]+\.[0-9]+$/u);
    expect(runnerInstalledVersion(offered)).toBe(tagged);
  }
});
