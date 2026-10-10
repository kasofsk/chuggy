/**
 * The setup program signing in, as a process, against a stand-in installation
 * on this machine's own address, with the suite as the person's browser.
 *
 * These are the cases only real HTTP and real processes can make: a listener
 * that outlives the command that started it, an issuer that checks the proof
 * key and the redirect it is given, and a renewal token that one process
 * stores and the next one spends. The decisions under them are held by the
 * console's own suites over doubles.
 */

import assert from "node:assert/strict";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { browsed, ended, eventually, making, person } from "./program.ts";
import type { Home, Ran } from "./program.ts";
import type { StandIn } from "./standIn.ts";

const made = making();

async function installed(): Promise<{
  readonly installation: StandIn;
  readonly machine: Home;
}> {
  return { installation: await made.installation(), machine: made.machine() };
}

function remembered(machine: Home): { site?: string; refreshToken?: string } {
  return JSON.parse(machine.file("session.json") ?? "{}") as {
    site?: string;
    refreshToken?: string;
  };
}

/** Runs `sign-in` and plays `played` in the browser it opens, answering what the command said. */
async function signedIn(
  installation: StandIn,
  machine: Home,
  played: (address: string) => Promise<unknown> = person,
): Promise<Ran> {
  const running = machine.run(["sign-in", "--site", installation.site]);
  await played(await machine.opened());
  return running;
}

test("a sign-in the person finishes is exchanged, remembered and said, on this machine's own address", async () => {
  const { installation, machine } = await installed();
  let address = "";
  const done = await signedIn(installation, machine, async (opened) => {
    address = opened;
    const page = await person(opened);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /^Signed in to chuggy\./u);
  });
  assert.match(address, /^http:\/\/127\.0\.0\.1:\d+\/$/u);
  assert.deepEqual(done.lines.slice(0, -1), [
    `site: ${installation.site}, signed in`,
  ]);
  assert.match(done.lines.at(-1) ?? "", /^next: node \S+$/u);
  assert.equal(done.code, 0);
  assert.equal(done.stderr, "");
  assert.deepEqual(installation.grants, ["authorization_code granted"]);
  assert.deepEqual(installation.refusals, []);
  assert.ok(remembered(machine).refreshToken === installation.renewal());
  assert.equal(remembered(machine).site, installation.site);
  assert.equal(machine.lock(), undefined);
  assert.equal(machine.file("sign-in.json"), undefined);
});

test("neither the program nor anything it asked ever names localhost", async () => {
  const { installation, machine } = await installed();
  await signedIn(installation, machine);
  await machine.run([]);
  const everything = [...installation.asked, ...machine.written].join("\n");
  assert.ok(everything.includes("127.0.0.1"));
  assert.ok(!everything.includes("localhost"));
});

test("a second run renews with what the first stored, and a third with what the second did", async () => {
  const { installation, machine } = await installed();
  await signedIn(installation, machine);
  const first = remembered(machine).refreshToken;
  const second = await machine.run([]);
  assert.equal(second.code, 0, second.stdout);
  assert.deepEqual(second.lines, [
    `site: ${installation.site}, signed in`,
    "workspace: acme",
    "next: stop",
  ]);
  assert.ok(remembered(machine).refreshToken !== first);
  assert.ok(remembered(machine).refreshToken === installation.renewal());
  const third = await machine.run([]);
  assert.equal(third.lines[0], `site: ${installation.site}, signed in`);
  assert.ok(remembered(machine).refreshToken === installation.renewal());
  assert.deepEqual(installation.grants, [
    "authorization_code granted",
    "refresh_token granted",
    "refresh_token granted",
  ]);
});

test("a renewal the issuer refuses is not signed in and not a failure, and sign-in is next", async () => {
  const { installation, machine } = await installed();
  await signedIn(installation, machine);
  const spent = remembered(machine).refreshToken ?? "";
  await machine.run([]);
  const fresh = machine.file("session.json") ?? "";
  writeFileSync(
    join(machine.directory, "session.json"),
    JSON.stringify({ site: installation.site, refreshToken: spent }),
  );
  const replayed = await machine.run([]);
  assert.equal(replayed.code, 0);
  assert.equal(replayed.lines[0], `site: ${installation.site}, not signed in`);
  assert.match(replayed.lines.at(-1) ?? "", /^next: node \S+ sign-in$/u);
  assert.equal(installation.grants.at(-1), "refresh_token refused");
  writeFileSync(join(machine.directory, "session.json"), fresh);
  const ended = await machine.run([]);
  assert.equal(ended.lines[0], `site: ${installation.site}, not signed in`);
});

