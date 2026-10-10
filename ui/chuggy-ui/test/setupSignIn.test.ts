/**
 * Signing in from a terminal, end to end over a machine and an installation
 * that are both doubles: the command, the listener it leaves behind and the
 * person's browser, which each case plays itself.
 *
 * What is checked is what a person's agent is told and what is left on the
 * machine afterwards: the remembered sign-in, the lock and the listener's
 * note. A case that ends signed in also checks the three things that means.
 */

import { expect, test } from "vitest";

import { setupFiles } from "../app/core/setupPorts.ts";
import {
  setupSignInPollMs,
  setupSignInStartSecsMax,
} from "../app/core/setupSignIn.ts";
import { setupLockWord } from "../app/core/setupStore.ts";
import {
  folded,
  machineAudience,
  machineSite,
  setupMachine,
} from "./setupMachine.ts";
import type { SetupMachine } from "./setupMachine.ts";

const signIn = ["sign-in", "--site", machineSite, "--wait-secs", "2"];

function remembered(machine: SetupMachine): unknown {
  const text = machine.files.get(setupFiles.session);
  return text === undefined ? undefined : JSON.parse(text);
}

function ended(ending: string) {
  return { report: "SignInEnded", site: machineSite, ended: ending };
}

/** The note a sign-in page left, as it reads now. */
function noted(machine: SetupMachine): unknown {
  const text = machine.files.get(setupFiles.signIn);
  return text === undefined ? undefined : JSON.parse(text);
}

/** A page that could not be started, as the `sign-in` that tried reports it. */
const unstarted = {
  report: "Faulted",
  asked: "SignIn",
  site: undefined,
  fault: { fault: "Unstarted" },
};

/** An address on the listener's port that the issuer answers at, carrying whatever a case puts in it. */
function answer(machine: SetupMachine, query: string): string {
  return `http://127.0.0.1:${String(machine.listening())}/callback?${query}`;
}

/** The state the page sent the browser to the issuer with. */
async function sent(machine: SetupMachine, address: string): Promise<string> {
  const first = await machine.browse(address);
  return new URL(first.location ?? "").searchParams.get("state") ?? "";
}

/** A machine whose person signs in as soon as the page opens. */
function prompt(allowed = true): SetupMachine {
  const machine = setupMachine();
  machine.opened = async () => {
    await machine.person(allowed);
  };
  return machine;
}

test("a sign-in the person finishes is remembered, and leaves neither a lock nor a note", async () => {
  const machine = prompt();
  expect(await machine.command(signIn)).toEqual(ended("SignedIn"));
  expect(remembered(machine)).toEqual({
    site: machineSite,
    refreshToken: machine.live(),
  });
  expect([...machine.files.keys()]).toEqual([setupFiles.session]);
  expect(machine.listening()).toBeUndefined();
  expect(machine.asked).toContain(`${machineSite}/access/v1/workspaces`);
});

test("the issuer is asked as the setup client, to answer on this machine's own address", async () => {
  const machine = setupMachine();
  let first = "";
  machine.opened = async (address) => {
    first = address;
    await machine.person();
  };
  await machine.command(signIn);
  const port = String(new URL(first).port);
  expect(first).toBe(`http://127.0.0.1:${port}/`);
  expect(machine.launched).toEqual([["xdg-open", first]]);
  const exchange = new URLSearchParams(machine.bodies[0]);
  expect(exchange.get("client_id")).toBe("chuggy-setup");
  expect(exchange.get("redirect_uri")).toBe(
    `http://127.0.0.1:${port}/callback`,
  );
  expect(machine.asked.join(" ")).not.toContain("localhost");
  expect(machine.bodies.join(" ")).not.toContain("localhost");
});

test("the page sends the browser to the issuer with the setup client's scopes and the API's audience", async () => {
  const machine = setupMachine();
  let sent = new URL("http://127.0.0.1/");
  machine.opened = async (address) => {
    sent = new URL((await machine.browse(address)).location ?? "");
  };
  await machine.command(signIn);
  expect(`${sent.origin}${sent.pathname}`).toBe(
    "https://auth.example/oauth2/auth",
  );
  expect(Object.fromEntries(sent.searchParams)).toMatchObject({
    response_type: "code",
    client_id: "chuggy-setup",
    scope: "openid offline_access",
    audience: machineAudience,
    code_challenge_method: "S256",
  });
  expect(sent.searchParams.get("redirect_uri")).toBe(
    `http://127.0.0.1:${String(machine.listening())}/callback`,
  );
});

