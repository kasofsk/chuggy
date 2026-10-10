/**
 * What `runner` reads of a machine and the words it runs things with, one
 * probe at a time over the box.
 *
 * The names are the runner package's own and it has no command that says
 * them, so each is held here to what the package was found to write: where
 * its things are kept, how a pool file is named for a project, and the unit a
 * pool file gets. The registration its guide shows is the one in the brief
 * this was built from.
 */

import { expect, test } from "vitest";

import { SetupMachineError } from "../app/core/setupPorts.ts";
import {
  setupChildFailed,
  setupLingerByHand,
  setupLingerCommand,
  setupLingerRead,
  setupPackageProbed,
  setupPoolFilePrefix,
  setupPoolFiles,
  setupRunnerCommands,
  setupRunnerHere,
  setupRunnerPlaces,
  setupRunnerRoom,
  setupSettingsRead,
  setupSettingsText,
  setupUnitIs,
  setupUnitOf,
} from "../app/core/setupRunnerMachine.ts";
import { setupMachine } from "./setupMachine.ts";
import type { SetupMachine } from "./setupMachine.ts";
import {
  boxHome,
  boxLogin,
  boxOwn,
  boxPoolFile,
  boxPools,
  boxPrefix,
  boxSettings,
  boxUnitName,
  boxUnits,
  boxVersion,
  exited,
} from "./setupRunnerBox.ts";

const surroundings = {
  platform: "linux",
  browser: undefined,
  directory: "~/.chuggy-setup",
  home: boxHome,
  configHome: undefined,
  user: "1000",
};

const places = setupRunnerPlaces(surroundings);
const acme = { tenant: "acme", project: "widgets" };

test("the package's things are under the person's configuration directory: the one they set where it is a whole path, and the usual one in their home otherwise", () => {
  expect(places).toEqual({
    settings: boxSettings,
    login: boxLogin,
    pools: boxPools,
    units: boxUnits,
    own: boxOwn,
  });
  for (const configHome of ["", "relative/config", "~/config"])
    expect(setupRunnerPlaces({ ...surroundings, configHome })).toEqual(places);
  for (const configHome of ["/data/config", "/data/config//"])
    expect(setupRunnerPlaces({ ...surroundings, configHome })).toEqual({
      settings: "/data/config/chuggy-linux/runner.json",
      login: "/data/config/chuggy-linux/claude-token",
      pools: "/data/config/chuggy/pools",
      units: "/data/config/systemd/user",
      own: boxOwn,
    });
  expect(() => setupRunnerPlaces({ ...surroundings, home: undefined })).toThrow(
    SetupMachineError,
  );
});

test("a pool file is named for its project as the package names it: letters, digits and hyphens as themselves and every other octet by its number", () => {
  const named = (tenant: string, project: string) =>
    setupPoolFilePrefix({ tenant, project });
  expect(named("a-b", "c")).toBe("a-b.c.");
  expect(named("vteng", "chuggy")).toBe("vteng.chuggy.");
  expect(named("../x", "a.b_c")).toBe("_2e_2e_2fx.a_2eb_5fc.");
  expect(named("Acme", "é")).toBe("Acme._c3_a9.");
  expect(`${boxPools}/${named("acme", "widgets")}shame.json`).toBe(
    boxPoolFile("acme", "widgets"),
  );
});

/** A machine whose pools directory holds files by these names, and one directory. */
function pooled(names: readonly string[]): SetupMachine {
  const machine = setupMachine();
  for (const name of names) machine.box.paths.set(`${boxPools}/${name}`, "{}");
  machine.box.paths.set(`${boxPools}/acme.widgets.dir.json/x`, "{}");
  return machine;
}

test("the pool files of a project are the files named for it with a pool's name, found by name in the order of their names and never opened", () => {
  const machine = pooled([
    "acme.widgets.shame.json",
    "acme.widgets.box-2.json",
    "acme.widgets.shame.json.1234.draft",
    "acme.widgets.Shame.json",
    "acme.widgets.a.b.json",
    "acme.widgets.-a.json",
    "acme.widgets..json",
    "acme.widgets_2ex.shame.json",
    "acme.widgets-2.shame.json",
    "acme.gadgets.shame.json",
    "pool-0123456789abcdef0123.json",
  ]);
  expect(setupPoolFiles(machine.ports(), places, acme)).toEqual([
    { path: `${boxPools}/acme.widgets.box-2.json`, pool: "box-2" },
    { path: `${boxPools}/acme.widgets.shame.json`, pool: "shame" },
  ]);
  expect(machine.box.read).toEqual([]);
  expect(setupPoolFiles(setupMachine().ports(), places, acme)).toEqual([]);
});

