/**
 * The project's first ticket filed by the setup program itself: the ticket
 * step asks what the person wants done, and `ticket` files it as the
 * console's Create ticket does, under the binding's configuration, released
 * and sent to start, with the console's New ticket page left as the way
 * where what a ticket may use could not be read.
 *
 * @vitest-environment node
 */

import { expect, test } from "vitest";

import { copyTextEn } from "../app/copy/catalog.ts";
import { setupAsked } from "../app/core/setupArguments.ts";
import { setupReportExit, setupReportLines } from "../app/core/setupReport.ts";
import { setupTicketFiledUnder } from "../app/core/setupTicket.ts";
import { creationConfigurationsOffered } from "../app/core/ticketCreation.ts";
import type { SetupReport } from "../app/core/setupReport.ts";
import {
  machineScript,
  machineServing,
  machineSignedIn,
} from "./setupMachine.ts";
import type { SetupMachine } from "./setupMachine.ts";
import {
  setupSiteAt,
  setupSiteBootstrap,
  setupSiteBootstrapRevision,
  setupSiteDeclaredRevision,
  setupSiteRepositoryAddress,
} from "./setupSite.ts";
import type { SetupSite, SetupSiteProject } from "./setupSite.ts";
import {
  creationBinding,
  creationListed,
  creationOffer,
  creationSummary,
} from "./ticketCreationFixture.ts";

const flags = ["--workspace", "acme", "--project", "widgets"];
const at = flags.join(" ");
const page = "https://chuggy.example/acme/widgets/tickets/new";
const title = "Fix the README's install steps";
const intent =
  "The install steps in the README name a command that no longer exists.\nMake them match what the repository does now.";
const asked = `What would you like done first in acme/widgets? Say it in a sentence or two, or ask me to suggest something small from this repository. I will make it a ticket and start it.`;
const yourself = `If you would rather write it yourself: Open ${page}, say what you want done and press Create ticket.`;
const rule = `rule: Run node ${machineScript} ticket ${at} with --title and a short title for what the person wants done, then --intent and what they want done in their own words`;
const once = `, each quoted as one word, only once the person has said what they want done.`;

function lines(report: SetupReport): readonly string[] {
  return setupReportLines(report, machineScript, copyTextEn, machineServing);
}

function step(said: readonly string[], name: string): string | undefined {
  return said.find((line) => line.startsWith(`step: ${name} `));
}

function project(machine: SetupMachine): SetupSiteProject {
  const held = machine.world.projects[0];
  if (held === undefined) throw new Error("no project");
  return held;
}

/** Every write the run sent, by method and path. */
function writes(machine: SetupMachine): readonly string[] {
  return machine.sent
    .filter((sent) => !sent.startsWith("GET "))
    .map((sent) => sent.replace(/https?:\/\/[^/]+/u, ""));
}

function filing(...more: readonly string[]): readonly string[] {
  return ["ticket", ...flags, "--title", title, "--intent", intent, ...more];
}

/** A site at its first ticket, with a live runner, whose one repository holds what `held` says. */
function live(held: "Bootstrap" | readonly string[]): SetupSite {
  const site = setupSiteAt("Live");
  if (held === "Bootstrap") return setupSiteBootstrap(site);
  const only = site.projects[0];
  if (only !== undefined) only.declared = [...held];
  return site;
}

const projectBase = "/api/v1/tenants/acme/projects/widgets";

test("where the repository holds no configuration of its own, the ticket step asks what the person wants done, and their words become a released ticket sent to start, under the binding's bootstrap", async () => {
  const machine = await machineSignedIn(live("Bootstrap"));
  expect(lines(await machine.command(flags)).slice(-3)).toEqual([
    `ask: ${asked} ${yourself}`,
    `${rule}${once}`,
    "next: stop",
  ]);
  expect(writes(machine)).toEqual([]);

  const report = await machine.command(filing());
  const said = lines(report);
  expect(said[1]).toBe(
    "did: asked chuggy to file ticket 1, released and sent to start, under bootstrap, so the ticket also writes this repository's own configuration",
  );
  expect(step(said, "ticket")).toBe(
    "step: ticket      waiting  ticket 1 is in Work",
  );
  expect(writes(machine)).toEqual([
    `POST ${projectBase}/drafts`,
    `POST ${projectBase}/operations`,
    `POST ${projectBase}/operations`,
  ]);
  expect(project(machine).filed.get(1)).toMatchObject({
    configurationRevision: setupSiteBootstrapRevision(
      setupSiteRepositoryAddress,
    ),
    brief: { title, intent },
  });
  expect(setupReportExit(report)).toBe(0);
});

