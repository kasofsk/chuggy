/**
 * The MCP step and `mcp`, over a machine and an installation that are both
 * doubles: when the agent's configuration counts as naming chuggy's server
 * for the project, what `mcp` changes to make it so, and that the sign-in the
 * server uses is the one this program already holds.
 */

import { expect, test } from "vitest";

import { signInStoreDirectory } from "../../../src/contract/signInStore.ts";
import {
  setupAgentRead,
  setupServerArguments,
  setupServerName,
  setupServerPackages,
} from "../app/core/setupAgent.ts";
import { runnerPackages } from "../app/core/runners.ts";
import { setupChatPackageLeast } from "../app/core/setupRunnerMachine.ts";
import { setupFiles } from "../app/core/setupPorts.ts";
import type { SetupReport } from "../app/core/setupReport.ts";
import {
  machineHeld,
  machineServing,
  machineSignedIn,
  machineSite,
  machineTokenFile,
  setupMachine,
} from "./setupMachine.ts";
import type { SetupMachine } from "./setupMachine.ts";
import {
  boxClaudeConfig,
  boxFolder,
  boxHome,
  boxPrefix,
  boxServing,
} from "./setupRunnerBox.ts";
import { setupSiteAt } from "./setupSite.ts";

const mcp = ["mcp", "--workspace", "acme", "--project", "widgets"];
const command = `${boxPrefix}/bin/chuggy-linux`;
const served = { ended: "Served" } as const;

/** A machine signed in to a site set up as far as its project, with nothing of chuggy's server on it. */
function unserved(): Promise<SetupMachine> {
  return machineSignedIn(setupSiteAt("Project"), false);
}

/** The step the bare command says of the agent's configuration. */
async function mcpStep(machine: SetupMachine): Promise<unknown> {
  const report = await machine.command([]);
  if (report.report !== "Checklist") throw new Error(report.report);
  return report.steps.find((step) => step.step === "mcp");
}

function ended(report: SetupReport): unknown {
  return report.report === "Mcp" ? report.ended : report;
}

/** A server entry as Claude Code writes one, for `project` at this site. */
function entry(project = "widgets", run = command): unknown {
  return {
    type: "stdio",
    command: run,
    args: setupServerArguments({
      site: machineSite,
      workspace: "acme",
      project,
    }),
    env: {},
  };
}

function writeConfig(machine: SetupMachine, config: unknown): void {
  machine.box.paths.set(boxClaudeConfig, JSON.stringify(config));
}

const local = (server: unknown) => ({
  projects: { [boxFolder]: { mcpServers: { [setupServerName]: server } } },
});

test("mcp on a machine with no runner package installs it, names the server through Claude Code's own command, and the step is then done with no second sign-in", async () => {
  const machine = await unserved();
  expect(await mcpStep(machine)).toMatchObject({ state: "todo" });
  const issued = machine.issued.length;
  machine.sent.length = 0;
  const report = await machine.command(mcp);
  expect(report).toMatchObject({
    report: "Mcp",
    site: machineSite,
    workspace: "acme",
    project: "widgets",
    ended: served,
  });
  expect(machine.box.acts).toEqual(expect.arrayContaining(["install"]));
  expect(machine.box.acts.filter((act) => act.startsWith("mcp"))).toEqual([
    "mcpAdd",
  ]);
  expect(JSON.parse(machine.box.paths.get(boxClaudeConfig) ?? "{}")).toEqual(
    local(entry()),
  );
  expect(machine.sent).toEqual([]);
  expect(await mcpStep(machine)).toMatchObject({ state: "done" });
  expect(machine.issued.length - issued).toBe(1);
  expect(machineHeld(machine)).toBe(machine.live());
});

test("mcp asks nothing of the site or the issuer, so it runs before a sign-in as well as after", async () => {
  const machine = setupMachine();
  expect(ended(await machine.command([...mcp, "--site", machineSite]))).toEqual(
    served,
  );
  expect(machine.asked).toEqual([]);
  expect(machine.store.size).toBe(0);
});

test("mcp where the server is already named for the project changes nothing and says it was found", async () => {
  const machine = await machineSignedIn(setupSiteAt("Project"));
  const before = machine.box.paths.get(boxClaudeConfig);
  const report = await machine.command(mcp);
  expect(report).toMatchObject({
    ended: served,
    notes: expect.arrayContaining([
      { note: "ServerFound", path: boxClaudeConfig },
    ]) as unknown,
  });
  expect(machine.box.acts).toEqual([]);
  expect(machine.box.paths.get(boxClaudeConfig)).toBe(before);
});

