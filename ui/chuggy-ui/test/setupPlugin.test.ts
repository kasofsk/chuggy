/**
 * `plugin` against a stand-in `claude` that answers as Claude Code's own
 * commands do with `--json`: a list of installed plugins as one array, and
 * each command that changes one ending on a line saying how it went, after
 * whatever its marketplace printed ahead of it.
 */

import { expect, test } from "vitest";

import {
  setupAnswersNone,
  setupPluginSkip,
} from "../app/core/setupArguments.ts";
import {
  setupPlugin,
  setupPluginCommands,
  setupPluginHad,
  setupPluginListCommand,
  setupPluginVersionCommand,
} from "../app/core/setupPlugin.ts";
import type { SetupChildEnded, SetupPorts } from "../app/core/setupPorts.ts";
import { setupPluginId } from "../app/core/setupProgram.ts";
import { setupReportLines } from "../app/core/setupReport.ts";
import type { SetupPluginEnded } from "../app/core/setupReport.ts";
import { copyTextEn } from "../app/copy/catalog.ts";
import { machineScript, machineSite, setupMachine } from "./setupMachine.ts";

const installPath = "/home/me/.claude/plugins/cache/chuggy/chuggy/0.1.0";
const readFromFolder =
  "/home/me/.claude/plugins/marketplaces/chuggy/plugins/chuggy";

/** The stand-in's state: its version, the plugin as installed, and the command that fails where one does. */
interface Claude {
  version: string | undefined;
  plugin: { enabled: boolean; readFromFolder?: string } | undefined;
  /** Whether enabling the plugin leaves it on, which a managed setting can stop. */
  enables: boolean;
  failing: readonly string[] | undefined;
  readonly ran: (readonly string[])[];
}

function claudeOf(given: Partial<Claude> = {}): Claude {
  return {
    version: "2.1.319 (Claude Code)",
    plugin: undefined,
    enables: true,
    failing: undefined,
    ran: [],
    ...given,
  };
}

/** What `claude plugin list --json` prints: every plugin installed, ours among them where it is, across lines. */
function listed(claude: Claude): string {
  const other = {
    id: "other@elsewhere",
    version: "1.0.0",
    scope: "user",
    enabled: true,
    installPath: "/home/me/.claude/plugins/cache/elsewhere/other/1.0.0",
    installedAt: "2026-11-01T00:00:00.000Z",
    lastUpdated: "2026-11-01T00:00:00.000Z",
  };
  const ours =
    claude.plugin === undefined
      ? []
      : [
          {
            id: setupPluginId,
            version: "0.1.0",
            scope: "user",
            enabled: claude.plugin.enabled,
            installPath,
            ...(claude.plugin.readFromFolder === undefined
              ? {}
              : { readFromFolder: claude.plugin.readFromFolder }),
            installedAt: "2026-11-16T00:00:00.000Z",
            lastUpdated: "2026-11-16T00:00:00.000Z",
            projectEnabled: false,
          },
        ];
  return `${JSON.stringify([other, ...ours], undefined, 2)}\n`;
}

/** A command's last line under `--json`, after what a marketplace printed ahead of it. */
function resulted(command: string, ok: boolean): SetupChildEnded {
  const result = ok
    ? {
        command,
        outcome: "ok",
        message: `✔ ${command} ok`,
        pluginId: setupPluginId,
      }
    : {
        command,
        outcome: "failed",
        message: "Marketplace manifest not found",
        failureCode: "manifest_missing",
      };
  return {
    ended: "Exited",
    exit: ok ? 0 : 1,
    out: `Cloning into 'chuggy'...\n${JSON.stringify(result)}\n`,
    err: ok ? "" : `✘ Failed: ${String(result.message)}\n`,
  };
}

