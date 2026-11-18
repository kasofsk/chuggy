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

import { runnerPackages } from "../app/core/runners.ts";
import { SetupMachineError } from "../app/core/setupPorts.ts";
import type { SetupChildEnded } from "../app/core/setupPorts.ts";
import {
  setupAgentDomain,
  setupAgentIs,
  setupChatFiles,
  setupChatPackageLeast,
  setupChatSized,
  setupChildFailed,
  setupEngineInUseRead,
  setupLingerByHand,
  setupLingerCommand,
  setupLingerRead,
  setupPackageLeast,
  setupPackageProbed,
  setupPoolFilePrefix,
  setupPoolFiles,
  setupRegisterFailed,
  setupRestartAll,
  setupRunnerCommands,
  setupRunnerHere,
  setupRunnerPlaces,
  setupRunnerRoom,
  setupSettingsRead,
  setupSettingsText,
  setupUnitIs,
  setupUnitShown,
  setupUnitOf,
} from "../app/core/setupRunnerMachine.ts";
import type { SetupSettingsNamed } from "../app/core/setupRunnerMachine.ts";
import type { SetupEngine } from "../app/core/setupRunnerSaid.ts";
import { setupMachine } from "./setupMachine.ts";
import type { SetupMachine } from "./setupMachine.ts";
import {
  boxAgentLabel,
  boxAgents,
  boxHome,
  boxApiKey,
  boxLogin,
  boxMacLogin,
  boxMacSettings,
  boxNamePart,
  boxChatFile,
  boxChatUnitName,
  boxOwn,
  boxPersonalFile,
  boxPoolFile,
  boxPools,
  boxPrefix,
  boxSettings,
  boxUnitName,
  boxUnits,
  boxVersion,
  exited,
} from "./setupRunnerBox.ts";
import { setupSiteMember } from "./setupSite.ts";

const surroundings = {
  platform: "linux",
  browser: undefined,
  directory: "~/.config/chuggy/sign-ins",
  folder: `${boxHome}/work`,
  home: boxHome,
  configHome: undefined,
  claudeHome: undefined,
  colimaHome: undefined,
  user: "1000",
};

const places = setupRunnerPlaces(surroundings);
const mac = { ...surroundings, platform: "darwin" };
const acme = { tenant: "acme", project: "widgets" };

test("the package's things are under the person's configuration directory: the one they set where it is a whole path, and the usual one in their home otherwise", () => {
  expect(places).toEqual({
    settings: boxSettings,
    login: boxLogin,
    apiKey: boxApiKey,
    pools: boxPools,
    units: boxUnits,
    own: boxOwn,
  });
  for (const configHome of ["", "relative/config", "~/config"])
    expect(setupRunnerPlaces({ ...surroundings, configHome })).toEqual(places);
  for (const configHome of ["/data/config", "/data/config//"])
    expect(setupRunnerPlaces({ ...surroundings, configHome })).toEqual({
      settings: "/data/config/chuggy-linux/runner.json",
      login: "/data/config/chuggy-linux/claude/token",
      apiKey: "/data/config/chuggy-linux/claude/api-key",
      pools: "/data/config/chuggy/pools",
      units: "/data/config/systemd/user",
      own: boxOwn,
    });
  expect(() => setupRunnerPlaces({ ...surroundings, home: undefined })).toThrow(
    SetupMachineError,
  );
});

test("on a Mac the package's settings and login are in its Application Support, its agents in LaunchAgents, and its pools in the usual configuration directory whatever the person set", () => {
  const darwin = {
    settings: boxMacSettings,
    login: boxMacLogin,
    apiKey: boxMacLogin.replace(/token$/u, "api-key"),
    pools: boxPools,
    units: boxAgents,
    own: boxOwn,
  };
  expect(setupRunnerPlaces(mac)).toEqual(darwin);
  expect(setupRunnerPlaces({ ...mac, configHome: "/data/config" })).toEqual(
    darwin,
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
    "acme.widgets.shame.bak",
    "acme.widgets.shamejson",
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
      "linux",
      setupRunnerPlaces({ ...surroundings, home: "/home/geoff" }),
      file,
    ),
  ).toEqual({
    name: "chuggy-linux-scoop.second.shame.service",
    path: "/home/geoff/.config/systemd/user/chuggy-linux-scoop.second.shame.service",
  });
  expect(
    setupUnitOf("linux", places, { path: boxPoolFile("acme", "widgets") }).name,
  ).toBe(boxUnitName("acme", "widgets"));
  expect(
    setupUnitOf("linux", places, { path: boxChatFile("acme", setupSiteMember) })
      .name,
  ).toBe(boxChatUnitName("acme", setupSiteMember));
  expect(
    setupUnitOf("darwin", setupRunnerPlaces(mac), {
      path: boxPoolFile("acme", "widgets"),
    }),
  ).toEqual({
    name: boxAgentLabel(boxPoolFile("acme", "widgets")),
    path: `${boxAgents}/${boxAgentLabel(boxPoolFile("acme", "widgets"))}.plist`,
  });
});

