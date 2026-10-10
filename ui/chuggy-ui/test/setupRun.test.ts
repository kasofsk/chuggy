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
import { setupAnswersNone } from "../app/core/setupArguments.ts";
import {
  SetupMachineError,
  setupFiles,
  setupPlatforms,
} from "../app/core/setupPorts.ts";
import { setupOpenerCommand } from "../app/core/setupSignIn.ts";
import { setupRetryDelayMsMax } from "../app/core/setupSession.ts";
import { setupLockWaitMs, setupLockWord } from "../app/core/setupStore.ts";
import {
  machineDirectory,
  machineDraftSuffix,
  machineKept,
  machineRevokeAddress,
  machineSignedIn,
  machineSite,
  machineTokenAddress,
  setupMachine,
} from "./setupMachine.ts";
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

const signedIn = (): Promise<SetupMachine> => machineSignedIn();

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

test("the bare command, signed in, reads where the person stands and reports it as a checklist", async () => {
  const machine = await signedIn();
  expect(await machine.command([])).toMatchObject({
    report: "Checklist",
    site: machineSite,
    found: [],
    steps: [
      { step: "workspace", state: "done", detail: "acme" },
      { step: "project", state: "todo", detail: "acme has no project yet" },
      { step: "github", state: "todo", detail: "" },
      { step: "repository", state: "todo", detail: "" },
      { step: "runner", state: "todo", detail: "" },
      { step: "ticket", state: "todo", detail: "" },
    ],
    next: { carried: setupAnswersNone, thing: { thing: "Hand" } },
  });
});

test("a sign-in asked for by someone already signed in ends as signed in, and opens no page", async () => {
  const machine = await signedIn();
  expect(await machine.command(["sign-in"])).toEqual({
    report: "SignInEnded",
    site: machineSite,
    ended: "SignedIn",
  });
  expect(machine.launched).toHaveLength(1);
  expect(machine.detached).toHaveLength(1);
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
  expect(await machine.command([])).toMatchObject({ report: "Checklist" });
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
  expect(await machine.command([])).toMatchObject({ report: "Checklist" });
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
  machine.world.tenants = [{ tenant: "acme", roles: ["Admin"] } as never];
  expect(await machine.command([])).toMatchObject({
    report: "WorkspacesUnread",
    outcome: "Unreadable",
  });
});