test("a person slower than one wait finishes in the same page, and the next sign-in waits on it and opens nothing", async () => {
  const machine = setupMachine();
  const began = machine.nowMs;
  const waiting = await machine.command(signIn);
  expect(machine.nowMs - began).toBe(setupSignInPollMs + 2_000);
  expect(waiting).toEqual({
    report: "SignInWaiting",
    site: machineSite,
    port: machine.listening(),
    opened: "Opened",
    waitedSecs: 2,
  });
  const attached = machine.command(signIn);
  await machine.person();
  expect(await attached).toEqual(ended("SignedIn"));
  expect(machine.detached).toHaveLength(1);
  expect(machine.launched).toHaveLength(1);
});

test("a sign-in that is still waiting says so again, as one it did not open", async () => {
  const machine = setupMachine();
  await machine.command(signIn);
  expect(await machine.command(signIn)).toMatchObject({
    report: "SignInWaiting",
    opened: "Attached",
  });
  expect(machine.detached).toHaveLength(1);
});

test("a person who finishes between two commands is found signed in by the second", async () => {
  const machine = setupMachine();
  await machine.command(signIn);
  await machine.person();
  await machine.advance(0);
  expect(noted(machine)).toMatchObject({ ended: "SignedIn", told: false });
  expect(await machine.command(signIn)).toEqual(ended("SignedIn"));
  expect([...machine.files.keys()]).toEqual([setupFiles.session]);
  expect(machine.detached).toHaveLength(1);
});

test("where no browser can be opened the address is handed over at once, and the next sign-in waits on it", async () => {
  const machine = setupMachine();
  machine.opener = { launched: "Unstarted" };
  const handed = await machine.command(signIn);
  expect(handed).toEqual({
    report: "SignInWaiting",
    site: machineSite,
    port: machine.listening(),
    opened: "NotOpened",
    waitedSecs: 0,
  });
  const attached = machine.command(signIn);
  await machine.person();
  expect(await attached).toEqual(ended("SignedIn"));
});

test("an opener that ends badly opened nothing, and one still running did", async () => {
  const failed = setupMachine();
  failed.opener = { launched: "Ended", exit: 3 };
  expect(await failed.command(signIn)).toMatchObject({ opened: "NotOpened" });
  const running = setupMachine();
  running.opener = { launched: "Running" };
  expect(await running.command(signIn)).toMatchObject({ opened: "Opened" });
});

test("a machine this program knows no opener for is handed the address", async () => {
  const machine = setupMachine();
  machine.platform = "plan9";
  expect(await machine.command(signIn)).toMatchObject({ opened: "NotOpened" });
  expect(machine.launched).toEqual([]);
});

test("the person's own opener is used where they named one", async () => {
  const machine = prompt();
  machine.browser = "/usr/bin/their-browser";
  await machine.command(signIn);
  expect(machine.launched[0]?.[0]).toBe("/usr/bin/their-browser");
});

test("a sign-in declined in the browser is said to be, nothing is remembered, and the ending is kept as told", async () => {
  const machine = prompt(false);
  const began = machine.nowMs;
  expect(await machine.command(signIn)).toEqual(ended("Declined"));
  expect(remembered(machine)).toEqual({ site: machineSite });
  expect(machine.bodies).toEqual([]);
  expect(noted(machine)).toEqual({
    note: "Ended",
    site: machineSite,
    ended: "Declined",
    endedAtMs: began + setupSignInPollMs,
    told: true,
  });
  expect(machine.lock).toBeUndefined();
});

test("a sign-in that reports an ending the bare command does not stand on drops it", async () => {
  const machine = prompt();
  machine.api = "Refuses";
  expect(await machine.command(signIn)).toEqual(ended("WorkspacesUnread"));
  expect(noted(machine)).toBeUndefined();
});

test("an ending a waiting sign-in could not have the lock to mark is reported all the same, and is the next sign-in's to report again", async () => {
  const machine = setupMachine();
  machine.opened = async () => {
    await machine.person(false);
    machine.alive.add(7);
    machine.lock = setupLockWord(7, machine.nowMs);
  };
  expect(await machine.command(signIn)).toEqual(ended("Declined"));
  expect(noted(machine)).toMatchObject({ ended: "Declined", told: false });
  machine.lock = undefined;
  expect(await machine.command(signIn)).toEqual(ended("Declined"));
  expect(noted(machine)).toMatchObject({ ended: "Declined", told: true });
  expect(machine.detached).toHaveLength(1);
});