test("a sign-in the site does not confirm is a failure that is kept, and the next command confirms it once the site answers", async () => {
  const { installation, machine } = await installed();
  installation.serves = false;
  const done = await signedIn(installation, machine, async (opened) => {
    assert.equal((await person(opened)).status, 400);
  });
  assert.equal(done.code, 1);
  assert.deepEqual(done.lines.slice(0, -1), [
    `site: ${installation.site}, not signed in`,
    "found: the sign-in went through, but the site did not say which workspaces are yours",
  ]);
  assert.match(done.lines.at(-1) ?? "", /^next: node \S+$/u);
  assert.ok(remembered(machine).refreshToken === installation.renewal());
  const unread = await machine.run([]);
  assert.equal(unread.code, 1);
  assert.deepEqual(unread.lines.slice(0, -1), [
    `site: ${installation.site}, sign-in not confirmed`,
    "found: the site did not say which workspaces are yours (Fault)",
  ]);
  assert.match(unread.lines.at(-1) ?? "", /^next: node \S+$/u);
  installation.serves = true;
  const confirmed = await machine.run([]);
  assert.equal(confirmed.code, 0);
  assert.deepEqual(confirmed.lines, [
    `site: ${installation.site}, signed in`,
    "workspace: acme",
    "next: stop",
  ]);
  assert.equal(
    installation.asked.filter((line) => line.includes("/oauth2/auth")).length,
    1,
  );
});

const declined = [
  "found: the sign-in was declined in the browser",
  "tell: The sign-in was declined in the browser, so chuggy setup is not signed in and nothing was changed. Tell me if you want to sign in after all.",
];

const declinedRule =
  /^rule: Run node \S+ sign-in only if the person asks to sign in after all\.$/u;

/** How many times the issuer was asked to start a sign-in, which is how many pages were opened and followed. */
function pages(installation: StandIn): number {
  return installation.asked.filter((line) => line.includes("/oauth2/auth"))
    .length;
}

test("a sign-in declined in the browser is said as that, nothing is exchanged, and nothing is run next", async () => {
  const { installation, machine } = await installed();
  installation.allows = false;
  const done = await signedIn(installation, machine, async (opened) => {
    assert.equal((await person(opened)).status, 400);
  });
  assert.equal(done.code, 0);
  assert.deepEqual(done.lines.slice(0, 3), [
    `site: ${installation.site}, not signed in`,
    ...declined,
  ]);
  assert.match(done.lines[3] ?? "", declinedRule);
  assert.deepEqual(done.lines.slice(4), ["next: stop"]);
  assert.deepEqual(installation.grants, []);
  assert.equal(remembered(machine).refreshToken, undefined);
  assert.match(
    machine.file("sign-in.json") ?? "",
    /"ended":"Declined".*"told":true/u,
  );
});

test("a declined sign-in stands: the bare command says it again and opens nothing, however often it is run, until a sign-in is", async () => {
  const { installation, machine } = await installed();
  installation.allows = false;
  await signedIn(installation, machine, person);
  const note = machine.file("sign-in.json");
  for (let asked = 0; asked < 3; asked += 1) {
    const stood = await machine.run([]);
    assert.equal(stood.code, 0);
    assert.equal(stood.stderr, "");
    assert.deepEqual(stood.lines.slice(0, 3), [
      `site: ${installation.site}, not signed in`,
      ...declined,
    ]);
    assert.match(stood.lines[3] ?? "", /^rule: Run the command on the next: /u);
    assert.match(stood.lines[4] ?? "", /^rule: Never read or print /u);
    assert.match(stood.lines[5] ?? "", declinedRule);
    assert.deepEqual(stood.lines.slice(6), ["next: stop"]);
  }
  assert.equal(pages(installation), 1);
  assert.equal(existsSync(join(machine.beside, "opened")), false);
  assert.ok(machine.file("sign-in.json") === note);
  installation.allows = true;
  const done = await signedIn(installation, machine);
  assert.equal(done.lines[0], `site: ${installation.site}, signed in`);
  assert.equal(pages(installation), 2);
  assert.equal(machine.file("sign-in.json"), undefined);
  const after = await machine.run([]);
  assert.equal(after.lines[0], `site: ${installation.site}, signed in`);
});