function ran(claude: Claude, command: readonly string[]): SetupChildEnded {
  claude.ran.push(command);
  const failing = claude.failing?.join(" ") === command.join(" ");
  const named = (act: keyof typeof setupPluginCommands) =>
    setupPluginCommands[act].join(" ") === command.join(" ");
  if (named("PluginMarketplaceAdd"))
    return resulted("marketplace-add", !failing);
  if (named("PluginMarketplaceUpdate"))
    return resulted("marketplace-update", !failing);
  if (failing) return resulted(command[2] ?? "", false);
  if (named("PluginInstall")) {
    claude.plugin = { enabled: true, readFromFolder };
    return resulted("install", true);
  }
  if (named("PluginUpdate")) return resulted("update", true);
  if (named("PluginEnable")) {
    if (claude.plugin !== undefined && claude.enables)
      claude.plugin = { ...claude.plugin, enabled: true };
    return resulted("enable", true);
  }
  return { ended: "Unstarted" };
}

/** A machine's ports with `claude` the stand-in, or no `claude` at all. */
function portsOf(claude: Claude): SetupPorts {
  const ports = setupMachine().ports();
  return {
    ...ports,
    process: {
      ...ports.process,
      read: (command) => {
        claude.ran.push(command);
        if (claude.version === undefined) return Promise.resolve(undefined);
        if (command.join(" ") === setupPluginVersionCommand.join(" "))
          return Promise.resolve(`${claude.version}\n`);
        if (command.join(" ") === setupPluginListCommand.join(" "))
          return Promise.resolve(listed(claude));
        return Promise.resolve(undefined);
      },
      run: (command) =>
        Promise.resolve(
          claude.version === undefined
            ? { ended: "Unstarted" }
            : ran(claude, command),
        ),
    },
  };
}

async function plugged(claude: Claude): Promise<SetupPluginEnded> {
  const report = await setupPlugin(portsOf(claude), {
    asked: "Plugin",
    site: machineSite,
    answers: setupAnswersNone,
  });
  if (report.report !== "Plugin") throw new Error(report.report);
  return report.ended;
}

/** The commands a run changed anything with, past the reads. */
function changed(claude: Claude): readonly string[] {
  return claude.ran
    .filter(
      (command) =>
        command.join(" ") !== setupPluginVersionCommand.join(" ") &&
        command.join(" ") !== setupPluginListCommand.join(" "),
    )
    .map((command) => command.join(" "));
}

const {
  PluginMarketplaceAdd,
  PluginInstall,
  PluginMarketplaceUpdate,
  PluginUpdate,
  PluginEnable,
} = setupPluginCommands;

test("where the plugin is not installed, its marketplace is added and it is installed, and the setup skill is read from the folder sessions read it from", async () => {
  const claude = claudeOf();
  expect(await plugged(claude)).toEqual({
    ended: "On",
    did: "Installed",
    folder: readFromFolder,
  });
  expect(changed(claude)).toEqual(
    [PluginMarketplaceAdd, PluginInstall].map((command) => command.join(" ")),
  );
  expect(PluginMarketplaceAdd).toEqual([
    "claude",
    "plugin",
    "marketplace",
    "add",
    "https://github.com/kasofsk/chuggy-docs.git",
    "--json",
    "--sparse",
    ".claude-plugin",
    "plugins",
  ]);
});

test("where the plugin is installed and on, its marketplace and it are updated, and the folder is where it was installed when the list names no other", async () => {
  const claude = claudeOf({ plugin: { enabled: true } });
  expect(await plugged(claude)).toEqual({
    ended: "On",
    did: "Updated",
    folder: installPath,
  });
  expect(changed(claude)).toEqual(
    [PluginMarketplaceUpdate, PluginUpdate].map((command) => command.join(" ")),
  );
});

test("where the plugin is installed and off, it is updated and then enabled", async () => {
  const claude = claudeOf({ plugin: { enabled: false, readFromFolder } });
  expect(await plugged(claude)).toEqual({
    ended: "On",
    did: "Enabled",
    folder: readFromFolder,
  });
  expect(changed(claude)).toEqual(
    [PluginMarketplaceUpdate, PluginUpdate, PluginEnable].map((command) =>
      command.join(" "),
    ),
  );
});