test("mcp where the folder's local chuggy server is for another project removes it before naming this one", async () => {
  const machine = await unserved();
  boxServing(machine.box, { ...machineServing, project: "gadgets" });
  machine.box.acts.length = 0;
  expect(ended(await machine.command(mcp))).toEqual(served);
  expect(machine.box.acts).toEqual(["mcpRemove", "mcpAdd"]);
  expect(JSON.parse(machine.box.paths.get(boxClaudeConfig) ?? "{}")).toEqual(
    local(entry()),
  );
});

/** The next thing the bare command names, as its copy and not its words. */
async function mcpNext(machine: SetupMachine): Promise<unknown> {
  const report = await machine.command([]);
  if (report.report !== "Checklist") throw new Error(report.report);
  return report.next.thing;
}

/** The Mac package installed machine-wide at `version`. */
function darwinHeld(machine: SetupMachine, version: string): void {
  machine.box.paths.set(darwinCommand, "#!");
  machine.box.paths.set(
    `${boxPrefix}/lib/node_modules/chuggy-darwin/package.json`,
    JSON.stringify({ name: "chuggy-darwin", version }),
  );
}

const darwinCommand = `${boxPrefix}/bin/chuggy-darwin`;
const darwinInstall = runnerPackages.darwin.installCommand.split(" ");

test("on a Mac with no runner package, mcp offers and installs the Mac's own package and names its server, run by chuggy-darwin", async () => {
  const machine = await unserved();
  machine.platform = "darwin";
  expect(await mcpNext(machine)).toMatchObject({
    command: "Mcp",
    tell: {
      id: "setup-mend-mcp-offer-absent",
      args: { program: "chuggy-darwin" },
    },
  });
  machine.box.ran.length = 0;
  expect(ended(await machine.command(mcp))).toEqual(served);
  expect(machine.box.ran).toContainEqual(darwinInstall);
  expect(machine.box.ran.flat()).not.toContain(
    runnerPackages.linux.installCommand.split(" ").at(-1),
  );
  expect(machine.box.ran.at(-1)).toEqual([
    "claude",
    "mcp",
    "add",
    "--scope",
    "local",
    setupServerName,
    "--",
    darwinCommand,
    "mcp",
    "--site",
    machineSite,
    "--workspace",
    "acme",
    "--project",
    "widgets",
  ]);
  expect(JSON.parse(machine.box.paths.get(boxClaudeConfig) ?? "{}")).toEqual(
    local(entry("widgets", darwinCommand)),
  );
  expect(await mcpStep(machine)).toMatchObject({ state: "done" });
});

test("on a Mac, mcp leaves a chuggy-darwin whose mcp keeps the shared store as it is, and replaces an older one, which it says is old", async () => {
  const kept = await unserved();
  kept.platform = "darwin";
  darwinHeld(kept, setupServerPackages.darwin.least);
  expect(await mcpNext(kept)).toMatchObject({
    tell: { id: "setup-mend-mcp-offer", args: { program: "chuggy-darwin" } },
  });
  kept.box.acts.length = 0;
  expect(ended(await kept.command(mcp))).toEqual(served);
  expect(kept.box.acts).toEqual(["mcpAdd"]);
  expect(JSON.parse(kept.box.paths.get(boxClaudeConfig) ?? "{}")).toEqual(
    local(entry("widgets", darwinCommand)),
  );
  const old = await unserved();
  old.platform = "darwin";
  darwinHeld(old, "0.22.0");
  expect(await mcpNext(old)).toMatchObject({
    tell: {
      id: "setup-mend-mcp-offer-behind",
      args: { program: "chuggy-darwin" },
    },
  });
  old.box.ran.length = 0;
  expect(ended(await old.command(mcp))).toEqual(served);
  expect(old.box.ran).toContainEqual(darwinInstall);
});