test("a refusal that is not the person's is the issuer's", async () => {
  const machine = setupMachine();
  machine.opened = async (address) => {
    const state = await sent(machine, address);
    await machine.browse(answer(machine, `error=invalid_scope&state=${state}`));
  };
  expect(await machine.command(signIn)).toEqual(ended("Refused"));
});

test("a denial that does not carry this sign-in's state ends nothing, and the person's own answer then finishes", async () => {
  const machine = setupMachine();
  const statuses: number[] = [];
  machine.opened = async () => {
    for (const forged of [
      "error=access_denied",
      "error=access_denied&state=",
      "error=access_denied&state=someone-elses",
      "error=invalid_scope&state=someone-elses",
    ])
      statuses.push((await machine.browse(answer(machine, forged))).status);
    expect(machine.files.get(setupFiles.signIn)).toContain("Waiting");
    await machine.person();
  };
  expect(await machine.command(signIn)).toEqual(ended("SignedIn"));
  expect(statuses).toEqual([400, 400, 400, 400]);
  expect(remembered(machine)).toMatchObject({ refreshToken: machine.live() });
});

test("a state whose digest differs from the sent one's in any one octet, or only in how long it is, is not this sign-in's", async () => {
  const machine = setupMachine();
  const width = folded(new Uint8Array(0)).length;
  const guesses = [
    ...Array.from({ length: width }, (_, at) => `differs-at-${String(at)}`),
    "one-short",
    "one-long",
  ];
  machine.opened = async (address) => {
    const state = await sent(machine, address);
    machine.digest = (message) => {
      const text = new TextDecoder().decode(message);
      if (text === state) return new Uint8Array(width);
      if (text === "one-short") return new Uint8Array(width - 1);
      if (text === "one-long") return new Uint8Array(width + 1);
      const digest = new Uint8Array(width);
      const differing = /^differs-at-(\d+)$/u.exec(text);
      if (differing === null) return digest.fill(255);
      digest[Number(differing[1])] = 1;
      return digest;
    };
    for (const guess of guesses) {
      const forged = `error=access_denied&state=${guess}`;
      expect((await machine.browse(answer(machine, forged))).status).toBe(400);
      expect(noted(machine), guess).toMatchObject({ note: "Waiting" });
    }
    await machine.person();
  };
  expect(width).toBe(32);
  expect(await machine.command(signIn)).toEqual(ended("SignedIn"));
});

test("a sign-in that sent no state takes no request for its answer, the issuer's own included", async () => {
  const machine = setupMachine();
  const drawn = machine.draws;
  machine.draws = (count, turn) => drawn(turn === 2 ? 0 : count, turn);
  const statuses: number[] = [];
  machine.opened = async (address) => {
    expect(await sent(machine, address)).toBe("");
    for (const forged of [
      "error=access_denied",
      "error=access_denied&state=",
      "code=code-1&state=",
      "code=code-1",
    ])
      statuses.push((await machine.browse(answer(machine, forged))).status);
    statuses.push((await machine.person()).status);
    statuses.push((await machine.person(false)).status);
  };
  expect(await machine.command(signIn)).toMatchObject({
    report: "SignInWaiting",
  });
  expect(statuses).toEqual([400, 400, 400, 400, 400, 400]);
  expect(machine.bodies).toEqual([]);
  expect(noted(machine)).toMatchObject({ note: "Waiting" });
});

test("a code that does not carry this sign-in's state spends nothing, and the person's own answer then finishes", async () => {
  const machine = setupMachine();
  const statuses: number[] = [];
  machine.opened = async (address) => {
    const state = await sent(machine, address);
    expect(state.length).toBeGreaterThan(32);
    for (const guessed of [
      "someone-elses",
      `${state}x`,
      state.slice(0, -1),
      `x${state.slice(1)}`,
      `${state.slice(0, -1)}!`,
    ])
      statuses.push(
        (await machine.browse(answer(machine, `code=code-1&state=${guessed}`)))
          .status,
      );
    expect(machine.bodies).toEqual([]);
    expect(machine.files.get(setupFiles.signIn)).toContain("Waiting");
    await machine.person();
  };
  expect(await machine.command(signIn)).toEqual(ended("SignedIn"));
  expect(statuses).toEqual([400, 400, 400, 400, 400]);
  expect(machine.bodies).toHaveLength(1);
});

