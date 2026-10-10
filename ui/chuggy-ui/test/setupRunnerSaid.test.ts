/**
 * How a run of `runner` is said: every stop by what was found, the command its
 * rule names and what it exits with, every note by its word, and the redactor
 * everything another program printed passes through first.
 */

import { expect, test } from "vitest";

import {
  setupCheckFirst,
  setupRunnerChecks,
  setupRunnerNoteSaid,
  setupRunnerStopExit,
  setupRunnerStopSaid,
} from "../app/core/setupRunnerSaid.ts";
import type { SetupRunnerStop } from "../app/core/setupRunnerSaid.ts";
import {
  setupExcerpt,
  setupExcerptCharsMax,
  setupRedacted,
} from "../app/core/setupText.ts";
import { boxLogin, boxPools, boxSettings, boxUnits } from "./setupRunnerBox.ts";
import {
  rosterCommand,
  rosterLingerRefusal,
  rosterPool,
  rosterUnit,
  runnerNotes,
  runnerStops,
  runnerStopsAll,
} from "./setupRunnerRoster.ts";

type Kind = SetupRunnerStop["stop"];

function said(kind: Kind): readonly (readonly [string, number, string])[] {
  return runnerStops[kind].map((stop) => {
    const { found, again } = setupRunnerStopSaid(stop, "acme/widgets");
    return [found, setupRunnerStopExit(stop), again] as const;
  });
}

/** Every stop, each way it is made, as what it says was found, what it exits with and the command its rule names. */
const all: { readonly [K in Kind]: ReturnType<typeof said> } = {
  Mac: [
    ["this machine is a Mac, and chuggy's runner runs on Linux", 2, "Status"],
  ],
  Unread: [
    [
      "the site does not show you acme/widgets or where its work runs",
      0,
      "Runner",
    ],
    [
      "the site did not say of acme/widgets how its runners stand (Fault)",
      1,
      "Runner",
    ],
    [
      "the site did not say of acme/widgets which runners it has (Cut)",
      1,
      "Runner",
    ],
  ],
  NotAdmin: [
    ["the site says you are not an admin of acme/widgets", 0, "Runner"],
  ],
  Serviceless: [
    [
      "this machine's user services did not answer systemctl --user",
      0,
      "Runner",
    ],
  ],
  Engineless: [
    [
      "docker did not answer you without a password; podman is not installed",
      0,
      "Runner",
    ],
    ["podman did not answer you without a password", 0, "Runner"],
  ],
  SettingsUnread: [
    [
      `${boxSettings} is there and does not read as the runner's settings`,
      1,
      "Runner",
    ],
  ],
  LoginMissing: [
    [
      `the runner has no Claude login on this machine: nothing is at ${boxLogin}`,
      0,
      "Runner",
    ],
  ],
  Npmless: [
    [
      "the runner package is not installed, and npm did not answer",
      0,
      "Runner",
    ],
  ],
  Unwritten: [[`chuggy setup could not make ${boxSettings}`, 1, "Runner"]],
  Act: [
    [
      "installing the runner package ended with exit 1, saying: it said why",
      1,
      "Runner",
    ],
    [
      "registering this machine ended with exit 1, saying: it said why",
      1,
      "Runner",
    ],
    [
      "the runner's own check ended with exit 1, saying: it said why",
      1,
      "Runner",
    ],
    [
      "installing the runner's service ended with exit 1, saying: it said why",
      1,
      "Runner",
    ],
    [
      "reloading your services ended with exit 1, saying: it said why",
      1,
      "Runner",
    ],
    [
      "starting the runner's service ended with exit 1, saying: it said why",
      1,
      "Runner",
    ],
    [
      "restarting the runner's service ended with exit 1, saying: it said why",
      1,
      "Runner",
    ],
    ["installing the runner package could not be started", 1, "Runner"],
    [
      "registering this machine did not end within 60 s and was stopped",
      1,
      "Runner",
    ],
    [
      "starting the runner's service ended with exit 1 and said nothing",
      1,
      "Runner",
    ],
  ],
  Unseen: [
    [
      `installing the runner package ended well, and what it makes is not at ${rosterCommand}`,
      1,
      "Runner",
    ],
    [
      `registering this machine ended well, and what it makes is not at ${boxPools}`,
      1,
      "Runner",
    ],
    [
      `installing the runner's service ended well, and what it makes is not at ${boxUnits}/${rosterUnit}`,
      1,
      "Runner",
    ],
  ],
  MintRefused: [
    [
      "the site made no registration token for acme/widgets (Absent)",
      1,
      "Runner",
    ],
    [
      "the site made no registration token for acme/widgets (Conflict)",
      1,
      "Runner",
    ],
    [
      "the site made no registration token for acme/widgets (Fault)",
      1,
      "Runner",
    ],
  ],
  CheckFailed: [
    [
      "the runner could not use the container engine; the runner's own check said: FAIL  container engine: docker did not answer",
      1,
      "Runner",
    ],
    [
      "the runner's own check did not pass; the runner's own check said: FAIL  a new check: no",
      1,
      "Runner",
    ],
  ],
  LingerAsks: [
    [
      "your services stop when you log out, and chuggy setup could not change that",
      0,
      "Runner",
    ],
    [
      `your services stop when you log out, and chuggy setup could not change that: loginctl said ${rosterLingerRefusal}`,
      0,
      "Runner",
    ],
  ],
  Inactive: [
    [`${rosterUnit} was started and is failed`, 1, "Runner"],
    [`${rosterUnit} was started and is not running`, 1, "Runner"],
  ],
  NotLive: [
    [
      "the runner's service is running, and after 90 s the site still sees no runner of acme/widgets live",
      1,
      "Runner",
    ],
    [
      "the runner's service is running, and after 5 s the site lists no runner of acme/widgets",
      1,
      "Runner",
    ],
  ],
};