test("a sign-in the issuer will not exchange is said to the person, and a page that would fail the same way is not opened again unasked", async () => {
  const { installation, machine } = await installed();
  const done = await signedIn(installation, machine, async (opened) => {
    const sent = await browsed(opened);
    const allowed = await browsed(sent.headers.get("location") ?? "");
    const back = new URL(allowed.headers.get("location") ?? "");
    back.searchParams.set("code", "not-the-code");
    assert.equal((await browsed(back.href)).status, 400);
  });
  assert.equal(done.code, 1);
  assert.deepEqual(done.lines.slice(0, 3), [
    `site: ${installation.site}, not signed in`,
    "found: the sign-in server did not accept the answer",
    "tell: The sign-in server did not accept the answer the browser brought back, so chuggy setup is not signed in. Tell me if you want to try signing in again.",
  ]);
  assert.match(
    done.lines[3] ?? "",
    /^rule: Run node \S+ sign-in only if the person asks to try signing in again\.$/u,
  );
  assert.deepEqual(done.lines.slice(4), ["next: stop"]);
  const stood = await machine.run([]);
  assert.equal(
    stood.lines[1],
    "found: the sign-in server did not accept the answer",
  );
  assert.equal(stood.lines.at(-1), "next: stop");
  assert.equal(pages(installation), 1);
});

/** Answers that anything on this machine could send the page: none carries the state this sign-in sent. */
const forged: readonly string[] = [
  "error=access_denied",
  "error=access_denied&state=",
  "error=access_denied&state=another-sign-ins",
  "code=made-up&state=made-up",
  "code=made-up",
];

test("a denial or a code that does not carry this sign-in's state ends nothing, and the person's own answer then finishes", async () => {
  const { installation, machine } = await installed();
  const statuses: number[] = [];
  const done = await signedIn(installation, machine, async (opened) => {
    for (const query of forged)
      statuses.push((await browsed(`${opened}callback?${query}`)).status);
    assert.match(machine.file("sign-in.json") ?? "", /"note":"Waiting"/u);
    statuses.push((await person(opened)).status);
  });
  assert.deepEqual(statuses, [400, 400, 400, 400, 400, 200]);
  assert.equal(done.code, 0);
  assert.equal(done.lines[0], `site: ${installation.site}, signed in`);
  assert.deepEqual(installation.grants, ["authorization_code granted"]);
  assert.ok(remembered(machine).refreshToken === installation.renewal());
});

test("a denial somebody else sent is not the person's, whose own Deny is the one that ends the sign-in", async () => {
  const { installation, machine } = await installed();
  installation.allows = false;
  const statuses: number[] = [];
  const done = await signedIn(installation, machine, async (opened) => {
    for (const query of forged)
      statuses.push((await browsed(`${opened}callback?${query}`)).status);
    assert.match(machine.file("sign-in.json") ?? "", /"note":"Waiting"/u);
    statuses.push((await person(opened)).status);
  });
  assert.deepEqual(statuses, [400, 400, 400, 400, 400, 400]);
  assert.equal(done.lines[1], "found: the sign-in was declined in the browser");
  assert.equal(done.lines.at(-1), "next: stop");
  assert.deepEqual(installation.grants, []);
});

test("an allow page that hands over no renewal token is not a sign-in, and the person is told what to tick", async () => {
  const { installation, machine } = await installed();
  installation.renewable = false;
  const done = await signedIn(installation, machine);
  assert.equal(done.code, 0);
  assert.equal(
    done.lines[1],
    "found: the sign-in was allowed without leave to stay signed in",
  );
  assert.match(done.lines[2] ?? "", /^tell: .*tick every box/u);
  assert.match(
    done.lines[3] ?? "",
    /^rule: Run node \S+ sign-in only when the person says they are ready to sign in again\.$/u,
  );
  assert.deepEqual(done.lines.slice(4), ["next: stop"]);
  assert.deepEqual(installation.grants, ["authorization_code granted"]);
  assert.equal(remembered(machine).refreshToken, undefined);
});

test("only the path the issuer was given is read as its answer, and the page goes on waiting", async () => {
  const { installation, machine } = await installed();
  const statuses: number[] = [];
  const done = await signedIn(installation, machine, async (opened) => {
    const sent = await browsed(opened);
    const allowed = await browsed(sent.headers.get("location") ?? "");
    const back = new URL(allowed.headers.get("location") ?? "");
    for (const path of ["/callback/", "/auth/callback", "/favicon.ico"])
      statuses.push(
        (await browsed(`${back.origin}${path}${back.search}`)).status,
      );
    statuses.push((await browsed(`${back.origin}/callback`)).status);
    statuses.push((await browsed(back.href)).status);
  });
  assert.deepEqual(statuses, [404, 404, 404, 400, 200]);
  assert.equal(done.lines[0], `site: ${installation.site}, signed in`);
});