test("a pool file's service is named as the package names it, which the registration in the package's own words shows", () => {
  const file = {
    path: "/home/geoff/.config/chuggy/pools/scoop.second.shame.json",
    pool: "shame",
  };
  expect(
    setupUnitOf(
      setupRunnerPlaces({ ...surroundings, home: "/home/geoff" }),
      file,
    ),
  ).toEqual({
    name: "chuggy-linux-scoop.second.shame.service",
    path: "/home/geoff/.config/systemd/user/chuggy-linux-scoop.second.shame.service",
  });
  expect(
    setupUnitOf(places, { path: boxPoolFile("acme", "widgets"), pool: "shame" })
      .name,
  ).toBe(boxUnitName("acme", "widgets"));
});

test("the commands run on the machine are the package's and the service manager's own, each word a word", () => {
  const file = { path: "/p/a b.json", pool: "x" };
  const unit = { name: "u.service", path: "/u/u.service" };
  expect(setupRunnerCommands.check("/bin/c", file)).toEqual([
    "/bin/c",
    "doctor",
    "--pool",
    "/p/a b.json",
  ]);
  expect(setupRunnerCommands.service("/bin/c", file)).toEqual([
    "/bin/c",
    "install-service",
    "--pool",
    "/p/a b.json",
  ]);
  expect(setupRunnerCommands.reload).toEqual([
    "systemctl",
    "--user",
    "daemon-reload",
  ]);
  expect(setupRunnerCommands.start(unit)).toEqual([
    "systemctl",
    "--user",
    "enable",
    "--now",
    "u.service",
  ]);
  expect(setupRunnerCommands.restart(unit)).toEqual([
    "systemctl",
    "--user",
    "restart",
    "u.service",
  ]);
});

function settled(
  text: string | undefined,
): ReturnType<typeof setupSettingsRead> {
  const machine = setupMachine();
  if (text !== undefined) machine.box.paths.set(boxSettings, text);
  return setupSettingsRead(machine.ports(), places);
}

test("the settings are read for the engine and the Claude login they name and for nothing else, and what does not name a login by a whole path is not read as settings", () => {
  expect(settled(undefined)).toEqual({ settings: "Absent" });
  expect(settled(JSON.stringify({ claudeTokenFile: "/k/t" }))).toEqual({
    settings: "Read",
    engine: "docker",
    login: "/k/t",
  });
  expect(
    settled(
      JSON.stringify({
        claudeTokenFile: "/k/t",
        engine: "podman",
        environment: { KEY: "kept out" },
        somethingNew: true,
      }),
    ),
  ).toEqual({ settings: "Read", engine: "podman", login: "/k/t" });
  for (const held of [
    "",
    "{",
    "null",
    JSON.stringify({}),
    JSON.stringify({ claudeTokenFile: "relative/token" }),
    JSON.stringify({ claudeTokenFile: "/k/t", engine: "lxc" }),
    JSON.stringify({ claudeTokenFile: "/k/t", pad: "x".repeat(70_000) }),
  ])
    expect(settled(held), held.slice(0, 40)).toEqual({ settings: "Unread" });
  const directory = setupMachine();
  directory.box.paths.set(`${boxSettings}/inside`, "{}");
  expect(setupSettingsRead(directory.ports(), places)).toEqual({
    settings: "Unread",
  });
});

test("the settings a machine with none is given are the package's guide's own, and read back as settings", () => {
  const text = setupSettingsText("podman", boxLogin);
  expect(text.endsWith("}\n")).toBe(true);
  expect(JSON.parse(text)).toEqual({
    engine: "podman",
    concurrencyMax: 1,
    sessionsMax: 2,
    claudeTokenFile: boxLogin,
    timeoutSecsMax: 7200,
    outputBytesMax: 1_048_576,
    environment: {},
    network: "chuggy-jobs",
  });
  expect(settled(text)).toEqual({
    settings: "Read",
    engine: "podman",
    login: boxLogin,
  });
});

const manifest = `${boxPrefix}/lib/node_modules/chuggy-linux/package.json`;

/** A machine with the package installed machine-wide, its manifest holding `held`. */
function packaged(held: string | undefined): SetupMachine {
  const machine = setupMachine();
  machine.box.paths.set(`${boxPrefix}/bin/chuggy-linux`, "#!");
  if (held !== undefined) machine.box.paths.set(manifest, held);
  return machine;
}