test("a denial somebody else sent does not stand in for the person's own, which still ends the sign-in", async () => {
  const machine = setupMachine();
  machine.opened = async () => {
    const forged = await machine.browse(
      answer(machine, "error=access_denied&state=someone-elses"),
    );
    expect(forged.status).toBe(400);
    await machine.person(false);
  };
  expect(await machine.command(signIn)).toEqual(ended("Declined"));
  expect(machine.bodies).toEqual([]);
});

test("an answer that carries the state and neither a code nor a refusal is not one, and the page goes on waiting", async () => {
  const machine = setupMachine();
  let status = 0;
  machine.opened = async (address) => {
    const state = await sent(machine, address);
    status = (await machine.browse(answer(machine, `state=${state}`))).status;
    await machine.person();
  };
  expect(await machine.command(signIn)).toEqual(ended("SignedIn"));
  expect(status).toBe(400);
});

test("an allow page that hands over no renewal token is not a sign-in", async () => {
  const machine = prompt();
  machine.renewable = false;
  expect(await machine.command(signIn)).toEqual(ended("NoRenewal"));
  expect(remembered(machine)).toEqual({ site: machineSite });
});

test("an answer the issuer will not exchange is not a sign-in", async () => {
  const machine = prompt();
  machine.token = "Refuses";
  expect(await machine.command(signIn)).toEqual(ended("ExchangeFailed"));
  expect(remembered(machine)).toEqual({ site: machineSite });
});

test("an exchange the issuer answers with nothing readable is its failure, not another sign-in's answer", async () => {
  const machine = prompt();
  machine.token = "Garbles";
  expect(await machine.command(signIn)).toEqual(ended("ExchangeFailed"));
  expect(remembered(machine)).toEqual({ site: machineSite });
});

test("a token remembered from before does not pass for the renewal token an allow page withheld", async () => {
  const machine = prompt();
  await machine.command(signIn);
  const spent = machine.files.get(setupFiles.session) ?? "";
  await machine.command([]);
  machine.files.set(setupFiles.session, spent);
  expect(await machine.command([])).toMatchObject({ report: "SignedOut" });
  machine.renewable = false;
  expect(await machine.command(signIn)).toEqual(ended("NoRenewal"));
  expect(machine.files.get(setupFiles.session)).toBe(spent);
});

test("a sign-in the site then answers nothing for is not confirmed, and its token is kept for the next command", async () => {
  const machine = prompt();
  machine.api = "Refuses";
  expect(await machine.command(signIn)).toEqual(ended("WorkspacesUnread"));
  expect(remembered(machine)).toEqual({
    site: machineSite,
    refreshToken: machine.live(),
  });
});

test("a sign-in the site itself refuses is said to be refused, and nothing of it is remembered", async () => {
  const machine = prompt();
  machine.admits = false;
  expect(await machine.command(signIn)).toEqual(ended("SiteRefused"));
  expect(remembered(machine)).toEqual({ site: machineSite });
});

test("a page whose site is no longer the one remembered exchanges nothing, and the other site's sign-in is left as it was", async () => {
  const machine = setupMachine();
  const other = "https://other.example";
  await machine.command(signIn);
  expect(await machine.command(["--site", other])).toMatchObject({
    report: "SignedOut",
    site: other,
  });
  const theirs = JSON.stringify({ site: other, refreshToken: "theirs" });
  machine.files.set(setupFiles.session, theirs);
  expect((await machine.person()).status).toBe(400);
  await machine.advance(0);
  expect(machine.listening()).toBeUndefined();
  expect(machine.bodies).toEqual([]);
  expect(machine.files.get(setupFiles.session)).toBe(theirs);
  expect(machine.lock).toBeUndefined();
  expect(await machine.command(signIn)).toEqual(ended("SiteChanged"));
});

test("only the address the issuer was given is read as its answer", async () => {
  const machine = setupMachine();
  const statuses: number[] = [];
  machine.opened = async (address) => {
    const first = await machine.browse(address);
    const back = new URL(machine.authorized(first.location ?? "", true));
    for (const path of ["/callback/", "/auth/callback", "/"])
      statuses.push(
        (await machine.browse(`${back.origin}${path}${back.search}`)).status,
      );
    statuses.push((await machine.browse(`${back.origin}/callback`)).status);
    statuses.push((await machine.browse(back.href)).status);
  };
  expect(await machine.command(signIn)).toEqual(ended("SignedIn"));
  expect(statuses).toEqual([404, 404, 302, 400, 200]);
});

