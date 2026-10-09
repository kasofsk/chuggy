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
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { browsed, eventually, making, person } from "./program.ts";
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
  assert.equal(machine.file("lock"), undefined);
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

test("a sign-in declined in the browser is said to be, and nothing is exchanged", async () => {
  const { installation, machine } = await installed();
  installation.allows = false;
  const done = await signedIn(installation, machine, async (opened) => {
    assert.equal((await person(opened)).status, 400);
  });
  assert.equal(done.code, 0);
  assert.deepEqual(done.lines.slice(0, 2), [
    `site: ${installation.site}, not signed in`,
    "found: the sign-in was declined in the browser",
  ]);
  assert.match(done.lines.at(-1) ?? "", /^next: node \S+ sign-in$/u);
  assert.deepEqual(installation.grants, []);
  assert.equal(remembered(machine).refreshToken, undefined);
});

test("an answer carrying another sign-in's state is refused before the issuer is asked", async () => {
  const { installation, machine } = await installed();
  const done = await signedIn(installation, machine, async (opened) => {
    const sent = await browsed(opened);
    const allowed = await browsed(sent.headers.get("location") ?? "");
    const back = new URL(allowed.headers.get("location") ?? "");
    back.searchParams.set("state", "another-sign-ins");
    assert.equal((await browsed(back.href)).status, 400);
  });
  assert.equal(
    done.lines[1],
    "found: the answer that came back did not belong to this sign-in",
  );
  assert.deepEqual(installation.grants, []);
  assert.equal(remembered(machine).refreshToken, undefined);
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
  assert.equal(
    said.lines[1],
    "found: nobody finished the sign-in page before it closed",
  );
  assert.match(said.lines.at(-1) ?? "", /^next: node \S+ sign-in$/u);
  assert.equal(machine.file("sign-in.json"), undefined);
  assert.deepEqual(installation.grants, []);
});