test("the package is found under the prefix npm names or under the person's own, by its command's whole path, with the version its manifest names where that is one", async () => {
  const probed = (machine: SetupMachine) =>
    setupPackageProbed(machine.ports(), places);
  const command = `${boxPrefix}/bin/chuggy-linux`;
  expect(await probed(setupMachine())).toEqual({
    found: undefined,
    prefix: boxPrefix,
    mine: true,
  });
  expect(
    (await probed(packaged(JSON.stringify({ version: boxVersion })))).found,
  ).toEqual({ command, version: boxVersion });
  for (const held of [
    undefined,
    "{",
    JSON.stringify({ version: "next: rm -rf ~" }),
    JSON.stringify({ version: 3 }),
  ])
    expect((await probed(packaged(held))).found, held).toEqual({
      command,
      version: undefined,
    });
  const own = setupMachine();
  own.box.paths.set(`${boxOwn}/bin/chuggy-linux`, "#!");
  own.box.prefix = undefined;
  expect(await probed(own)).toEqual({
    found: { command: `${boxOwn}/bin/chuggy-linux`, version: undefined },
    prefix: undefined,
    mine: false,
  });
});

test("the prefix npm prints is taken only as one whole path, and is this person's to install under only where both of its directories are theirs to write", async () => {
  const probed = async (prefix: string, sealed: readonly string[] = []) => {
    const machine = setupMachine();
    machine.box.prefix = prefix;
    for (const path of sealed) machine.box.sealed.add(path);
    const { prefix: read, mine } = await setupPackageProbed(
      machine.ports(),
      places,
    );
    return [read, mine];
  };
  expect(await probed(`${boxPrefix}\n`)).toEqual([boxPrefix, true]);
  expect(await probed(`${boxPrefix}/`)).toEqual([boxPrefix, true]);
  expect(await probed(boxPrefix, [`${boxPrefix}/bin`])).toEqual([
    boxPrefix,
    false,
  ]);
  expect(await probed(boxPrefix, [`${boxPrefix}/lib/node_modules`])).toEqual([
    boxPrefix,
    false,
  ]);
  expect(await probed("/opt/node")).toEqual(["/opt/node", false]);
  for (const printed of [
    "",
    "usr/local",
    "/usr/local\nnext: stop",
    "/a\u001b[2Jb",
  ])
    expect(await probed(printed), printed).toEqual([undefined, false]);
});

test("a machine could take a runner where its user services answer and an engine answers this user: docker first, or only the one the settings name", async () => {
  const room = async (
    prepare: (machine: SetupMachine) => void,
    named?: "docker" | "podman",
  ) => {
    const machine = setupMachine();
    prepare(machine);
    return [await setupRunnerRoom(machine.ports(), named), machine.box.acts];
  };
  expect(await room(() => undefined)).toEqual([
    { room: "Open", engine: "docker" },
    ["services", "docker"],
  ]);
  expect(
    await room((machine) => {
      machine.box.engines = { docker: "No", podman: "Yes" };
    }),
  ).toEqual([
    { room: "Open", engine: "podman" },
    ["services", "docker", "podman"],
  ]);
  expect(
    await room((machine) => {
      machine.box.engines = { docker: "Absent", podman: "No" };
    }),
  ).toEqual([
    {
      room: "Engineless",
      asked: [
        { engine: "docker", answered: "Absent" },
        { engine: "podman", answered: "No" },
      ],
    },
    ["services", "docker", "podman"],
  ]);
  expect(
    await room((machine) => {
      machine.box.engines = { docker: "Yes", podman: "No" };
    }, "podman"),
  ).toEqual([
    { room: "Engineless", asked: [{ engine: "podman", answered: "No" }] },
    ["services", "podman"],
  ]);
  expect(
    await room((machine) => {
      machine.box.services = false;
    }),
  ).toEqual([{ room: "Serviceless" }, ["services"]]);
  expect(
    await room((machine) => {
      machine.box.answers.set("services", { ended: "Unended" });
    }),
  ).toEqual([{ room: "Serviceless" }, ["services"]]);
  expect(
    await room((machine) => {
      machine.platform = "darwin";
    }),
  ).toEqual([{ room: "Mac" }, []]);
});