test("a filing the site refuses says so in the console's words, makes no ticket, and leaves the question standing", async () => {
  const machine = await machineSignedIn(live("Bootstrap"));
  machine.world.fates.set("file", "Failed");
  const said = lines(await machine.command(filing()));
  expect(said[1]).toMatch(/^found: chuggy did not file the ticket: \S/u);
  expect(step(said, "ticket")).toBe("step: ticket      todo");
  expect(said.at(-3)).toBe(`ask: ${asked} ${yourself}`);
  expect(writes(machine)).toEqual([`POST ${projectBase}/drafts`]);
  expect(project(machine).tickets).toEqual([]);
});

test("where the repository declares one configuration, the ticket is filed under it with nothing to choose", async () => {
  const machine = await machineSignedIn(live(["development"]));
  expect(lines(await machine.command(flags)).at(-2)).toBe(`${rule}${once}`);
  const said = lines(await machine.command(filing()));
  expect(said[1]).toBe(
    "did: asked chuggy to file ticket 1, released and sent to start, under development",
  );
  expect(project(machine).filed.get(1)?.configurationRevision).toBe(
    setupSiteDeclaredRevision("development"),
  );
});

test("where the repository declares several configurations, the ask names them, a filing that names none is refused naming them, and one that names one is filed under it", async () => {
  const machine = await machineSignedIn(live(["development", "review"]));
  expect(lines(await machine.command(flags)).slice(-2, -1)).toEqual([
    `${rule}, then --configuration and the configuration they chose${once}`,
  ]);
  expect(lines(await machine.command(flags)).at(-3)).toBe(
    `ask: ${asked} The project offers development or review: which configuration should it use? ${yourself}`,
  );

  const unchosen = lines(await machine.command(filing()));
  expect(unchosen[1]).toBe(
    "found: chuggy did not file the ticket: the project offers development, review, so the configuration has to be chosen",
  );
  const unoffered = lines(
    await machine.command(filing("--configuration", "nightly")),
  );
  expect(unoffered[1]).toBe(
    "found: chuggy did not file the ticket: the configuration named is not one the project offers, which are development, review",
  );
  expect(writes(machine)).toEqual([]);

  const chosen = lines(
    await machine.command(filing("--configuration", "review")),
  );
  expect(chosen[1]).toBe(
    "did: asked chuggy to file ticket 1, released and sent to start, under review",
  );
  expect(project(machine).filed.get(1)?.configurationRevision).toBe(
    setupSiteDeclaredRevision("review"),
  );
});

test("where the repository's work is merged through a pull request, the ticket's branch is made from its title, as Create ticket proposes it", async () => {
  const site = live("Bootstrap");
  const only = site.projects[0];
  if (only === undefined) throw new Error("no project");
  only.repositories = only.repositories.map((held) => ({
    ...held,
    mode: "PullRequestMerge",
  }));
  const machine = await machineSignedIn(site);
  await machine.command(filing());
  expect(project(machine).filed.get(1)?.brief.branch).toBe(
    "refs/heads/fix-the-readme-s-install-steps",
  );
});

test("ticket files nothing where the project's first ticket is not the next thing, and says so", async () => {
  const machine = await machineSignedIn(setupSiteAt("Moving"));
  const said = lines(await machine.command(filing()));
  expect(said[1]).toBe(
    "found: nothing to file: the next thing is not the project's first ticket",
  );
  expect(writes(machine)).toEqual([]);
});

