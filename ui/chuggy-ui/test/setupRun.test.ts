/**
 * One run of the setup program over a machine and an installation that are
 * both doubles: what the bare command says of a remembered sign-in, and what
 * every command does with the token it holds.
 *
 * A renewal token is spent by the request that uses it, so the cases read the
 * file after each command as the next command would find it, and read every
 * body the program sent for a token that had no business being in it.
 */

import { expect, test } from "vitest";

import { apiAttemptsMax } from "../app/core/apiRequest.ts";
import { SetupMachineError, setupFiles } from "../app/core/setupPorts.ts";
import { setupRetryDelayMsMax } from "../app/core/setupSession.ts";
import { setupLockWaitMs, setupLockWord } from "../app/core/setupStore.ts";
import { machineDirectory, machineSite, setupMachine } from "./setupMachine.ts";
import type { SetupMachine } from "./setupMachine.ts";

const signedOut = {
  report: "SignedOut",
  site: machineSite,
  directory: machineDirectory,
  ended: undefined,
};

function remembered(machine: SetupMachine): unknown {
  const text = machine.files.get(setupFiles.session);
  return text === undefined ? undefined : JSON.parse(text);
}

/** A machine already signed in, as a sign-in the person finished leaves it. */
async function signedIn(): Promise<SetupMachine> {
  const machine = setupMachine();
  machine.opened = async () => {
    await machine.person();
  };
  await machine.command(["sign-in", "--site", machineSite]);
  machine.opened = () => Promise.resolve();
  machine.asked.length = 0;
  machine.bodies.length = 0;
  return machine;
}

test("with no site given and none remembered the program asks for one and touches nothing", async () => {
  const machine = setupMachine();
  expect(await machine.command([])).toEqual({ report: "SiteUnknown" });
  expect(machine.asked).toEqual([]);
  expect([...machine.files.keys()]).toEqual([]);
});

test("a site is remembered once it has answered as one, and the next command needs no flag", async () => {
  const machine = setupMachine();
  expect(await machine.command(["--site", `${machineSite}/acme/`])).toEqual(
    signedOut,
  );
  expect(remembered(machine)).toEqual({ site: machineSite });
  expect(await machine.command([])).toEqual(signedOut);
});

test("a site that does not answer is said to be unreachable and is not remembered", async () => {
  const machine = setupMachine();
  machine.site = "Silent";
  expect(await machine.command(["--site", machineSite])).toEqual({
    report: "SiteUnusable",
    site: machineSite,
    phase: "Unreachable",
    asked: "Status",
  });
  expect([...machine.files.keys()]).toEqual([]);
});

test("an address that is not a chuggy site is said not to be one", async () => {
  const machine = setupMachine();
  machine.site = "Refuses";
  expect(await machine.command(["--site", machineSite])).toMatchObject({
    report: "SiteUnusable",
    phase: "Unconfigured",
  });
});

test("a site whose issuer does not answer is told apart from a site that does not", async () => {
  const machine = setupMachine();
  machine.discovery = "Silent";
  expect(await machine.command(["sign-in", "--site", machineSite])).toEqual({
    report: "IssuerUnanswered",
    site: machineSite,
    asked: "SignIn",
  });
  expect(machine.detached).toEqual([]);
});

test("the bare command says who is signed in and lists the workspaces they administer", async () => {
  const machine = await signedIn();
  expect(await machine.command([])).toEqual({
    report: "SignedIn",
    site: machineSite,
    workspaces: ["acme"],
    truncated: false,
  });
});

test("each command spends the token it found and leaves the one that replaced it", async () => {
  const machine = await signedIn();
  const first = machine.live();
  await machine.command([]);
  const second = machine.live();
  expect(second).not.toBe(first);
  expect(remembered(machine)).toEqual({
    site: machineSite,
    refreshToken: second,
  });
  expect(machine.bodies).toHaveLength(1);
  expect(new URLSearchParams(machine.bodies[0]).get("refresh_token")).toBe(
    first,
  );
  expect(await machine.command([])).toMatchObject({ report: "SignedIn" });
  expect(machine.issued).toHaveLength(3);
});

test("a renewal the issuer refuses is not signed in and not a failure, and the next sign-in opens a page", async () => {
  const machine = await signedIn();
  machine.files.set(
    setupFiles.session,
    JSON.stringify({ site: machineSite, refreshToken: "renewal-spent" }),
  );
  expect(await machine.command([])).toEqual(signedOut);
  expect(await machine.command(["sign-in", "--wait-secs", "1"])).toMatchObject({
    report: "SignInWaiting",
    opened: "Opened",
  });
});