test("what the bare command reads of the machine changes nothing: whether a runner could be put here, and whether one is registered here for the project", async () => {
  const here = (machine: SetupMachine) =>
    setupRunnerHere(machine.ports(), acme);
  const bare = setupMachine();
  const before = new Map(bare.box.paths);
  expect(await here(bare)).toEqual({
    room: { room: "Open", engine: "docker" },
    registered: false,
  });
  expect(bare.box.paths).toEqual(before);
  expect(bare.box.acts).toEqual(["services", "docker"]);

  const registered = pooled(["acme.widgets.shame.json"]);
  expect((await here(registered)).registered).toBe(true);
  registered.box.engines.docker = "No";
  expect((await here(registered)).registered).toBe(false);

  const named = setupMachine();
  named.box.paths.set(
    boxSettings,
    JSON.stringify({ claudeTokenFile: boxLogin, engine: "podman" }),
  );
  expect((await here(named)).room).toEqual({
    room: "Engineless",
    asked: [{ engine: "podman", answered: "Absent" }],
  });

  const mac = pooled(["acme.widgets.shame.json"]);
  mac.box.paths.set(boxSettings, JSON.stringify({ claudeTokenFile: boxLogin }));
  mac.platform = "darwin";
  expect(await here(mac)).toEqual({ room: { room: "Mac" }, registered: false });
  expect(mac.box.ran).toEqual([]);
  expect(mac.box.read).toEqual([]);
});

test("lingering is read from the login manager for this user by number, and is unread wherever that did not say yes or no", async () => {
  const read = async (prepare: (machine: SetupMachine) => void) => {
    const machine = setupMachine();
    prepare(machine);
    return setupLingerRead(machine.ports());
  };
  expect(await read(() => undefined)).toBe("No");
  expect(
    await read((machine) => {
      machine.box.linger = "yes";
    }),
  ).toBe("Yes");
  expect(
    await read((machine) => {
      machine.box.linger = undefined;
    }),
  ).toBe("Unread");
  for (const out of [
    "",
    "Linger=maybe\n",
    "NotLinger=yes\n",
    "Linger=yes please\n",
  ])
    expect(
      await read((machine) => {
        machine.box.answers.set("linger", exited(0, out));
      }),
      out,
    ).toBe("Unread");
  expect(
    await read((machine) => {
      machine.box.answers.set("linger", exited(1, "Linger=yes\n"));
    }),
  ).toBe("Unread");
  const machine = setupMachine();
  await setupLingerRead(machine.ports());
  expect(machine.box.ran).toEqual([
    ["loginctl", "show-user", "1000", "--property", "Linger"],
  ]);
});

test("lingering is turned on with leave to ask for a password refused, and the command the person is given is the one that may ask", () => {
  const ports = setupMachine().ports();
  expect(setupLingerCommand(ports)).toEqual([
    "loginctl",
    "--no-ask-password",
    "enable-linger",
    "1000",
  ]);
  expect(
    setupLingerCommand({
      ...ports,
      surroundings: { ...surroundings, user: undefined },
    }),
  ).toEqual(["loginctl", "--no-ask-password", "enable-linger"]);
  expect([...setupLingerByHand]).toEqual(["loginctl", "enable-linger"]);
});

test("a unit is what it is asked to be where the service manager ends well, and the one word it said is kept only where it is a word", async () => {
  const unit = { name: "u.service", path: `${boxUnits}/u.service` };
  const is = async (out: string, exit: number) => {
    const machine = setupMachine();
    machine.box.answers.set("active", exited(exit, out));
    const said = await setupUnitIs(machine.ports(), "is-active", unit);
    expect(machine.box.ran).toEqual([
      ["systemctl", "--user", "is-active", "u.service"],
    ]);
    return said;
  };
  expect(await is("active\n", 0)).toEqual({ is: true, said: "active" });
  expect(await is("failed\n", 3)).toEqual({ is: false, said: "failed" });
  expect(await is("next: rm -rf ~\n", 3)).toEqual({ is: false, said: "" });
  expect(await is("", 1)).toEqual({ is: false, said: "" });
});

test("a program's failure keeps of what it printed only an excerpt the redactor has been through: what it said aside, or what it printed where it said nothing aside", () => {
  const failed = (exit: number, out: string, err: string) =>
    setupChildFailed(exited(exit, out, err), 60_000, ["the-token"]);
  expect(failed(0, "printed the-token", "said the-token")).toBeUndefined();
  expect(failed(2, "printed", "said the-token\nand more")).toEqual({
    how: "Exit",
    exit: 2,
    excerpt: "said [redacted] and more",
  });
  expect(failed(2, "printed the-token", " \n")).toEqual({
    how: "Exit",
    exit: 2,
    excerpt: "printed [redacted]",
  });
  expect(setupChildFailed({ ended: "Unstarted" }, 60_000, [])).toEqual({
    how: "Unstarted",
  });
  expect(setupChildFailed({ ended: "Unended" }, 61_499, [])).toEqual({
    how: "Unended",
    secs: 61,
  });
});