test("a run that takes the lock has what a cut-short write left of the sign-in removed, gives back the room it kept as it gives the lock up, and one that cannot have the lock removes nothing", async () => {
  const machine = await signedIn();
  await machine.command([]);
  expect(machine.swept).toEqual([setupFiles.session, setupFiles.session]);
  machine.alive.add(7);
  machine.lock = setupLockWord(7, machine.nowMs);
  expect(await machine.command([])).toMatchObject({ report: "Busy" });
  expect(machine.swept).toEqual([setupFiles.session, setupFiles.session]);
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

test("a bare run the site refuses sends the site its one read twice and the issuer two renewals and the revocation of the token it then held, and nothing else", async () => {
  const machine = await signedIn();
  machine.admits = false;
  await machine.command([]);
  const workspaces = `${machineSite}/access/v1/workspaces`;
  expect(machine.asked).toEqual([
    `${machineSite}/config.json`,
    "https://auth.example/.well-known/openid-configuration",
    machineTokenAddress,
    workspaces,
    machineTokenAddress,
    workspaces,
    machineRevokeAddress,
  ]);
  expect(machine.sent).toEqual([`GET ${workspaces}`, `GET ${workspaces}`]);
  expect(machine.revoked).toEqual([machine.issued.at(-1)]);
  expect(machine.revoked).toEqual([machine.live()]);
});

const unwritable = {
  fault: "Unwritable",
  path: `${machineKept}/${setupFiles.session}`,
};

test("a home that gives no room for the sign-in is found before the site or the issuer is asked anything, whichever command is run, and the sign-in is still good once it does", async () => {
  const machine = await signedIn();
  const held = remembered(machine);
  machine.room = () => false;
  for (const [argv, asked] of [
    [[], "Status"],
    [["sign-in"], "SignIn"],
  ] as const)
    expect(await machine.command(argv)).toEqual({
      report: "Faulted",
      asked,
      site: undefined,
      fault: unwritable,
    });
  expect(machine.asked).toEqual([]);
  expect(machine.reserved).toEqual([setupFiles.session, setupFiles.session]);
  expect(remembered(machine)).toEqual(held);
  expect(machine.lock).toBeUndefined();
  expect(machine.detached).toHaveLength(1);
  machine.room = () => true;
  expect(await machine.command([])).toMatchObject({ report: "Checklist" });
});

test("a run with no site to work under keeps no room, and one given a site keeps it before that site is asked", async () => {
  const machine = setupMachine();
  await machine.command([]);
  expect(machine.reserved).toEqual([]);
  machine.room = () => false;
  expect(await machine.command(["--site", machineSite])).toMatchObject({
    report: "Faulted",
    site: machineSite,
    fault: unwritable,
  });
  expect(machine.asked).toEqual([]);
  expect([...machine.files.keys()]).toEqual([]);
});

test("a token the issuer handed back that the machine would not write is a sign-in that was not kept, with the path, and never a sign-in server that is not answering", async () => {
  const machine = await signedIn();
  machine.takes = (file) => file !== setupFiles.session;
  expect(await machine.command([])).toEqual({
    report: "Faulted",
    asked: "Status",
    site: undefined,
    fault: { ...unwritable, fault: "Unkept" },
  });
  expect(machine.bodies).toHaveLength(1);
  expect(machine.sent).toEqual([]);
  expect(machine.lock).toBeUndefined();
});

const unswept = {
  fault: "Unwritable",
  path: `${machineKept}/${setupFiles.session}${machineDraftSuffix}`,
};

test("a sign-in that was not kept is what is said even where giving the lock up could not remove what the write left, and the lock is given up all the same", async () => {
  const machine = await signedIn();
  machine.takes = (file) => file !== setupFiles.session;
  machine.sweeps = (turn) => turn === 1;
  expect(await machine.command([])).toEqual({
    report: "Faulted",
    asked: "Status",
    site: undefined,
    fault: { ...unwritable, fault: "Unkept" },
  });
  expect(machine.swept).toHaveLength(2);
  expect(machine.lock).toBeUndefined();
});

test("a run that failed in no other way says what giving the lock up could not remove", async () => {
  const machine = await signedIn();
  machine.sweeps = (turn) => turn === 1;
  expect(await machine.command([])).toEqual({
    report: "Faulted",
    asked: "Status",
    site: undefined,
    fault: unswept,
  });
  expect(machine.lock).toBeUndefined();
});

test("a run that takes the lock and cannot remove what a cut-short write left gives the lock back, names the path, and asks nothing of the site or the issuer", async () => {
  const machine = await signedIn();
  machine.sweeps = () => false;
  for (const argv of [[], ["sign-in"]] as const) {
    expect(await machine.command(argv)).toMatchObject({
      report: "Faulted",
      fault: unswept,
    });
    expect(machine.lock).toBeUndefined();
  }
  expect(machine.asked).toEqual([]);
  machine.sweeps = () => true;
  expect(await machine.command([])).toMatchObject({ report: "Checklist" });
});

test("the bearer a run reads last is checked like the others: where it renewed, and the machine would not write that token, the sign-in was not kept", async () => {
  const machine = await signedIn();
  machine.accessSecs = 61;
  machine.answering = () => {
    machine.nowMs += 2_000;
  };
  let writes = 0;
  machine.takes = (file) => {
    if (file !== setupFiles.session) return true;
    writes += 1;
    return writes !== 2;
  };
  expect(await machine.command([])).toEqual({
    report: "Faulted",
    asked: "Status",
    site: undefined,
    fault: { ...unwritable, fault: "Unkept" },
  });
  expect(machine.bodies).toHaveLength(2);
  expect(machine.sent).toEqual([`GET ${machineSite}/access/v1/workspaces`]);
  expect(machine.lock).toBeUndefined();
});

test("a second renewal whose token the machine would not write is a sign-in that was not kept, whether or not the machine then let it be forgotten, and never a site that refused", async () => {
  for (const forgets of [true, false]) {
    const machine = await signedIn();
    machine.admits = false;
    let writes = 0;
    machine.takes = (file) => {
      if (file !== setupFiles.session) return true;
      writes += 1;
      return writes === 1 || (forgets && writes > 2);
    };
    expect(await machine.command([]), String(forgets)).toEqual({
      report: "Faulted",
      asked: "Status",
      site: undefined,
      fault: { ...unwritable, fault: "Unkept" },
    });
    expect(
      machine.asked.filter((address) => address === machineTokenAddress),
    ).toHaveLength(2);
    expect(machine.lock).toBeUndefined();
  }
});

test("room is kept again before a second renewal, and where the machine gives none that token is never asked for", async () => {
  const machine = await signedIn();
  machine.admits = false;
  machine.room = (turn) => turn === 1;
  expect(await machine.command([])).toEqual({
    report: "Faulted",
    asked: "Status",
    site: undefined,
    fault: unwritable,
  });
  expect(machine.reserved).toEqual([setupFiles.session, setupFiles.session]);
  expect(
    machine.asked.filter((address) => address === machineTokenAddress),
  ).toHaveLength(1);
});

test("a platform the program is not served on is told so before an argument is read or anything is asked, kept or started", async () => {
  const machine = setupMachine();
  machine.platform = "win32";
  machine.files.set(
    setupFiles.session,
    JSON.stringify({ site: machineSite, refreshToken: "renewal-held" }),
  );
  const kept = new Map(machine.files);
  for (const argv of [[], ["sign-in"], ["sign-out"], ["--site", machineSite]])
    expect(await machine.command(argv)).toEqual({
      report: "Unserved",
      platform: "win32",
    });
  expect(machine.asked).toEqual([]);
  expect(machine.reserved).toEqual([]);
  expect(machine.swept).toEqual([]);
  expect(machine.detached).toEqual([]);
  expect(new Map(machine.files)).toEqual(kept);
});

test("the platforms served are Linux and macOS, each one this program knows how to open a browser on", async () => {
  expect([...setupPlatforms]).toEqual(["linux", "darwin"]);
  for (const platform of setupPlatforms) {
    const machine = setupMachine();
    machine.platform = platform;
    expect(await machine.command([])).toEqual({ report: "SiteUnknown" });
    expect(
      setupOpenerCommand(
        { platform, browser: undefined, directory: machineDirectory },
        "http://127.0.0.1:41001/",
      ),
    ).toBeDefined();
  }
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
  expect(await machine.command([])).toMatchObject({ report: "Checklist" });
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

/** A machine whose sign-in page the person declined after the command that opened it had stopped waiting, so no command has said how it ended. */
async function declinedUnheard(): Promise<SetupMachine> {
  const machine = setupMachine();
  const waiting = ["sign-in", "--site", machineSite, "--wait-secs", "0"];
  expect(await machine.command(waiting)).toMatchObject({
    report: "SignInWaiting",
  });
  await machine.person(false);
  await machine.advance(0);
  expect(
    JSON.parse(machine.files.get(setupFiles.signIn) ?? "{}"),
  ).toMatchObject({ ended: "Declined", told: false });
  return machine;
}

test("an ending nobody was waiting for is said by the bare command, which leaves it as said, so the sign-in the person then asks for opens a page that time", async () => {
  const machine = await declinedUnheard();
  expect(await machine.command([])).toEqual({
    ...signedOut,
    ended: "Declined",
  });
  const note = machine.files.get(setupFiles.signIn);
  expect(JSON.parse(note ?? "{}")).toMatchObject({
    ended: "Declined",
    told: true,
  });
  expect(await machine.command([])).toEqual({
    ...signedOut,
    ended: "Declined",
  });
  expect(machine.files.get(setupFiles.signIn)).toBe(note);
  expect(machine.detached).toHaveLength(1);
  expect(await machine.command(["sign-in", "--wait-secs", "0"])).toMatchObject({
    report: "SignInWaiting",
    opened: "Opened",
  });
  expect(machine.detached).toHaveLength(2);
});

test("an ending the bare command has said is said again with its note left alone: the note is written once, however often the command is run", async () => {
  const machine = await declinedUnheard();
  const wrote: string[] = [];
  machine.takes = (file) => {
    wrote.push(file);
    return true;
  };
  for (const turn of ["first", "second", "third"])
    expect(await machine.command([]), turn).toEqual({
      ...signedOut,
      ended: "Declined",
    });
  expect(wrote.filter((file) => file === setupFiles.signIn)).toHaveLength(1);
});

test("an ending no command has said is said once by the sign-in that meets it first, and the sign-in after that opens a page", async () => {
  const machine = await declinedUnheard();
  expect(await machine.command(["sign-in"])).toEqual({
    report: "SignInEnded",
    site: machineSite,
    ended: "Declined",
  });
  expect(machine.detached).toHaveLength(1);
  expect(await machine.command([])).toEqual({
    ...signedOut,
    ended: "Declined",
  });
  expect(await machine.command(["sign-in", "--wait-secs", "0"])).toMatchObject({
    report: "SignInWaiting",
    opened: "Opened",
  });
});