test("the files of the person's chat host in a workspace are the files named for it, one whole part and then chat.host, beside the pool files, found by name and never opened", () => {
  const member = boxNamePart(setupSiteMember);
  const machine = pooled([
    `acme.${member}.chat.host.json`,
    `acme.${member}.json`,
    "acme.widgets.shame.json",
    "acme.a_2eb.chat.host.json",
    "acme.a.b.chat.host.json",
    "acme..chat.host.json",
    `acme.${member}.chat.host.json.1234.draft`,
    `globex.${member}.chat.host.json`,
    `acme_2ex.${member}.chat.host.json`,
  ]);
  expect(setupChatFiles(machine.ports(), places, "acme")).toEqual([
    { path: `${boxPools}/acme.${member}.chat.host.json` },
    { path: `${boxPools}/acme.a_2eb.chat.host.json` },
  ]);
  expect(machine.box.read).toEqual([]);
  expect(setupChatFiles(setupMachine().ports(), places, "acme")).toEqual([]);
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
  expect(setupRunnerCommands.service("linux", "/bin/c", file)).toEqual([
    "/bin/c",
    "install-service",
    "--pool",
    "/p/a b.json",
  ]);
  expect(setupRunnerCommands.service("darwin", "/bin/c", file)).toEqual([
    "/bin/c",
    "install-agent",
    "--pool",
    "/p/a b.json",
  ]);
  const agent = { name: "chuggy-darwin.x", path: "/a/chuggy-darwin.x.plist" };
  expect([
    setupRunnerCommands.unload("gui/501", agent),
    setupRunnerCommands.load("gui/501", agent),
    setupRunnerCommands.kick("gui/501", agent),
  ]).toEqual([
    ["launchctl", "bootout", "gui/501/chuggy-darwin.x"],
    ["launchctl", "bootstrap", "gui/501", "/a/chuggy-darwin.x.plist"],
    ["launchctl", "kickstart", "-k", "gui/501/chuggy-darwin.x"],
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
    chat: {},
    path: boxSettings,
    engine: "docker",
    credential: { kind: "Subscription", path: "/k/t" },
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
  ).toEqual({
    settings: "Read",
    chat: {},
    path: boxSettings,
    engine: "podman",
    credential: { kind: "Subscription", path: "/k/t" },
  });
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

test("a credential the settings name is read as its kind and its one file, of any kind, and of Bedrock as an API key or a credentials file's profile", () => {
  for (const [claudeCredential, credential] of [
    [
      { kind: "Subscription", tokenFile: "/k/t" },
      { kind: "Subscription", path: "/k/t" },
    ],
    [
      { kind: "ApiKey", apiKeyFile: "/k/a" },
      { kind: "ApiKey", path: "/k/a" },
    ],
    [
      { kind: "Bedrock", region: "us-west-2", apiKeyFile: "/k/b" },
      { kind: "Bedrock", path: "/k/b", profile: undefined },
    ],
    [
      {
        kind: "Bedrock",
        region: "us-west-2",
        credentialsFile: "/k/aws",
        profile: "chuggy",
      },
      { kind: "Bedrock", path: "/k/aws", profile: "chuggy" },
    ],
    [
      { kind: "Bedrock", region: "us-west-2", credentialsFile: "/k/aws" },
      { kind: "Bedrock", path: "/k/aws", profile: "default" },
    ],
    [
      {
        kind: "Vertex",
        region: "us-east5",
        project: "p",
        credentialsFile: "/k/g.json",
      },
      { kind: "Vertex", path: "/k/g.json" },
    ],
    [
      { kind: "Foundry", resource: "r", apiKeyFile: "/k/f" },
      { kind: "Foundry", path: "/k/f" },
    ],
  ] as const)
    expect(
      settled(JSON.stringify({ claudeCredential })),
      claudeCredential.kind,
    ).toEqual({
      settings: "Read",
      chat: {},
      path: boxSettings,
      engine: "docker",
      credential,
    });
});

test("settings naming a credential beside a login, or one missing or doubling its file, or naming a profile beside a Bedrock API key, are not read as settings", () => {
  for (const held of [
    JSON.stringify({
      claudeTokenFile: "/k/t",
      claudeCredential: { kind: "ApiKey", apiKeyFile: "/k/a" },
    }),
    JSON.stringify({ claudeCredential: { kind: "ApiKey" } }),
    JSON.stringify({
      claudeCredential: { kind: "ApiKey", apiKeyFile: "relative/key" },
    }),
    JSON.stringify({ claudeCredential: { kind: "Login", tokenFile: "/k/t" } }),
    JSON.stringify({ claudeCredential: { kind: "Bedrock", region: "r" } }),
    JSON.stringify({
      claudeCredential: {
        kind: "Bedrock",
        region: "r",
        apiKeyFile: "/k/b",
        credentialsFile: "/k/aws",
      },
    }),
    JSON.stringify({
      claudeCredential: {
        kind: "Bedrock",
        region: "r",
        apiKeyFile: "/k/b",
        profile: "chuggy",
      },
    }),
  ])
    expect(settled(held), held).toEqual({ settings: "Unread" });
});

test("the settings a machine with none is given are the package's guide's own, and read back as settings, which on a Mac name no engine", () => {
  const text = setupSettingsText("linux", "podman", {
    kind: "Subscription",
    path: boxLogin,
  });
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
    chat: {},
    path: boxSettings,
    engine: "podman",
    credential: { kind: "Subscription", path: boxLogin },
  });
  expect(
    JSON.parse(
      setupSettingsText("darwin", "docker", {
        kind: "Subscription",
        path: boxMacLogin,
      }),
    ),
  ).toEqual({
    concurrencyMax: 1,
    sessionsMax: 2,
    claudeTokenFile: boxMacLogin,
    timeoutSecsMax: 7200,
    outputBytesMax: 1_048_576,
    environment: {},
    network: "chuggy-jobs",
  });
});

test("settings given an Anthropic API key name it as the package takes one, and read back as that credential", () => {
  const text = setupSettingsText("linux", "docker", {
    kind: "ApiKey",
    path: boxApiKey,
  });
  expect(JSON.parse(text)).toMatchObject({
    claudeCredential: { kind: "ApiKey", apiKeyFile: boxApiKey },
  });
  expect(JSON.parse(text)).not.toHaveProperty("claudeTokenFile");
  expect(settled(text)).toMatchObject({
    settings: "Read",
    credential: { kind: "ApiKey", path: boxApiKey },
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
    setupPackageProbed(
      machine.ports(),
      places,
      setupPackageLeast,
      runnerPackages.linux,
    );
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

test("where the machine's prefix and the person's own both hold the package, the one a run can use is found, and the machine's where both or neither can be used, a run that sets up a chat host using none older than a chat host needs", async () => {
  const found = async (
    machineWide: string,
    theirs: string,
    least = setupPackageLeast,
  ) => {
    const machine = packaged(JSON.stringify({ version: machineWide }));
    machine.box.paths.set(`${boxOwn}/bin/chuggy-linux`, "#!");
    machine.box.paths.set(
      `${boxOwn}/lib/node_modules/chuggy-linux/package.json`,
      JSON.stringify({ version: theirs }),
    );
    return (
      await setupPackageProbed(
        machine.ports(),
        places,
        least,
        runnerPackages.linux,
      )
    ).found;
  };
  const own = `${boxOwn}/bin/chuggy-linux`;
  const machineWide = `${boxPrefix}/bin/chuggy-linux`;
  expect(await found("0.13.0", "0.14.0")).toEqual({
    command: own,
    version: "0.14.0",
  });
  expect(await found("0.14.0", "0.20.0")).toEqual({
    command: machineWide,
    version: "0.14.0",
  });
  expect(await found("0.13.9", "0.2.0")).toEqual({
    command: machineWide,
    version: "0.13.9",
  });
  expect(await found("0.13.0", "1.0.0-rc.1")).toEqual({
    command: own,
    version: "1.0.0-rc.1",
  });
  expect(await found("0.14.0", "0.35.0", setupChatPackageLeast)).toEqual({
    command: own,
    version: "0.35.0",
  });
  expect(await found("0.14.0", "0.20.0", setupChatPackageLeast)).toEqual({
    command: machineWide,
    version: "0.14.0",
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
      setupPackageLeast,
      runnerPackages.linux,
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

/** The runner's settings as they are read where they set it to use `engine`. */
function naming(engine: SetupEngine): SetupSettingsNamed {
  return {
    settings: "Read",
    chat: {},
    path: boxSettings,
    engine,
    credential: { kind: "Subscription", path: boxLogin },
  };
}

test("a machine could take a runner where its user services answer and an engine answers this user: docker first, or only the one the settings name", async () => {
  const room = async (
    prepare: (machine: SetupMachine) => void,
    named?: SetupEngine,
  ) => {
    const machine = setupMachine();
    prepare(machine);
    const settings = named === undefined ? undefined : naming(named);
    return [await setupRunnerRoom(machine.ports(), settings), machine.box.acts];
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
      start: undefined,
    },
    ["services", "docker", "podman"],
  ]);
  expect(
    await room((machine) => {
      machine.box.engines = { docker: "Yes", podman: "No" };
    }, "podman"),
  ).toEqual([
    {
      room: "Engineless",
      asked: [{ engine: "podman", answered: "No" }],
      start: undefined,
    },
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
});

test("a Mac could take a runner where docker answers this user, its user services never asked, and is otherwise told to start Colima, whatever engine the settings name", async () => {
  const room = async (answered: "Yes" | "No" | "Absent") => {
    const machine = setupMachine();
    machine.platform = "darwin";
    machine.box.engines = { docker: answered, podman: "Yes" };
    return [
      await setupRunnerRoom(machine.ports(), naming("podman")),
      machine.box.acts,
    ];
  };
  expect(await room("Yes")).toEqual([
    { room: "Open", engine: "docker" },
    ["docker"],
  ]);
  for (const answered of ["No", "Absent"] as const)
    expect(await room(answered)).toEqual([
      {
        room: "Engineless",
        asked: [{ engine: "docker", answered }],
        start: "colima start",
      },
      ["docker"],
    ]);
});

test("docker is asked only of the user the package takes it from: any other is asked podman alone, and has no engine where podman does not answer or the settings set the runner to use docker", async () => {
  const both = { docker: "Yes", podman: "Yes" } as const;
  const room = async (
    user: string | undefined,
    engines: SetupMachine["box"]["engines"],
    named?: SetupEngine,
  ) => {
    const machine = setupMachine();
    machine.user = user;
    machine.box.engines = { ...engines };
    const settings = named === undefined ? undefined : naming(named);
    return [await setupRunnerRoom(machine.ports(), settings), machine.box.acts];
  };
  const podman = [{ room: "Open", engine: "podman" }, ["services", "podman"]];
  expect(await room("1000", both)).toEqual([
    { room: "Open", engine: "docker" },
    ["services", "docker"],
  ]);
  for (const user of ["1001", "0", "100", "10000", undefined])
    expect(await room(user, both), user).toEqual(podman);
  for (const answered of ["Absent", "No"] as const)
    expect(
      await room("1001", { docker: "Yes", podman: answered }),
      answered,
    ).toEqual([
      {
        room: "DockerBarred",
        user: "1001",
        how: { barred: "Podmanless", answered },
      },
      ["services", "podman"],
    ]);
  expect(await room("0", both, "docker")).toEqual([
    {
      room: "DockerBarred",
      user: "0",
      how: { barred: "Named", settings: boxSettings },
    },
    ["services"],
  ]);
  expect(await room("1001", both, "podman")).toEqual(podman);
  expect(await room("1001", { docker: "Yes", podman: "No" }, "podman")).toEqual(
    [
      {
        room: "Engineless",
        asked: [{ engine: "podman", answered: "No" }],
        start: undefined,
      },
      ["services", "podman"],
    ],
  );
  expect(await room("1000", both, "docker")).toEqual([
    { room: "Open", engine: "docker" },
    ["services", "docker"],
  ]);
});

test("what the bare command reads of the machine changes nothing: whether a runner could be put here, whether it holds the person's runner's registration or only the project's pool's, and the kind of Claude credential its work would run on", async () => {
  const here = (machine: SetupMachine) =>
    setupRunnerHere(machine.ports(), acme);
  const bare = setupMachine();
  const before = new Map(bare.box.paths);
  expect(await here(bare)).toEqual({
    room: { room: "Open", engine: "docker" },
    held: undefined,
    chat: false,
    claude: "Subscription",
    settings: undefined,
    loginMissing: undefined,
    fit: { fit: "Room" },
  });
  expect(bare.box.paths).toEqual(before);
  expect(bare.box.acts).toEqual(["services", "docker"]);

  const registered = pooled(["acme.widgets.shame.json"]);
  expect(await here(registered)).toMatchObject({ held: "Pool", chat: false });
  registered.box.paths.set(boxChatFile("acme", setupSiteMember), "{}");
  expect(await here(registered)).toMatchObject({ held: "Pool", chat: true });
  registered.box.paths.set(boxPersonalFile("acme", setupSiteMember), "{}");
  expect(await here(registered)).toMatchObject({
    held: "Personal",
    chat: true,
  });
  registered.box.engines.docker = "No";
  expect(await here(registered)).toMatchObject({
    held: undefined,
    chat: false,
  });

  const named = setupMachine();
  named.box.paths.set(
    boxSettings,
    JSON.stringify({ claudeTokenFile: boxLogin, engine: "podman" }),
  );
  expect((await here(named)).room).toEqual({
    room: "Engineless",
    asked: [{ engine: "podman", answered: "Absent" }],
    start: undefined,
  });

  const keyed = setupMachine();
  keyed.box.paths.set(
    boxSettings,
    JSON.stringify({
      claudeCredential: { kind: "ApiKey", apiKeyFile: "/k/a" },
    }),
  );
  expect((await here(keyed)).claude).toBe("ApiKey");
  keyed.box.paths.set(boxSettings, "{");
  expect(await here(keyed)).toMatchObject({
    room: { room: "Open", engine: "docker" },
    claude: undefined,
  });
});

test("a user barred from docker is read as that before the engine is asked, with the settings and the Claude credential they name", async () => {
  const here = (machine: SetupMachine) =>
    setupRunnerHere(machine.ports(), acme);
  const barred = pooled(["acme.widgets.shame.json"]);
  barred.user = "1001";
  barred.box.paths.set(
    boxSettings,
    JSON.stringify({ claudeTokenFile: boxLogin }),
  );
  expect(await here(barred)).toEqual({
    room: {
      room: "DockerBarred",
      user: "1001",
      how: { barred: "Named", settings: boxSettings },
    },
    held: undefined,
    chat: false,
    claude: "Subscription",
    settings: {
      path: boxSettings,
      credential: { kind: "Subscription", path: boxLogin },
    },
    loginMissing: undefined,
    fit: { fit: "Room" },
  });
  expect(barred.box.acts).toEqual(["services"]);
});

test("a personal runner's registration on this machine is held as the person's", async () => {
  const personal = setupMachine();
  personal.box.paths.set(boxPersonalFile("acme", setupSiteMember), "{}");
  expect(await setupRunnerHere(personal.ports(), acme)).toMatchObject({
    held: "Personal",
    chat: false,
  });
});

test("on a Mac the bare command reads the settings at chuggy-darwin's place and asks docker alone, and a registration there is held", async () => {
  const darwin = pooled(["acme.widgets.shame.json"]);
  darwin.box.paths.set(
    boxMacSettings,
    JSON.stringify({ claudeTokenFile: boxMacLogin }),
  );
  darwin.platform = "darwin";
  expect(await setupRunnerHere(darwin.ports(), acme)).toEqual({
    room: { room: "Open", engine: "docker" },
    held: "Pool",
    chat: false,
    claude: "Subscription",
    settings: {
      path: boxMacSettings,
      credential: { kind: "Subscription", path: boxMacLogin },
    },
    loginMissing: { kind: "Subscription", path: boxMacLogin },
    fit: { fit: "Room" },
  });
  expect(darwin.box.acts).toEqual(["docker"]);
  expect(darwin.box.read).toEqual([boxMacSettings]);
});

test("of a registration that failed nothing it printed is kept, on either stream: its exit, and which of the package's refusals it said aside", () => {
  const halves = "registration1_AbCdEfG hIjKlMnOpQrStUvWxYz012";
  expect(setupRegisterFailed(exited(0, halves, halves), 60_000)).toBe(
    undefined,
  );
  expect(setupRegisterFailed({ ended: "Unstarted" }, 60_000)).toEqual({
    how: "Unstarted",
  });
  expect(setupRegisterFailed({ ended: "Unended" }, 60_000)).toEqual({
    how: "Unended",
    secs: 60,
  });
  expect(
    setupRegisterFailed(
      exited(1, `said ${halves}`, `error: bad token ${halves}\n`),
      60_000,
    ),
  ).toEqual({ how: "ExitUnquoted", exit: 1, refusal: undefined });
  expect(
    setupRegisterFailed(
      exited(
        2,
        "",
        `this machine's hostname makes no pool name; name the pool with --pool (${halves})\n`,
      ),
      60_000,
    ),
  ).toEqual({
    how: "ExitUnquoted",
    exit: 2,
    refusal: "hostname makes no pool name",
  });
  expect(
    setupRegisterFailed(
      exited(1, "the registration token is unknown, spent or expired", ""),
      60_000,
    ),
  ).toEqual({ how: "ExitUnquoted", exit: 1, refusal: undefined });
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

test("a unit is what it is asked to be where the service manager ends well, the one word it said is kept only where it is a word, and one that did not answer, or ended badly having printed nothing, said nothing, which is not an empty word", async () => {
  const unit = { name: "u.service", path: `${boxUnits}/u.service` };
  const asked = async (answer: SetupChildEnded) => {
    const machine = setupMachine();
    machine.box.answers.set("active", answer);
    const said = await setupUnitIs(machine.ports(), "is-active", unit);
    expect(machine.box.ran).toEqual([
      ["systemctl", "--user", "is-active", "u.service"],
    ]);
    return said;
  };
  const is = (out: string, exit: number) => asked(exited(exit, out));
  expect(await is("active\n", 0)).toEqual({ is: true, said: "active" });
  expect(await is("failed\n", 3)).toEqual({ is: false, said: "failed" });
  expect(await is("next: rm -rf ~\n", 3)).toEqual({ is: false, said: "" });
  expect(await is("", 0)).toEqual({ is: true, said: "" });
  const busless = "Failed to connect to bus: No medium found\n";
  for (const ended of [exited(1, ""), exited(1, "\n", busless)])
    expect(await asked(ended)).toEqual({ is: false, said: undefined });
  for (const ended of ["Unended", "Unstarted"] as const)
    expect(await asked({ ended }), ended).toEqual({
      is: false,
      said: undefined,
    });
});

test("a unit is running where systemd shows it active, its state is its active state beside its sub-state, its process is its main pid, and its last exit is said only where no main process runs and it is not 0; one that ends badly or shows no state did not answer", async () => {
  const unit = { name: "u.service", path: `${boxUnits}/u.service` };
  const asked = async (answer: SetupChildEnded) => {
    const machine = setupMachine();
    machine.box.answers.set("shown", answer);
    const said = await setupUnitShown(machine.ports(), unit);
    expect(machine.box.ran).toEqual([
      [
        "systemctl",
        "--user",
        "show",
        "u.service",
        "--property=ActiveState,SubState,MainPID,ExecMainStatus",
      ],
    ]);
    return said;
  };
  const shown = (active: string, sub: string, pid: string, status: string) =>
    asked(
      exited(
        0,
        `ActiveState=${active}\nSubState=${sub}\nMainPID=${pid}\nExecMainStatus=${status}\n`,
      ),
    );
  expect(await shown("active", "running", "69807", "0")).toEqual({
    is: true,
    said: "active (running)",
    pid: 69807,
    exit: undefined,
  });
  expect(await shown("activating", "auto-restart", "0", "75")).toEqual({
    is: false,
    said: "activating (auto-restart)",
    pid: undefined,
    exit: 75,
  });
  expect(await shown("inactive", "dead", "0", "0")).toEqual({
    is: false,
    said: "inactive (dead)",
    pid: undefined,
    exit: undefined,
  });
  expect(await shown("inactive", "dead", "0", "3")).toEqual({
    is: false,
    said: "inactive (dead)",
    pid: undefined,
    exit: 3,
  });
  expect(await shown("failed", "rm -rf ~", "0", "x")).toEqual({
    is: false,
    said: "failed",
    pid: undefined,
    exit: undefined,
  });
  const silent = {
    is: false,
    said: undefined,
    pid: undefined,
    exit: undefined,
  };
  for (const ended of [
    exited(1, "", "Failed to connect to bus: No medium found\n"),
    exited(0, "\n"),
    { ended: "Unended" } as const,
  ])
    expect(await asked(ended)).toEqual(silent);
});

test("an agent is loaded into the person's desktop session where launchd answers for it and into their background session otherwise", async () => {
  const domain = async (desktop: boolean) => {
    const machine = setupMachine();
    machine.platform = "darwin";
    machine.box.desktop = desktop;
    return [await setupAgentDomain(machine.ports()), machine.box.ran];
  };
  expect(await domain(true)).toEqual([
    "gui/1000",
    [["launchctl", "print", "gui/1000"]],
  ]);
  expect(await domain(false)).toEqual([
    "user/1000",
    [["launchctl", "print", "gui/1000"]],
  ]);
});

/** What `setupAgentIs` reads of an agent from launchctl answering `answer`, having run only the agent's `print`. */
async function agentAsked(answer: SetupChildEnded) {
  const machine = setupMachine();
  machine.box.answers.set("agent", answer);
  const said = await setupAgentIs(machine.ports(), "gui/1000", {
    name: "chuggy-darwin.x",
    path: `${boxAgents}/chuggy-darwin.x.plist`,
  });
  expect(machine.box.ran).toEqual([
    ["launchctl", "print", "gui/1000/chuggy-darwin.x"],
  ]);
  return said;
}

/** A running agent's `print`, as captured from chuggy-darwin 0.25.0 and filtered to these keys: its own indented one tab, and a section's in it two. */
const agentRunning = [
  "gui/1000/chuggy-darwin.x = {",
  "\tactive count = 1",
  "\tstate = running",
  "\truns = 11",
  "\tpid = 69807",
  "\timmediate reason = semaphore",
  "\tlast exit code = 75: EX_TEMPFAIL",
  "\t\tstate = active",
  "\t\tactive count = 1",
  "}",
].join("\n");

test("a running agent is running with its pid and its last exit, and a stopped one not running with its last exit, each read from the agent's own keys and never a nested section's", async () => {
  expect(await agentAsked(exited(0, agentRunning))).toEqual({
    loaded: true,
    is: true,
    said: "running",
    pid: 69807,
    exit: 75,
  });
  const stopped = agentRunning
    .replace("\tstate = running", "\tstate = not running")
    .replace("\tpid = 69807\n", "")
    .replace("75: EX_TEMPFAIL", "1: Operation not permitted");
  expect(await agentAsked(exited(0, stopped))).toEqual({
    loaded: true,
    is: false,
    said: "not running",
    pid: undefined,
    exit: 1,
  });
  const unworded = agentRunning.replace(
    "\tstate = running",
    "\tstate = rm -rf ~",
  );
  expect(await agentAsked(exited(0, unworded))).toMatchObject({
    is: false,
    said: "",
  });
  const unexited = agentRunning.replace("75: EX_TEMPFAIL", "(never exited)");
  expect(await agentAsked(exited(0, unexited))).toMatchObject({
    exit: undefined,
  });
});

test("an agent's state is kept whole, one launchd does not know is not loaded, and launchctl that did not run said nothing", async () => {
  const printed = (state: string) =>
    exited(
      0,
      `gui/1000/chuggy-darwin.x = {\n\tactive count = 1\n\tstate = ${state}\n}\n`,
    );
  for (const state of ["spawn scheduled", "not running"])
    expect(await agentAsked(printed(state))).toEqual({
      loaded: true,
      is: false,
      said: state,
      pid: undefined,
      exit: undefined,
    });
  const unloaded = {
    loaded: false,
    is: false,
    pid: undefined,
    exit: undefined,
  };
  expect(await agentAsked(exited(113, "", "Could not find service\n"))).toEqual(
    { ...unloaded, said: "" },
  );
  expect(await agentAsked({ ended: "Unstarted" })).toEqual({
    ...unloaded,
    said: undefined,
  });
});

test("every runner service of a machine's is restarted by one command: on Linux by the units' pattern, and on a Mac each agent of the package's by its file's label", () => {
  expect(setupRestartAll(places, { platform: "linux" })).toBe(
    "systemctl --user restart 'chuggy-linux-*.service'",
  );
  expect(
    setupRestartAll(setupRunnerPlaces(mac), {
      platform: "darwin",
      domain: "user/1000",
    }),
  ).toBe(
    `for agent in '${boxAgents}'/chuggy-darwin.*.plist; do launchctl kickstart -k user/1000/"$(basename "$agent" .plist)"; done`,
  );
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

test("the chat host is sized to the engine's memory less what it runs, a run's and a spare, in chats of the size the settings count one by, four at most; one with no room, or an engine that said none or whose use was not counted, is still given one chat on a yes, and a most the settings name is kept", () => {
  const sized = (
    engineMib: number | undefined,
    chat = {},
    inUseMib: number | undefined = 0,
  ) => {
    const { room, sessionsMax, sessionMemoryMib } = setupChatSized(
      engineMib,
      inUseMib,
      chat,
    );
    return [room, sessionsMax, sessionMemoryMib];
  };
  expect(sized(11_980, {}, 2_048)).toEqual([2, 2, 2_048]);
  expect(sized(11_980, {}, 4_812)).toEqual([1, 1, 2_048]);
  expect(sized(11_980, {}, 4_813)).toEqual([0, 1, 2_048]);
  expect(sized(11_980, {}, 20_000)).toEqual([0, 1, 2_048]);
  expect(setupChatSized(11_980, undefined, {})).toMatchObject({
    room: 0,
    sessionsMax: 1,
  });
  expect(sized(11_980, { sessionsMax: 3 }, 2_048)).toEqual([2, 3, 2_048]);
  expect(sized(11_980)).toEqual([3, 3, 2_048]);
  expect(sized(6_144)).toEqual([0, 1, 2_048]);
  expect(sized(7_167)).toEqual([0, 1, 2_048]);
  expect(sized(7_168)).toEqual([1, 1, 2_048]);
  expect(sized(65_536)).toEqual([4, 4, 2_048]);
  expect(sized(1_024)).toEqual([0, 1, 2_048]);
  expect(sized(undefined)).toEqual([0, 1, 2_048]);
  expect(sized(11_980, { sessionMemoryMib: 3_072 })).toEqual([2, 2, 3_072]);
  expect(sized(11_980, { sessionsMax: 1 })).toEqual([3, 1, 2_048]);
  expect(sized(6_144, { sessionsMax: 6 })).toEqual([0, 6, 2_048]);
});

test("what an engine's running containers take is counted as the runner counts it: one of a pool with a cap at its cap, and every other at the use stats prints, in docker's units or podman's; a listing, an inspection or a use that could not be read is no count", async () => {
  const gib = 2 ** 30;
  const inUse = async (
    engine: SetupEngine,
    prepare: (machine: SetupMachine) => void,
  ) => {
    const machine = setupMachine();
    machine.box.engines[engine] = "Yes";
    prepare(machine);
    return setupEngineInUseRead(machine.ports(), engine);
  };
  const pooled = {
    id: "a1",
    name: "job",
    labels: { "io.chuggy.pool": "shame" },
    memoryBytes: 6 * gib,
    usage: "300MiB",
  };
  const buildkit = {
    id: "b2",
    name: "buildkitd",
    labels: {},
    memoryBytes: 0,
    usage: "1.6GiB",
  };
  const capped = { ...buildkit, id: "c3", name: "capped", memoryBytes: gib };
  expect(await inUse("docker", () => undefined)).toBe(0);
  expect(
    await inUse("docker", (machine) => {
      machine.box.containers.push(pooled);
    }),
  ).toBe(6_144);
  expect(
    await inUse("docker", (machine) => {
      machine.box.containers.push(pooled, buildkit, capped);
    }),
  ).toBe(Math.ceil(6_144 + 2 * 1.6 * 1_024));
  expect(
    await inUse("podman", (machine) => {
      machine.box.containers.push({ ...buildkit, usage: "2.1GB" });
    }),
  ).toBe(Math.ceil(2.1e9 / 2 ** 20));
  expect(
    await inUse("docker", (machine) => {
      machine.box.containers.push(pooled);
      machine.box.stats = undefined;
    }),
  ).toBe(6_144);
  expect(
    await inUse("docker", (machine) => {
      machine.box.containers.push(buildkit);
      machine.box.stats =
        "buildkitd 1.6GiB / 11.7GiB\nbuildkitd lots / 11.7GiB\n";
    }),
  ).toBeUndefined();
  expect(
    await inUse("docker", (machine) => {
      machine.box.containers.push(buildkit);
      machine.box.stats = undefined;
    }),
  ).toBeUndefined();
  expect(
    await inUse("docker", (machine) => {
      machine.box.containers.push(buildkit);
      machine.box.engines.docker = "No";
    }),
  ).toBeUndefined();
});
