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
  setupServerProgram,
} from "../app/core/setupAgent.ts";
import { setupRunnerPlaces } from "../app/core/setupRunnerMachine.ts";
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
  return machineSignedIn(setupSiteAt("NorthStar"), false);
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
  const machine = await machineSignedIn(setupSiteAt("NorthStar"));
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

test("mcp on a Mac whose person set a configuration directory names the program that keeps its sign-ins in the store there, over the Mac package's server", async () => {
  const machine = await unserved();
  machine.platform = "darwin";
  machine.configHome = "/xdg";
  writeConfig(machine, local(entry("widgets", "chuggy-darwin")));
  machine.box.acts.length = 0;
  expect(ended(await machine.command(mcp))).toEqual(served);
  expect(machine.box.acts.filter((act) => act.startsWith("mcp"))).toEqual([
    "mcpRemove",
    "mcpAdd",
  ]);
  expect(JSON.parse(machine.box.paths.get(boxClaudeConfig) ?? "{}")).toEqual(
    local(entry()),
  );
  const surroundings = machine.ports().surroundings;
  expect(setupServerProgram).toBe("chuggy-linux");
  expect(signInStoreDirectory({ home: boxHome, configHome: "/xdg" })).toBe(
    setupRunnerPlaces(surroundings).pools.replace(/pools$/u, "sign-ins"),
  );
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
  const machine = await machineSignedIn(setupSiteAt("NorthStar"));
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