test("the folder a session reads the plugin from is preferred to the one it was installed into", async () => {
  const ports = portsOf(
    claudeOf({ plugin: { enabled: true, readFromFolder } }),
  );
  const report = await setupPlugin(ports, {
    asked: "Plugin",
    site: machineSite,
    answers: setupAnswersNone,
  });
  expect(report).toMatchObject({ ended: { folder: readFromFolder } });
});

test("the checklist has the plugin as the list says, and passed over where the run was given the way past it, without asking claude", async () => {
  const had = (claude: Claude, skip = false) =>
    setupPluginHad(
      portsOf(claude),
      skip
        ? { ...setupAnswersNone, plugin: setupPluginSkip }
        : setupAnswersNone,
    );
  expect(await had(claudeOf())).toBe("None");
  expect(await had(claudeOf({ plugin: { enabled: true } }))).toBe("On");
  expect(await had(claudeOf({ plugin: { enabled: false } }))).toBe("Off");
  expect(await had(claudeOf({ version: undefined }))).toBe("None");
  const asked = claudeOf();
  expect(await had(asked, true)).toBe("Skipped");
  expect(asked.ran).toEqual([]);
});

test("each way plugin ends without the plugin on says why, changes nothing more, and names the checklist with the way past the plugin's step", async () => {
  const endings: readonly (readonly [Claude, SetupPluginEnded, string])[] = [
    [
      claudeOf({ version: undefined }),
      { ended: "Claudeless" },
      "no claude command answered here",
    ],
    [
      claudeOf({ version: "2.1.200 (Claude Code)" }),
      { ended: "Old", version: "2.1.200", least: "2.1.287" },
      "Claude Code here is 2.1.200, and the plugin's commands need 2.1.287 or later",
    ],
    [
      claudeOf({ version: "Claude Code" }),
      { ended: "Old", version: undefined, least: "2.1.287" },
      "Claude Code here did not say its version, and the plugin's commands need 2.1.287 or later",
    ],
    [
      claudeOf({ failing: PluginMarketplaceAdd }),
      {
        ended: "Failed",
        act: "PluginMarketplaceAdd",
        failed: {
          how: "Exit",
          exit: 1,
          excerpt: "✘ Failed: Marketplace manifest not found",
        },
      },
      "adding chuggy's plugin marketplace to Claude Code ended with exit 1, saying: ✘ Failed: Marketplace manifest not found",
    ],
    [
      claudeOf({ plugin: { enabled: false }, enables: false }),
      { ended: "Off" },
      "chuggy@chuggy is installed and still off after Claude Code was asked to turn it on",
    ],
  ];
  for (const [claude, ending, found] of endings) {
    const ended = await plugged(claude);
    expect(ended).toEqual(ending);
    expect(
      setupReportLines(
        { report: "Plugin", site: machineSite, ended },
        machineScript,
        copyTextEn,
      ),
    ).toEqual([
      `found: ${found}, so setup goes on without chuggy's plugin`,
      `next: node ${machineScript} --plugin skip --site ${machineSite}`,
    ]);
  }
  const failed = claudeOf({ failing: PluginMarketplaceAdd });
  await plugged(failed);
  expect(changed(failed)).toEqual([PluginMarketplaceAdd.join(" ")]);
});

test("a run whose commands end well and whose list still lacks the plugin says so", async () => {
  const claude = claudeOf();
  const ports = portsOf(claude);
  const unlisting: SetupPorts = {
    ...ports,
    process: {
      ...ports.process,
      run: async (command, waitMs, bytesMax) => {
        const ended = await ports.process.run(command, waitMs, bytesMax);
        claude.plugin = undefined;
        return ended;
      },
    },
  };
  const report = await setupPlugin(unlisting, {
    asked: "Plugin",
    site: machineSite,
    answers: setupAnswersNone,
  });
  expect(report).toEqual({
    report: "Plugin",
    site: machineSite,
    ended: { ended: "Unlisted" },
  });
});
