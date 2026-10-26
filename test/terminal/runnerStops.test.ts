/**
 * `runner` where it stops, run as `test/terminal/runner.test.ts` runs it: on a
 * machine or for a user it sets nothing up for, and at a step that fails
 * part-way.
 *
 * The token a failing registration says back is in nothing the program
 * writes, whole or in pieces; a secret the runner's own check says is struck
 * out; and no password is taken. Every run takes itself for the user the
 * runner package takes docker from unless its case says another, whoever the
 * suite runs as. The last case is the control: everything every run here wrote
 * is searched for everything the stand-ins handed out and for the runner's
 * Claude login.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { test } from "node:test";

import { runnerPackageOffered } from "../../ui/chuggy-ui/app/core/runners.ts";

import { machineLoginSecret } from "./machine.ts";
import { platformSaid, program, userSaid } from "./program.ts";
import {
  type Stood,
  acts,
  again,
  cleared,
  first,
  flags,
  lines,
  mint,
  next,
  probes,
  ran,
  redemption,
  rerun,
  runner,
  stood,
  stoodAll,
  stoodSearched,
  unasked,
  user,
  words,
} from "./runnerStood.ts";

/** A user the runner package bars from docker, by number, for the cases that say so. */
const other = "1001";

test("with no Claude login the run changes nothing and says what the runner needs: the login claude setup-token makes, saved alone and readable only by the person, or another kind its guide names, and the run its rule names once it is there finishes the job", async () => {
  const on = await stood("Pool");
  rmSync(on.machine.login);
  await unchanged(on, "found: the runner has no Claude login on this machine");
  const missing = await ran(on);
  assert.deepEqual(missing.lines.slice(-3), [
    `tell: The runner needs a Claude login of its own on this machine, and there is none at ${on.machine.login}, so nothing was changed on this machine. It is the login the command claude setup-token makes, which needs a Claude plan that allows it, saved alone in ${on.machine.login} and readable only by you (mode 600). An Anthropic API key or a cloud provider's credential can be used instead; the runner's guide says how: ${runnerPackageOffered.guideAddress}. Tell me once one is there.`,
    `${again}once the person says the runner's Claude login is on this machine.`,
    "next: stop",
  ]);
  writeFileSync(on.machine.login, machineLoginSecret, { mode: 0o600 });
  cleared(on);
  const done = await ran(on);
  assert.equal(done.code, 0, done.stdout);
  assert.deepEqual(done.lines.slice(-2), [lines(on).found.ownLive, next]);
});

const changing = new Set(first.filter((act) => !probes.includes(act)));

/** What the runner's settings hold, or nothing where there are none. */
function settings(on: Stood): string | undefined {
  return existsSync(on.machine.settings)
    ? readFileSync(on.machine.settings, "utf8")
    : undefined;
}

/** One run that stopped short of changing anything: it says what it found, names `runner` to be run again, and has installed nothing, written nothing and sent nothing but reads. */
async function unchanged(on: Stood, found: string, as = user): Promise<void> {
  const before = settings(on);
  const done = await ran(on, runner, { [userSaid]: as });
  assert.equal(done.code, 0, done.stdout);
  assert.equal(done.lines.at(-1), "next: stop", done.stdout);
  assert.ok(
    done.lines.some((line) => line.startsWith(found)),
    done.stdout,
  );
  assert.ok(
    done.lines.some((line) => line.startsWith(again)),
    done.stdout,
  );
  assert.deepEqual(
    acts(on).filter((act) => changing.has(act)),
    [],
  );
  assert.deepEqual(on.installation.writes, []);
  assert.equal(settings(on), before, found);
  assert.ok(!existsSync(on.machine.pools), found);
  assert.ok(!/sk-ant|OAUTH/u.test(done.stdout), done.stdout);
}

test("a machine that could not take a runner, or lacks what this program cannot make, stops the run with nothing installed, nothing written and nothing sent but reads", async () => {
  const lacks: readonly (readonly [(on: Stood) => void, string])[] = [
    [
      (on) => {
        on.machine.tell({ engines: { docker: false } });
      },
      "found: docker did not answer you without a password; podman is not installed",
    ],
    [
      (on) => {
        on.machine.tell({ services: false });
      },
      "found: this machine's user services did not answer systemctl --user",
    ],
    [
      (on) => {
        rmSync(on.machine.login);
      },
      "found: the runner has no Claude login on this machine: nothing is at ",
    ],
    [
      (on) => {
        on.machine.has("npm", false);
      },
      "found: the runner package is not installed at a version chuggy setup can use, and npm did not answer",
    ],
  ];
  for (const [lack, found] of lacks) {
    const on = await stood();
    lack(on);
    await unchanged(on, found);
    assert.equal(settings(on), undefined, found);
  }
});