test("a renewal the issuer does not answer is a failure, and the token is kept", async () => {
  const machine = await signedIn();
  const held = machine.live();
  machine.token = "Silent";
  expect(await machine.command([])).toEqual({
    report: "IssuerUnanswered",
    site: machineSite,
    asked: "Status",
  });
  expect(remembered(machine)).toEqual({
    site: machineSite,
    refreshToken: held,
  });
  machine.token = "Answers";
  expect(await machine.command([])).toMatchObject({ report: "SignedIn" });
});

test("a site that renews the sign-in and then keeps saying try later is a failure, after waits this program bounds", async () => {
  const machine = await signedIn();
  machine.api = "Refuses";
  const began = machine.nowMs;
  expect(await machine.command([])).toEqual({
    report: "WorkspacesUnread",
    site: machineSite,
    outcome: "Retryable",
    asked: "Status",
  });
  expect(machine.nowMs - began).toBe(
    (apiAttemptsMax - 1) * setupRetryDelayMsMax,
  );
  expect(remembered(machine)).toEqual({
    site: machineSite,
    refreshToken: machine.live(),
  });
});

test("a body the site sends that this program cannot read is said to be unreadable", async () => {
  const machine = await signedIn();
  machine.tenants = [{ tenant: "acme", roles: ["Admin"] } as never];
  expect(await machine.command([])).toMatchObject({
    report: "WorkspacesUnread",
    outcome: "Unreadable",
  });
});

test("a run that takes the lock has what a cut-short write left of the sign-in removed, and one that cannot have it removes nothing", async () => {
  const machine = await signedIn();
  machine.swept.length = 0;
  await machine.command([]);
  expect(machine.swept).toEqual([setupFiles.session]);
  machine.alive.add(7);
  machine.lock = setupLockWord(7, machine.nowMs);
  expect(await machine.command([])).toMatchObject({ report: "Busy" });
  expect(machine.swept).toEqual([setupFiles.session]);
});

test("a site that refuses the sign-in it remembered is said to have, and the sign-in is forgotten", async () => {
  const machine = await signedIn();
  machine.admits = false;
  expect(await machine.command([])).toEqual({
    report: "WorkspacesUnread",
    site: machineSite,
    outcome: "Unauthenticated",
    asked: "Status",
  });
  expect(remembered(machine)).toEqual({ site: machineSite });
  expect(await machine.command([])).toEqual(signedOut);
});

test("a renewal the issuer answers with a fault of its own is a failure, and the token is kept", async () => {
  const machine = await signedIn();
  const held = machine.live();
  machine.token = "Fails";
  expect(await machine.command([])).toEqual({
    report: "IssuerUnanswered",
    site: machineSite,
    asked: "Status",
  });
  expect(remembered(machine)).toEqual({
    site: machineSite,
    refreshToken: held,
  });
});

test("a token remembered for one site is never sent for another, and the other site replaces it", async () => {
  const machine = await signedIn();
  const held = machine.live() ?? "";
  machine.files.set(
    setupFiles.session,
    JSON.stringify({ site: "https://elsewhere.example", refreshToken: held }),
  );
  expect(await machine.command(["--site", machineSite])).toEqual(signedOut);
  expect(machine.bodies.join(" ")).not.toContain(held);
  expect(remembered(machine)).toEqual({ site: machineSite });
});

test("a command that finds another run holding the lock waits a bounded time and then says so", async () => {
  const machine = await signedIn();
  machine.alive.add(7);
  const held = setupLockWord(7, machine.nowMs);
  machine.lock = held;
  const began = machine.nowMs;
  expect(await machine.command([])).toEqual({
    report: "Busy",
    asked: "Status",
    site: undefined,
    pid: 7,
  });
  expect(await machine.command(["sign-in", "--site", machineSite])).toEqual({
    report: "Busy",
    asked: "SignIn",
    site: machineSite,
    pid: 7,
  });
  expect(machine.nowMs - began).toBe(2 * setupLockWaitMs);
  expect(machine.lock).toBe(held);
  expect(machine.asked).toEqual([]);
});

test("a lock whose holder is gone is taken, and the command runs", async () => {
  const machine = await signedIn();
  machine.lock = setupLockWord(7, machine.nowMs);
  expect(await machine.command([])).toMatchObject({ report: "SignedIn" });
  expect(machine.lock).toBeUndefined();
});

test("a command asked wrongly says which part, and reads nothing", async () => {
  const machine = setupMachine();
  expect(await machine.command(["sign-out"])).toEqual({
    report: "AskedWrongly",
    fault: "Command",
  });
  expect([...machine.files.keys()]).toEqual([]);
});