test("every stop is said by what was found, exits zero where it waits on the person and one where something failed, and names runner again but for a Mac", () => {
  for (const kind of Object.keys(all) as Kind[])
    expect(said(kind), kind).toEqual(all[kind]);
});

test("every stop tells the person one thing that ends on what they are to tell the agent, and waits on a condition a rule can carry", () => {
  for (const stop of runnerStopsAll) {
    const { tell, when, rule } = setupRunnerStopSaid(stop, "acme/widgets");
    const kind = JSON.stringify(stop);
    expect(tell, kind).toMatch(
      /^[A-Zc].* [Tt]ell me (?:once|if|when) [^.]+\.$/u,
    );
    expect(when, kind).toMatch(/^(?:once|if|when) \S/u);
    expect(when, kind).not.toMatch(/\.$/u);
    expect(rule === undefined, kind).toBe(stop.stop !== "LoginMissing");
  }
});

test("only a stop that changed nothing says nothing was changed, and only one after the package went on says what was done stays done", () => {
  const unchanged = runnerStopsAll
    .filter((stop) =>
      setupRunnerStopSaid(stop, "p").tell.includes("nothing was changed"),
    )
    .map((stop) => (stop.stop === "Unread" ? stop.outcome : stop.stop));
  expect([...new Set(unchanged)].toSorted()).toEqual([
    "Engineless",
    "LoginMissing",
    "Mac",
    "NotAdmin",
    "Npmless",
    "Refused",
    "Serviceless",
    "SettingsUnread",
  ]);
});

test("each thing a run found is said as found and each thing it did as did, in words that name the path, the program or the service", () => {
  const lines = (kind: keyof typeof runnerNotes) =>
    runnerNotes[kind].map((note) =>
      setupRunnerNoteSaid(note, "acme/widgets").join(": "),
    );
  expect(lines("Package")).toEqual([
    `found: the runner package is installed: chuggy-linux 0.3.0, at ${rosterCommand}`,
    `found: the runner package is installed: chuggy-linux, at ${rosterCommand}`,
  ]);
  expect(lines("PoolGone")).toEqual([
    `found: ${rosterPool} registered this machine as shame, and the site lists no runner of acme/widgets by that name`,
  ]);
  expect(lines("Checked")).toEqual([
    "found: the runner's own check passed",
    "found: the runner's own check passed, with a warning: warn  job network: it is slow",
  ]);
  expect(lines("LingerOn")).toEqual([
    "did: set your services to keep running after you log out",
    "did: set your services to keep running after you log out, not having learned whether they already did",
  ]);
  expect(lines("Restarted")).toEqual([
    `did: restarted ${rosterUnit}, so it runs as it is now registered and installed`,
  ]);
  const words = Object.fromEntries(
    Object.entries(runnerNotes).map(([kind, notes]) => [
      kind,
      [...new Set(notes.map((note) => setupRunnerNoteSaid(note, "p")[0]))],
    ]),
  );
  expect(words).toEqual({
    Engine: ["found"],
    Package: ["found"],
    Installed: ["did"],
    Settings: ["found"],
    SettingsWritten: ["did"],
    Login: ["found"],
    Pool: ["found"],
    PoolGone: ["found"],
    Registered: ["did"],
    Checked: ["found"],
    Unit: ["found"],
    UnitWritten: ["did"],
    Linger: ["found"],
    LingerOn: ["did"],
    Running: ["found"],
    Started: ["did"],
    Restarted: ["did"],
  });
});