test("a person slower than one wait finishes in the same page, and the next sign-in opens no second one", async () => {
  const { installation, machine } = await installed();
  const first = await machine.run([
    "sign-in",
    "--site",
    installation.site,
    "--wait-secs",
    "1",
  ]);
  const address = await machine.opened();
  assert.equal(first.code, 0);
  assert.deepEqual(first.lines.slice(0, 3), [
    `site: ${installation.site}, not signed in`,
    `did: opened ${address} in a browser`,
    "found: nobody finished signing in within 1 s",
  ]);
  assert.match(first.lines.at(-1) ?? "", /^next: node \S+ sign-in$/u);
  const second = machine.run(["sign-in"]);
  assert.equal((await person(address)).status, 200);
  const done = await second;
  assert.equal(done.lines[0], `site: ${installation.site}, signed in`);
  assert.equal(
    installation.asked.filter((line) => line.includes("/oauth2/auth")).length,
    1,
  );
});

test("where the opener cannot be run the address is printed at once, and the page still answers", async () => {
  const { installation, machine } = await installed();
  const handed = await machine.run(["sign-in", "--site", installation.site], {
    BROWSER: `${machine.home}/no-such-opener`,
  });
  assert.equal(handed.code, 0);
  assert.equal(handed.lines[1], "found: no browser could be opened from here");
  const address = /Open (http:\/\/127\.0\.0\.1:\d+\/) in a browser/u.exec(
    handed.lines[2] ?? "",
  )?.[1];
  assert.ok(address !== undefined);
  const waiting = machine.run(["sign-in"]);
  assert.equal((await person(address)).status, 200);
  assert.equal(
    (await waiting).lines[0],
    `site: ${installation.site}, signed in`,
  );
});

test("a page nobody finishes stops answering at its bound, and the next sign-in says so once", async () => {
  const { installation, machine } = await installed();
  await machine.run(["--site", installation.site]);
  const listened = machine.run([
    "listen",
    "--site",
    installation.site,
    "--life-secs",
    "1",
  ]);
  const port = await eventually(() => {
    const text = machine.file("sign-in.json");
    if (text === undefined) return undefined;
    return (JSON.parse(text) as { readonly port?: number }).port;
  });
  const address = `http://127.0.0.1:${String(port)}/`;
  assert.equal((await browsed(address)).status, 302);
  await listened;
  await assert.rejects(browsed(address));
  const said = await machine.run(["sign-in", "--wait-secs", "0"]);
  assert.equal(said.code, 0);
  assert.deepEqual(said.lines.slice(0, 3), [
    `site: ${installation.site}, not signed in`,
    "found: nobody finished the sign-in page before it closed",
    "tell: The sign-in page expired before anyone signed in. Tell me when you are ready and I will open a new one.",
  ]);
  assert.match(
    said.lines[3] ?? "",
    /^rule: Run node \S+ sign-in only when the person says they are ready to sign in\.$/u,
  );
  assert.deepEqual(said.lines.slice(4), ["next: stop"]);
  assert.match(
    machine.file("sign-in.json") ?? "",
    /"ended":"Expired".*"told":true/u,
  );
  const stood = await machine.run([]);
  assert.equal(
    stood.lines[1],
    "found: nobody finished the sign-in page before it closed",
  );
  assert.equal(stood.lines.at(-1), "next: stop");
  assert.deepEqual(installation.grants, []);
});

/** Whether anything takes a connection to `host` on `port`, asked for a bounded time. */
function reached(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port, timeout: 2_000 });
    const answered = (taken: boolean) => () => {
      socket.destroy();
      resolve(taken);
    };
    socket.once("connect", answered(true));
    socket.once("error", answered(false));
    socket.once("timeout", answered(false));
  });
}

/** One `sign-in` that returns at once and leaves its page waiting, answering the address the opener was handed. */
async function waiting(installation: StandIn, machine: Home): Promise<string> {
  const argv = ["sign-in", "--site", installation.site, "--wait-secs", "0"];
  assert.equal((await machine.run(argv)).code, 0);
  return machine.opened();
}