test("a user the runner package bars from docker is stopped before anything is changed where podman is not there, where it does not answer them, and where the settings set the runner to use docker, and docker is never run", async () => {
  const bars: readonly (readonly [(on: Stood) => void, string])[] = [
    [
      () => undefined,
      "found: podman is not installed, and docker was not asked: the runner package takes docker only from this machine's user 1000",
    ],
    [
      (on) => {
        on.machine.has("podman");
        on.machine.tell({ engines: { docker: true, podman: false } });
      },
      "found: podman did not answer you without a password, and docker was not asked: ",
    ],
    [
      (on) => {
        on.machine.has("podman");
        writeFileSync(
          on.machine.settings,
          JSON.stringify({ claudeTokenFile: on.machine.login }),
        );
      },
      "found: the runner is set to use docker, in ",
    ],
  ];
  for (const [bar, found] of bars) {
    const on = await stood();
    bar(on);
    await unchanged(on, found, other);
    assert.deepEqual(words(on, "docker"), [], found);
    unasked(on);
  }
});

test("a user the runner package bars from docker is asked podman alone, and where it answers them the runner is set up on it: podman is what the settings name, and docker is never run", async () => {
  const on = await stood();
  on.machine.has("podman");
  const as = { [userSaid]: other };
  const { found, did } = lines(on, "podman");
  const offered = await ran(on, [], as);
  assert.equal(offered.lines.at(-1), "next: stop");
  assert.deepEqual(acts(on), ["services", "podman"]);
  const done = await ran(on, runner, as);
  assert.equal(done.code, 0, done.stdout);
  assert.deepEqual(done.lines.slice(1, 5), [
    found.engine,
    found.login,
    did.package,
    did.settings,
  ]);
  assert.deepEqual(done.lines.slice(-2), [found.live, next]);
  assert.deepEqual(words(on, "docker"), []);
  const settings = JSON.parse(
    readFileSync(on.machine.settings, "utf8"),
  ) as Record<string, unknown>;
  assert.equal(settings["engine"], "podman");
  assert.deepEqual(words(on, "loginctl")[0], [
    "show-user",
    other,
    "--property",
    "Linger",
  ]);
  unasked(on);

  cleared(on);
  const second = await ran(on, runner, as);
  assert.deepEqual(second.lines.slice(-2), [found.live, next]);
  assert.deepEqual(acts(on), ["services", "podman", ...rerun.slice(2)]);
});

/** As long a stretch of a registration token as is in no other word a run prints. */
const stretch = 16;

/** Whether any stretch of a secret is in a text, which is the secret said whole or in pieces. */
function pieced(text: string, secret: string): boolean {
  return Array.from({ length: secret.length - stretch + 1 }, (_, at) =>
    secret.slice(at, at + stretch),
  ).some((piece) => text.includes(piece));
}

test("a registration that fails saying its own arguments back, whole and in halves, has nothing it printed said of it: the package's own refusal is told in this program's words with no piece of the token, and the token it lost is left unredeemed while the next run mints another and finishes", async () => {
  const on = await stood();
  on.machine.tell({
    fails: {
      register: {
        exit: 1,
        aside: `chuggy at ${on.installation.site} did not answer the registration: fetch failed`,
        echoes: true,
      },
    },
  });
  const failed = await ran(on);
  assert.equal(failed.code, 1, failed.stdout);
  const [lost = ""] = on.installation.world.secrets;
  assert.ok(
    words(on, "chuggy-linux")[0]?.includes(`--token=${lost}`),
    "the child was given the token, and said it back",
  );
  assert.ok(lost.length > stretch && !pieced(failed.stdout, lost));
  assert.ok(pieced(`said ${lost.slice(0, stretch)} back`, lost));
  assert.ok(!failed.stdout.includes("fetch failed"), failed.stdout);
  assert.ok(
    failed.lines.includes(
      "found: registering this machine ended with exit 1: the site did not answer the runner package",
    ),
    failed.stdout,
  );
  assert.equal(failed.lines.at(-1), "next: stop");
  assert.ok(failed.lines.at(-2)?.startsWith(again), failed.stdout);
  assert.deepEqual(on.installation.writes, [mint]);

  on.machine.tell({ fails: {} });
  cleared(on);
  const done = await ran(on);
  assert.equal(done.code, 0, done.stdout);
  assert.deepEqual(on.installation.writes, [mint, redemption]);
  assert.equal(on.installation.world.mints.length, 2);
  assert.deepEqual(on.installation.world.projects[0]?.tokens, [lost]);
  assert.equal(done.lines.at(-1), next);
});