test("the first line of the check under a mark is found among the lines that are ok or not a check's at all, with the check it is of where this program knows it", () => {
  const aside = [
    "ok    pool file: /p names pool a/b/c",
    "something else: FAIL  plane: no",
    "warn  job network: chuggy-jobs is missing",
    "FAIL  container engine: docker did not answer",
    "FAIL  plane: https://pool/ did not answer",
    "warn  plane: slow",
  ].join("\n");
  expect(setupCheckFirst(aside, "FAIL")).toEqual({
    check: "container engine",
    line: "FAIL  container engine: docker did not answer",
  });
  expect(setupCheckFirst(aside, "warn")).toEqual({
    check: "job network",
    line: "warn  job network: chuggy-jobs is missing",
  });
  expect(setupCheckFirst("FAIL  a new check: no\n", "FAIL")).toEqual({
    check: undefined,
    line: "FAIL  a new check: no",
  });
  expect(
    setupCheckFirst("FAIL  toString: no\n", "FAIL")?.check,
  ).toBeUndefined();
  expect(setupCheckFirst("FAIL: no\nfailed\n", "FAIL")).toBeUndefined();
  expect(setupCheckFirst(aside, "warn")?.line).not.toContain("slow");
});

test("the checks this program has words for are the ones the package's doctor prints, in its order", () => {
  expect(Object.keys(setupRunnerChecks)).toEqual([
    "pool file",
    "runner configuration",
    "runtime directory",
    "Claude token file",
    "podman credential helpers",
    "container engine",
    "job network",
    "pool token",
    "plane",
  ]);
});

test("an excerpt has every secret the run knows struck from it, and everything shaped like one it was never told", () => {
  const token = "-Zy_registration-token-of-forty-three-chars";
  expect(setupExcerpt(`bad --token=${token}; again ${token}.`, [token])).toBe(
    `bad --token=${setupRedacted}; again ${setupRedacted}.`,
  );
  expect(setupExcerpt("short pw: hunter2 was sent", ["hunter2"])).toBe(
    `short pw: ${setupRedacted} was sent`,
  );
  expect(setupExcerpt("nothing known", ["", "absent"])).toBe("nothing known");
  const shaped = "a".repeat(24);
  expect(setupExcerpt(`id ${shaped} and ${shaped.slice(1)}`, [])).toBe(
    `id ${setupRedacted} and ${shaped.slice(1)}`,
  );
  expect(
    setupExcerpt(
      "Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6.eyJzdWIiOiIxMjM0NTY3ODkw.sig",
      [],
    ),
  ).toBe(`Bearer ${setupRedacted}.${setupRedacted}.sig`);
});

test("an excerpt is one line that holds nothing a terminal would obey, and no more than a line's worth", () => {
  expect(setupExcerpt("a\nnext: rm -rf ~\r\n\u001b[2Jb‮", [])).toBe(
    "a next: rm -rf ~ [2Jb",
  );
  const long = setupExcerpt("word ".repeat(100), []);
  expect(long).toHaveLength(setupExcerptCharsMax + 1);
  expect(long.endsWith("…")).toBe(true);
  expect(setupExcerpt("x".repeat(10) + " y".repeat(95), [])).toHaveLength(
    setupExcerptCharsMax,
  );
});