test("an answer with a code and no state, or sent as anything but a page load, is not read and the page goes on waiting", async () => {
  const machine = setupMachine();
  const statuses: number[] = [];
  machine.opened = async (address) => {
    const first = await machine.browse(address);
    const back = new URL(machine.authorized(first.location ?? "", true));
    const code = back.searchParams.get("code") ?? "";
    statuses.push(
      (await machine.browse(`${back.origin}/callback?code=${code}`)).status,
      (await machine.browse(back.href, "POST")).status,
      (await machine.browse(address, "HEAD")).status,
    );
    expect(machine.bodies).toEqual([]);
    statuses.push((await machine.browse(back.href)).status);
  };
  expect(await machine.command(signIn)).toEqual(ended("SignedIn"));
  expect(statuses).toEqual([400, 405, 405, 200]);
});

test("a page answered once answers nothing a second time", async () => {
  const machine = setupMachine();
  let second = 0;
  machine.opened = async (address) => {
    const first = await machine.browse(address);
    const back = machine.authorized(first.location ?? "", true);
    const answering = machine.browse(back);
    second = (await machine.browse(back)).status;
    await answering;
  };
  expect(await machine.command(signIn)).toEqual(ended("SignedIn"));
  expect(second).toBe(409);
  expect(machine.bodies).toHaveLength(1);
});

test("a page nobody finishes closes at its bound, and the next sign-in says so once before opening another", async () => {
  const machine = setupMachine();
  await machine.command(signIn);
  await machine.advance(600_000);
  expect(machine.listening()).toBeUndefined();
  expect(noted(machine)).toMatchObject({ ended: "Expired", told: false });
  expect(await machine.command(signIn)).toEqual(ended("Expired"));
  expect(noted(machine)).toMatchObject({ ended: "Expired", told: true });
  expect(machine.detached).toHaveLength(1);
  expect(await machine.command(signIn)).toMatchObject({
    report: "SignInWaiting",
    opened: "Opened",
  });
  expect(machine.detached).toHaveLength(2);
  expect(noted(machine)).toMatchObject({ note: "Waiting" });
});

test("an ending nobody was told while it was worth telling is dropped, and a page is opened", async () => {
  const machine = setupMachine();
  await machine.command(signIn);
  await machine.advance(600_000);
  await machine.advance(600_001);
  expect(await machine.command(signIn)).toMatchObject({
    report: "SignInWaiting",
    opened: "Opened",
  });
});

test("an answer that arrives as the page closes at its bound is not read, and the ending stays that nobody finished", async () => {
  const machine = setupMachine();
  let late = 0;
  machine.opened = async (address) => {
    const first = await machine.browse(address);
    const back = machine.authorized(first.location ?? "", true);
    machine.closing = async () => {
      late = (await machine.browse(back)).status;
    };
  };
  await machine.command(signIn);
  await machine.advance(600_000);
  expect(late).toBe(409);
  expect(machine.bodies).toEqual([]);
  expect(await machine.command(signIn)).toEqual(ended("Expired"));
  expect(remembered(machine)).toEqual({ site: machineSite });
});

test("a page for one site that ends after a page for another was started leaves the other's note alone", async () => {
  const machine = setupMachine();
  const other = "https://other.example";
  const began = machine.nowMs;
  await machine.command(signIn);
  const second = await machine.command(["sign-in", "--site", other]);
  expect(second).toMatchObject({ report: "SignInWaiting", site: other });
  expect(machine.detached).toHaveLength(2);
  await machine.advance(began + 600_500 - machine.nowMs);
  expect(await machine.command(["sign-in", "--wait-secs", "0"])).toMatchObject({
    report: "SignInWaiting",
    site: other,
    opened: "Attached",
  });
  expect(machine.detached).toHaveLength(2);
});

test("an answer being read when the bound passes is read to its end", async () => {
  const machine = setupMachine();
  await machine.command(signIn);
  machine.alive.add(7);
  machine.lock = setupLockWord(7, machine.nowMs + 590_000);
  await machine.advance(590_000);
  const answering = machine.person();
  await machine.advance(15_000);
  expect(machine.files.get(setupFiles.signIn)).toContain("Waiting");
  machine.lock = undefined;
  await machine.advance(1_000);
  expect((await answering).status).toBe(200);
  expect(await machine.command(signIn)).toEqual(ended("SignedIn"));
});