test("where what a ticket may use could not be read, the console's New ticket page is the way", async () => {
  const machine = await machineSignedIn(live(["development"]));
  machine.world.fates.set("configurations", "Failed");
  expect(lines(await machine.command(flags)).slice(-2, -1)).toEqual([
    `rule: Run node ${machineScript} ${at} only once the person says the ticket is created.`,
  ]);
  expect(lines(await machine.command(flags)).at(-3)).toBe(
    `tell: Open ${page}, say what you want done and press Create ticket. Tell me once it is created.`,
  );
});

test("ticket is not run without both a title and what is wanted done", () => {
  expect(setupAsked(["ticket", ...flags, "--title", title])).toEqual({
    asked: "Wrongly",
    fault: "Brief",
  });
  expect(setupAsked(["ticket", ...flags, "--intent", intent])).toEqual({
    asked: "Wrongly",
    fault: "Brief",
  });
  expect(
    setupAsked(["ticket", ...flags, "--title", title, "--intent", intent]),
  ).toMatchObject({ asked: "Ticket", title, intent, configuration: undefined });
});

test("a ticket filed under one of several bootstraps, each named beside its repository, is filed under a bootstrap, and one under a declared configuration is not", () => {
  const offered = creationConfigurationsOffered(
    [],
    [
      "https://forge.test/acme-org/widgets",
      "https://forge.test/acme-org/gadgets",
    ].map((repository) =>
      creationListed(creationBinding(repository), "Bootstrapped"),
    ),
  );
  expect(offered.map((offer) => offer.name)).toEqual([
    "bootstrap · acme-org/gadgets",
    "bootstrap · acme-org/widgets",
  ]);
  for (const { name, revision } of offered)
    expect(
      setupTicketFiledUnder(1, {
        ...creationOffer(creationSummary(revision, "Ready")),
        name,
        listed: undefined,
      }),
    ).toEqual({
      answered: "Filed",
      ticket: 1,
      configuration: name,
      bootstrap: true,
    });
  expect(setupTicketFiledUnder(1, creationOffer())).toMatchObject({
    bootstrap: false,
  });
});

/** The tell the bare command says once the first ticket is filed and in Work, on a site whose one repository holds what `held` says and lands its work as `mode` does. */
async function landingTold(
  held: "Bootstrap" | readonly string[],
  mode: "PullRequest" | "PullRequestMerge",
): Promise<string | undefined> {
  const site = live(held);
  const only = site.projects[0];
  if (only === undefined) throw new Error("no project");
  only.repositories = only.repositories.map((one) => ({ ...one, mode }));
  const machine = await machineSignedIn(site);
  await machine.command(
    filing(...(held === "Bootstrap" ? [] : ["--configuration", held[0] ?? ""])),
  );
  return lines(await machine.command(flags)).find((line) =>
    line.startsWith("tell: "),
  );
}

const told = (ends: string): string =>
  `tell: Ticket 1 is in Work. ${ends} https://chuggy.example/acme/widgets/tickets/1 shows where it is. Tell me when you want me to look again.`;

test("a first ticket under the bootstrap, in a repository that lands work in a pull request the person merges, is told to end in one setup can merge on a yes, whose merge makes later tickets run on the repository's own configuration", async () => {
  expect(await landingTold("Bootstrap", "PullRequest")).toBe(
    told(
      "It ends in a pull request that I can merge for you once you say yes, and merging it makes later tickets run on this repository's own configuration. Setup is done once that pull request is open.",
    ),
  );
});

test("a first ticket in a repository whose pull requests chuggy merges itself is told no pull request is the person's to merge", async () => {
  expect(await landingTold("Bootstrap", "PullRequestMerge")).toBe(
    told("Setup is done when it finishes."),
  );
});

test("a first ticket under the repository's own configuration is told its pull request is the person's to merge, and nothing of later tickets' configuration", async () => {
  expect(await landingTold(["development"], "PullRequest")).toBe(
    told(
      "It ends in a pull request for you to merge on GitHub. Setup is done once that pull request is open.",
    ),
  );
});