test("mcp on a Mac whose person set a configuration directory names the Mac's own program, which keeps its sign-ins in the store there, over a Linux package's server", async () => {
  const machine = await unserved();
  machine.platform = "darwin";
  machine.configHome = "/xdg";
  darwinHeld(machine, setupServerPackages.darwin.least);
  writeConfig(machine, local(entry("widgets", "chuggy-linux")));
  machine.box.acts.length = 0;
  expect(ended(await machine.command(mcp))).toEqual(served);
  expect(machine.box.acts).toEqual(["mcpRemove", "mcpAdd"]);
  expect(JSON.parse(machine.box.paths.get(boxClaudeConfig) ?? "{}")).toEqual(
    local(entry("widgets", darwinCommand)),
  );
  expect(signInStoreDirectory({ home: boxHome, configHome: "/xdg" })).toBe(
    "/xdg/chuggy/sign-ins",
  );
});

test("mcp on Linux installs and runs chuggy-linux, at the least a chat host needs", async () => {
  expect(setupServerPackages.linux).toEqual({
    offered: runnerPackages.linux,
    least: setupChatPackageLeast,
  });
  const machine = await unserved();
  machine.box.ran.length = 0;
  expect(ended(await machine.command(mcp))).toEqual(served);
  expect(machine.box.ran).toContainEqual(
    runnerPackages.linux.installCommand.split(" "),
  );
  expect(machine.box.ran.at(-1)?.[7]).toBe(command);
});

test("a run of runner with no runner package here changes nothing and names mcp, which installs it", async () => {
  const machine = await unserved();
  const report = await machine.command(["runner", ...mcp.slice(1)]);
  expect(report).toMatchObject({
    report: "Runner",
    ended: { ended: "Stopped", stop: { stop: "Unpackaged", found: undefined } },
  });
  expect(machine.box.acts).not.toContain("install");
});

test("the server the agent would run is the folder's local one over the checkout's shared one over the person's own, and counts only where it names this project run by the program mcp installs, there to run", async () => {
  const machine = await unserved();
  boxServing(machine.box, machineServing);
  const ports = machine.ports();
  const at = { ...machineServing };
  const named = async () => (await setupAgentRead(ports, at)).named;
  const shared = `${boxFolder}/.mcp.json`;
  const servers = (server: unknown) => ({
    mcpServers: { [setupServerName]: server },
  });
  writeConfig(machine, servers(entry()));
  expect(await named()).toBe(true);
  machine.box.paths.set(shared, JSON.stringify(servers(entry("gadgets"))));
  expect(await named()).toBe(false);
  writeConfig(machine, { ...servers(entry("gadgets")), ...local(entry()) });
  expect(await named()).toBe(true);
  machine.box.paths.delete(shared);
  writeConfig(machine, local(entry("widgets", "/nowhere/chuggy-linux")));
  expect(await named()).toBe(false);
  writeConfig(machine, local(entry("widgets", "chuggy-linux")));
  expect(await named()).toBe(true);
  writeConfig(machine, local(entry("widgets", "/usr/bin/other")));
  expect(await named()).toBe(false);
  writeConfig(machine, local(entry("widgets", "chuggy-darwin")));
  expect(await named()).toBe(false);
  machine.box.paths.set(boxClaudeConfig, "{ not json");
  expect(await named()).toBe(false);
});

test("a sign-in kept by the program before the shared store is moved there once, and one the store already holds is never replaced by it", async () => {
  const machine = await machineSignedIn(setupSiteAt("Project"));
  const held = machine.live() ?? "";
  machine.store.clear();
  machine.files.set(
    setupFiles.session,
    JSON.stringify({ site: machineSite, refreshToken: held }),
  );
  expect(await machine.command([])).toMatchObject({ report: "Checklist" });
  expect(new URLSearchParams(machine.bodies.at(-1)).get("refresh_token")).toBe(
    held,
  );
  expect(machineHeld(machine)).toBe(machine.live());
  expect(JSON.parse(machine.files.get(setupFiles.session) ?? "{}")).toEqual({
    site: machineSite,
  });
  const current = machine.store.get(machineTokenFile());
  machine.files.set(
    setupFiles.session,
    JSON.stringify({ site: machineSite, refreshToken: "renewal-old" }),
  );
  expect(await machine.command([])).toMatchObject({ report: "Checklist" });
  expect(machine.bodies.join(" ")).not.toContain("renewal-old");
  expect(machine.store.get(machineTokenFile())).not.toBe(current);
  expect(machineHeld(machine)).toBe(machine.live());
});