test("a listener that cannot have the lock in time ends as busy and writes no token", async () => {
  const machine = setupMachine();
  await machine.command(signIn);
  machine.alive.add(7);
  machine.lock = setupLockWord(7, machine.nowMs);
  const answering = machine.person();
  await machine.advance(31_000);
  expect((await answering).status).toBe(400);
  machine.lock = undefined;
  expect(await machine.command(signIn)).toEqual(ended("Busy"));
  expect(machine.bodies).toEqual([]);
});

test("two sign-ins at once open one page between them", async () => {
  const machine = setupMachine();
  const [first, second] = await Promise.all([
    machine.command(signIn),
    machine.command(signIn),
  ]);
  expect(machine.detached).toHaveLength(1);
  expect([first.report, second.report]).toEqual([
    "SignInWaiting",
    "SignInWaiting",
  ]);
});

test("a listener the site will not start a sign-in for says so and is gone", async () => {
  const machine = setupMachine();
  machine.site = "Silent";
  const listened = ["listen", "--site", machineSite, "--life-secs", "5"];
  expect(await machine.command(listened)).toEqual(ended("SiteUnusable"));
  expect(machine.listening()).toBeUndefined();
  expect(machine.files.get(setupFiles.signIn)).toContain("SiteUnusable");
});

test("a site that stops answering once the page is being started ends the command that started it", async () => {
  const machine = setupMachine();
  let reads = 0;
  Object.defineProperty(machine, "site", {
    get: () => {
      reads += 1;
      return reads > 1 ? "Silent" : "Answers";
    },
  });
  expect(await machine.command(signIn)).toEqual(ended("SiteUnusable"));
  expect(machine.launched).toEqual([]);
  expect(noted(machine)).toMatchObject({ ended: "SiteUnusable", told: true });
});

test("a listener that is gone before it says where it listens ends the command at once, as a failure", async () => {
  const machine = setupMachine();
  machine.spawning = "Dies";
  const began = machine.nowMs;
  expect(await machine.command(signIn)).toEqual(unstarted);
  expect(machine.nowMs).toBe(began);
  expect(machine.launched).toEqual([]);
});

test("a listener that is running and never says where it listens is waited on for a bounded time", async () => {
  const machine = setupMachine();
  machine.spawning = "Mute";
  const began = machine.nowMs;
  expect(await machine.command(signIn)).toEqual(unstarted);
  expect(machine.nowMs - began).toBe(setupSignInStartSecsMax * 1_000);
});

test("a listener that cannot be started is a failure at once, and nothing is opened", async () => {
  const machine = setupMachine();
  machine.spawning = "Unstarted";
  const began = machine.nowMs;
  expect(await machine.command(signIn)).toEqual(unstarted);
  expect(machine.nowMs - began).toBe(0);
  expect(machine.launched).toEqual([]);
  expect([...machine.files.keys()]).toEqual([setupFiles.session]);
});

test("a listener that is gone without a word ends the command waiting on it", async () => {
  const machine = setupMachine();
  const waiting = await machine.command(signIn);
  expect(waiting).toMatchObject({ report: "SignInWaiting" });
  machine.alive.clear();
  expect(await machine.command(signIn)).toMatchObject({
    report: "SignInWaiting",
    opened: "Opened",
  });
  expect(machine.detached).toHaveLength(2);
});

test("a listener that goes while a command waits on it ends that wait, and what it left says the page is over", async () => {
  const machine = setupMachine();
  machine.opened = () => {
    machine.alive.delete(Math.max(...machine.alive));
    return Promise.resolve();
  };
  expect(await machine.command(signIn)).toEqual(ended("Expired"));
  expect(noted(machine)).toEqual({
    note: "Ended",
    site: machineSite,
    ended: "Expired",
    endedAtMs: machine.nowMs,
    told: true,
  });
});

test("a wait that finds its listener gone writes over no page started since", async () => {
  const machine = setupMachine();
  const other = "https://other.example";
  machine.opened = async () => {
    machine.alive.delete(Math.max(...machine.alive));
    machine.opened = () => Promise.resolve();
    await machine.command(["sign-in", "--site", other, "--wait-secs", "0"]);
  };
  expect(await machine.command(signIn)).toEqual(ended("Expired"));
  expect(noted(machine)).toMatchObject({ note: "Waiting", site: other });
});