/** A machine whose remembered sign-in cannot be read, and throws `failure` to whoever tries. */
async function unreadable(failure: Error): Promise<SetupMachine> {
  const machine = await signedIn();
  const read = machine.files.get.bind(machine.files);
  machine.files.get = (file) => {
    if (file === setupFiles.session) throw failure;
    return read(file);
  };
  return machine;
}

test("whatever a port throws ends as one report that carries nothing of what was thrown, and the lock is given up", async () => {
  const machine = await unreadable(new Error("renewal-secret"));
  for (const [argv, asked, site] of [
    [[], "Status", undefined],
    [["--site", `${machineSite}/acme`], "Status", machineSite],
    [["sign-in"], "SignIn", undefined],
  ] as const)
    expect(await machine.command(argv)).toEqual({
      report: "Faulted",
      asked,
      site,
      fault: { fault: "Unexpected" },
    });
  expect(machine.lock).toBeUndefined();
});

test("a listener the machine stops reports as the sign-in that ran it, since nobody runs a listener themselves", async () => {
  const machine = setupMachine();
  machine.files.set = () => {
    throw new Error("no room");
  };
  const listened = ["listen", "--site", machineSite, "--life-secs", "5"];
  expect(await machine.command(listened)).toEqual({
    report: "Faulted",
    asked: "SignIn",
    site: machineSite,
    fault: { fault: "Unexpected" },
  });
  expect(machine.listening()).toBeUndefined();
});

test("what the machine says it would not do is reported as the machine said it", async () => {
  for (const fault of [
    { fault: "Unwritable", path: "/home/person/.chuggy-setup" },
    { fault: "Unreadable", path: "/home/person/.chuggy-setup/session.json" },
    { fault: "Homeless" },
  ] as const) {
    const machine = await unreadable(new SetupMachineError(fault));
    expect(await machine.command([])).toEqual({
      report: "Faulted",
      asked: "Status",
      site: undefined,
      fault,
    });
    expect(machine.lock).toBeUndefined();
  }
});

/** A machine whose last sign-in the person declined in the browser, as the `sign-in` that waited on it leaves it. */
async function declined(): Promise<SetupMachine> {
  const machine = setupMachine();
  machine.opened = async () => {
    await machine.person(false);
  };
  expect(await machine.command(["sign-in", "--site", machineSite])).toEqual({
    report: "SignInEnded",
    site: machineSite,
    ended: "Declined",
  });
  machine.opened = () => Promise.resolve();
  return machine;
}

test("an ending that stands is what the bare command says, as often as it is asked, and it opens nothing and writes nothing", async () => {
  const machine = await declined();
  const kept = new Map(machine.files);
  for (let asked = 0; asked < 3; asked += 1)
    expect(await machine.command([])).toEqual({
      ...signedOut,
      ended: "Declined",
    });
  expect(new Map(machine.files)).toEqual(kept);
  expect(machine.detached).toHaveLength(1);
  expect(machine.launched).toHaveLength(1);
});

test("an ending stands until a sign-in is run, which opens a page, and the bare command then names sign-in again", async () => {
  const machine = await declined();
  expect(await machine.command(["sign-in", "--wait-secs", "0"])).toMatchObject({
    report: "SignInWaiting",
    opened: "Opened",
  });
  expect(machine.detached).toHaveLength(2);
  expect(await machine.command([])).toEqual(signedOut);
});

test("an ending for one site does not stand in the way of another", async () => {
  const machine = await declined();
  const other = "https://other.example";
  expect(await machine.command(["--site", other])).toEqual({
    ...signedOut,
    site: other,
  });
});

test("an ending nobody was waiting for is said by the bare command before any sign-in has reported it, and the bare command leaves it for sign-in to report", async () => {
  const machine = setupMachine();
  const waiting = ["sign-in", "--site", machineSite, "--wait-secs", "0"];
  expect(await machine.command(waiting)).toMatchObject({
    report: "SignInWaiting",
  });
  await machine.person(false);
  await machine.advance(0);
  const note = machine.files.get(setupFiles.signIn);
  expect(JSON.parse(note ?? "{}")).toMatchObject({
    ended: "Declined",
    told: false,
  });
  expect(await machine.command([])).toEqual({
    ...signedOut,
    ended: "Declined",
  });
  expect(machine.files.get(setupFiles.signIn)).toBe(note);
  expect(await machine.command(["sign-in"])).toEqual({
    report: "SignInEnded",
    site: machineSite,
    ended: "Declined",
  });
  expect(machine.detached).toHaveLength(1);
});