test("the runner's own check failing with a secret in what it says is told with the secret struck out, and nothing is started", async () => {
  const on = await stood();
  on.machine.tell({
    doctor: {
      exit: 1,
      aside: `FAIL  Claude credential: ${machineLoginSecret} is no login\n`,
    },
  });
  const failed = await ran(on);
  assert.equal(failed.code, 1, failed.stdout);
  assert.ok(
    failed.lines.includes(
      "found: the runner's Claude credential is not as it needs it; the runner's own check said: FAIL Claude credential: [redacted] is no login",
    ),
    failed.stdout,
  );
  assert.equal(acts(on).at(-1), "doctor");
});

test("where keeping services running after a logout wants a password, none is taken: the person is told the command to run themselves, and the run after they have finishes", async () => {
  const on = await stood();
  on.machine.tell({ lingerAsks: true });
  const asked = await ran(on);
  assert.equal(asked.code, 0, asked.stdout);
  assert.equal(asked.lines.at(-1), "next: stop");
  assert.ok(asked.lines.at(-2)?.startsWith(again), asked.stdout);
  assert.match(
    asked.lines.at(-3) ?? "",
    /^tell: .* In a terminal of your own, run loginctl enable-linger and tell me once you have\.$/u,
  );
  assert.deepEqual(words(on, "loginctl"), [
    ["show-user", user, "--property", "Linger"],
    ["--no-ask-password", "enable-linger", user],
  ]);
  assert.ok(!acts(on).includes("start"));
  unasked(on);

  on.machine.keep({ ...on.machine.state(), linger: true });
  cleared(on);
  const done = await ran(on);
  assert.equal(done.code, 0, done.stdout);
  assert.ok(done.lines.includes(lines(on).found.linger), done.stdout);
  assert.deepEqual(done.lines.slice(-2), [lines(on).found.live, next]);
  assert.deepEqual(on.installation.writes, []);
});

test("a runner that is started and that the site does not see live within the wait is a failure that says how long was waited, having asked the service manager once more whether it still runs, and the run after it is seen ends on the checklist", async () => {
  const on = await stood();
  on.machine.tell({ polls: false });
  const waited = await ran(on, [...runner, "--wait-secs", "2"]);
  assert.equal(waited.code, 1, waited.stdout);
  assert.ok(
    waited.lines.includes(
      "found: the runner's service is running, and after 2 s the site still sees no runner of acme/widgets live",
    ),
    waited.stdout,
  );
  assert.equal(waited.lines.at(-1), "next: stop");
  assert.ok(waited.lines.at(-2)?.startsWith(again), waited.stdout);
  assert.deepEqual(acts(on).slice(-3), ["start", "active", "active"]);

  on.machine.tell({ polls: true });
  cleared(on);
  const done = await ran(on);
  assert.deepEqual(done.lines.slice(-3), [
    lines(on).found.running,
    lines(on).found.live,
    next,
  ]);
  assert.deepEqual(on.installation.writes, []);
});

test("on a Mac runner says it cannot set one up and asks nothing of the machine or the site, and the bare command says the same of the runner's step and offers nothing", async () => {
  const on = await stood();
  const mac = { [platformSaid]: "darwin" };
  const done = await ran(on, runner, mac);
  assert.equal(done.code, 2, done.stdout);
  assert.equal(
    done.lines[0],
    "found: this machine is a Mac, and chuggy setup puts a runner only on Linux",
  );
  assert.deepEqual(done.lines.slice(-2), [
    `rule: Run node ${program} ${flags} only once the person says a runner is running.`,
    "next: stop",
  ]);
  assert.deepEqual(on.machine.calls(), []);
  assert.deepEqual(on.installation.asked, []);

  const bare = await ran(on, [], mac);
  assert.equal(bare.code, 0, bare.stdout);
  assert.match(
    bare.lines.at(-3) ?? "",
    /^tell: .* This machine is a Mac and chuggy setup puts a runner only on Linux, but a Mac runs one with chuggy-darwin, added by hand: /u,
  );
  assert.ok(!bare.stdout.includes(" runner --workspace"), bare.stdout);
  assert.deepEqual(acts(on), []);
  assert.deepEqual(on.installation.writes, []);
});

test("across every run of this suite, nothing the site or the issuer handed out and nothing of the runner's Claude login is in anything the program wrote", () => {
  stoodSearched();
  assert.ok(
    stoodAll.some((on) => on.home.written.join("\n").includes("[redacted]")),
  );
});