test("the page is reached at this machine's own address, and at no other address the machine has", async () => {
  const { installation, machine } = await installed();
  const port = Number(new URL(await waiting(installation, machine)).port);
  const others = Object.values(networkInterfaces())
    .flatMap((addresses) => addresses ?? [])
    .filter((address) => address.family === "IPv4")
    .map((address) => address.address)
    .filter((address) => address !== "127.0.0.1");
  assert.equal(await reached("127.0.0.1", port), true);
  const hosts = [...new Set(["127.0.0.2", "::1", ...others])];
  const taken = await Promise.all(hosts.map((host) => reached(host, port)));
  assert.deepEqual(
    hosts.filter((_, at) => taken[at] === true),
    [],
  );
});

test("two sign-ins send the issuer a different state and a different proof key", async () => {
  const installation = await made.installation();
  const sent: URLSearchParams[] = [];
  for (const machine of [made.machine(), made.machine()]) {
    const first = await browsed(await waiting(installation, machine));
    sent.push(new URL(first.headers.get("location") ?? "").searchParams);
  }
  for (const name of ["state", "code_challenge"]) {
    const [first, second] = sent.map((query) => query.get(name) ?? "");
    assert.ok((first ?? "").length >= 43, name);
    assert.ok((second ?? "").length >= 43, name);
    assert.ok(first !== second, name);
  }
});

test("an opener that leaves a browser running does not keep the command from returning", async () => {
  const { installation, machine } = await installed();
  const lingerer = join(machine.beside, "lingerer");
  const opener = join(machine.beside, "lingering-opener.sh");
  writeFileSync(
    opener,
    `#!/bin/sh\nsleep 20 &\nprintf '%s' "$!" > "${lingerer}"\n`,
  );
  chmodSync(opener, 0o755);
  const left = (): number => Number(readFileSync(lingerer, "utf8"));
  try {
    const done = await machine.run(
      ["sign-in", "--site", installation.site, "--wait-secs", "0"],
      { BROWSER: opener },
    );
    assert.equal(done.code, 0);
    assert.match(
      done.lines[1] ?? "",
      /^did: opened http:\/\/127\.0\.0\.1:\d+\/ in a browser$/u,
    );
    assert.doesNotThrow(() => process.kill(left(), 0));
  } finally {
    if (existsSync(lingerer)) ended(left());
  }
});

test("a site that refuses the sign-in it remembered is said to have, and a sign-in it then refuses opens no further page", async () => {
  const { installation, machine } = await installed();
  await signedIn(installation, machine);
  installation.admits = false;
  const refused = await machine.run([]);
  assert.equal(refused.code, 1);
  assert.deepEqual(refused.lines.slice(0, -1), [
    `site: ${installation.site}, not signed in`,
    "found: the site refused the remembered sign-in, so it was forgotten",
  ]);
  assert.match(refused.lines.at(-1) ?? "", /^next: node \S+ sign-in$/u);
  assert.equal(remembered(machine).refreshToken, undefined);
  const done = await signedIn(installation, machine, async (opened) => {
    assert.equal((await person(opened)).status, 400);
  });
  assert.equal(done.code, 1);
  assert.deepEqual(done.lines.slice(1, 3), [
    "found: the sign-in went through, but the site refused it, so nothing is remembered",
    "tell: The sign-in went through, but the chuggy site did not accept it, so chuggy setup is not signed in. Tell me if you want to try signing in again.",
  ]);
  assert.equal(done.lines.at(-1), "next: stop");
  assert.equal(remembered(machine).refreshToken, undefined);
  const stood = await machine.run([]);
  assert.deepEqual(stood.lines.slice(1, 3), done.lines.slice(1, 3));
  assert.equal(stood.lines.at(-1), "next: stop");
  assert.equal(pages(installation), 2);
});

test("a page whose site is no longer the one remembered signs nothing in, and what is kept for the other site is left as it was", async () => {
  const first = await made.installation();
  const second = await made.installation();
  const machine = made.machine();
  const address = await waiting(first, machine);
  assert.equal((await machine.run(["--site", second.site])).code, 0);
  const kept = machine.file("session.json");
  assert.equal((await person(address)).status, 400);
  assert.deepEqual(first.grants, []);
  assert.ok(machine.file("session.json") === kept);
  assert.equal(remembered(machine).site, second.site);
});

test("ending a home ends the page a sign-in left waiting under it, and leaves nothing where the home was", async () => {
  const { installation, machine } = await installed();
  const address = await waiting(installation, machine);
  assert.equal((await browsed(address)).status, 302);
  await machine.dispose();
  await assert.rejects(browsed(address));
  assert.equal(existsSync(dirname(machine.home)), false);
});
