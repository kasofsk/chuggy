/**
 * The project's first ticket filed by the setup program itself: under a
 * bootstrap the ticket step recommends a worker image and announces the
 * end-to-end check, and elsewhere it asks what the person wants done, and
 * `ticket` files it as the console's Create ticket does, under the binding's
 * configuration, released and sent to start, with the console's New ticket
 * page left as the way where what a ticket may use could not be read. Once it
 * is on its way, `watch` waits on it.
 *
 * @vitest-environment node
 */

import { expect, test } from "vitest";

import { chuggyDocsIndex } from "../../../src/contract/sessionTools.ts";
import { copyTextEn } from "../app/copy/catalog.ts";
import { setupAsked } from "../app/core/setupArguments.ts";
import { setupReportExit, setupReportLines } from "../app/core/setupReport.ts";
import {
  setupTicketAgentsPath,
  setupTicketFiledUnder,
  setupTicketOffersOf,
  setupTicketWritten,
} from "../app/core/setupTicket.ts";
import { creationConfigurationsOffered } from "../app/core/ticketCreation.ts";
import type { CreationOffer } from "../app/core/ticketCreation.ts";
import type { SetupReport } from "../app/core/setupReport.ts";
import {
  machineProject,
  machineScript,
  machineServing,
  machineSignedIn,
  machineWrites,
} from "./setupMachine.ts";
import {
  setupSiteAt,
  setupSiteBootstrap,
  setupSiteBootstrapRevision,
  setupSiteDeclaredRevision,
  setupSiteRepositoryAddress,
} from "./setupSite.ts";
import type { SetupSite } from "./setupSite.ts";
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
const image = "ghcr.io/acme-org/widgets-ci:1";
const toolchains = "Rust, Flutter and Node";
const worker = ["--image", image, "--toolchains", toolchains] as const;
const recommend = `rule: Once the subagent has reported, tell the person, filled from its report: "acme/widgets needs TOOLCHAINS. I recommend IMAGE for its work, because REASON. Say if you want a different one." Recommend, in this order: a stock public image that has those toolchains; else a local build of an image the repository already defines for its CI or development; else a new worker Dockerfile, written in the first ticket. Go on unless the person objects.`;
const announced = (ends: string): string =>
  `tell: I'll file a first ticket to check everything works end to end. It adds a tiny ${setupTicketAgentsPath} and this repository's chuggy configuration, and ends in ${ends}.`;
const unasked = `rule: Run node ${machineScript} ticket ${at} with --image and the image recommended, or the one the person wants instead, then --toolchains and the toolchains it needs, and where they ask for something else to be done first, --title and a short title for it, then --intent and what they want done in their own words, each quoted as one word, once you have said both lines and without waiting for a yes.`;
/** What a bootstrap ticket asks for after what was wanted done: the `AGENTS.md` and the image. */
const carried = `\n\nAdd ${setupTicketAgentsPath} saying only what that folder is, in these lines and nothing about the code, its layout or how to build it: "This folder holds files for chuggy, the system that runs tickets against this repository. \`configurations/\` declares what a ticket runs: the work, the checks and the review. Docs: ${chuggyDocsIndex}."\n\nName this as the image I of the configuration you write, and command checks that run in it: ${image}. This repository's work needs ${toolchains}.`;

function lines(report: SetupReport): readonly string[] {
  return setupReportLines(report, machineScript, copyTextEn, machineServing);
}

function step(said: readonly string[], name: string): string | undefined {
  return said.find((line) => line.startsWith(`step: ${name} `));
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

test("where the repository holds no configuration of its own, the ticket step recommends a worker image, announces the end-to-end check and what it writes, and files it unasked under the binding's bootstrap, asking for the image and toolchains chosen", async () => {
  const machine = await machineSignedIn(live("Bootstrap"));
  expect(lines(await machine.command(flags)).slice(-4)).toEqual([
    recommend,
    announced("chuggy merging its change itself"),
    unasked,
    "next: stop",
  ]);
  expect(machineWrites(machine)).toEqual([]);

  const report = await machine.command(["ticket", ...flags, ...worker]);
  const said = lines(report);
  expect(said[1]).toBe(
    "did: asked chuggy to file ticket 1, released and sent to start, under bootstrap, so the ticket also writes this repository's own configuration",
  );
  expect(step(said, "ticket")).toBe(
    "step: ticket      waiting  ticket 1 is in Work",
  );
  expect(machineWrites(machine)).toEqual([
    `POST ${projectBase}/drafts`,
    `POST ${projectBase}/operations`,
    `POST ${projectBase}/operations`,
  ]);
  expect(machineProject(machine).filed.get(1)).toMatchObject({
    configurationRevision: setupSiteBootstrapRevision(
      setupSiteRepositoryAddress,
    ),
    brief: {
      title: "Check that chuggy works end to end",
      intent: `Check that chuggy works on this repository end to end. Change none of the repository's own code.${carried}`,
    },
  });
  expect(setupReportExit(report)).toBe(0);
});

test("a person who objects with something else to do first has their own words filed in place of the check, still asking for the image and toolchains chosen", async () => {
  const machine = await machineSignedIn(live("Bootstrap"));
  await machine.command(filing(...worker));
  expect(machineProject(machine).filed.get(1)?.brief).toMatchObject({
    title,
    intent: `${intent}${carried}`,
  });
});

test("a ticket under the bootstrap is not filed without a worker image, so its checks are never written for an image nobody chose", async () => {
  const machine = await machineSignedIn(live("Bootstrap"));
  const said = lines(await machine.command(filing()));
  expect(said[1]).toBe(
    "found: chuggy did not file the ticket: no worker image was chosen, and a ticket under the bootstrap needs one to write checks it can run",
  );
  expect(machineWrites(machine)).toEqual([]);
});

test("the first ticket is announced to end in a pull request for the person to merge only where the repository lands work in one, and in chuggy merging it elsewhere", async () => {
  for (const mode of ["PullRequest", "PullRequestMerge", "Push"] as const) {
    const site = live("Bootstrap");
    for (const held of site.projects)
      held.repositories = held.repositories.map((one) => ({ ...one, mode }));
    const machine = await machineSignedIn(site);
    expect(lines(await machine.command(flags)).at(-3), mode).toBe(
      announced(
        mode === "PullRequest"
          ? "a pull request for you to merge"
          : "chuggy merging its change itself",
      ),
    );
  }
});

test("a filing the site refuses says so in the console's words, makes no ticket, and leaves the announcement standing", async () => {
  const machine = await machineSignedIn(live("Bootstrap"));
  machine.world.fates.set("file", "Failed");
  const said = lines(await machine.command(filing(...worker)));
  expect(said[1]).toMatch(/^found: chuggy did not file the ticket: \S/u);
  expect(step(said, "ticket")).toBe("step: ticket      todo");
  expect(said.at(-3)).toBe(announced("chuggy merging its change itself"));
  expect(machineWrites(machine)).toEqual([`POST ${projectBase}/drafts`]);
  expect(machineProject(machine).tickets).toEqual([]);
});

test("where the repository declares one configuration, the ticket is filed under it with nothing to choose", async () => {
  const machine = await machineSignedIn(live(["development"]));
  expect(lines(await machine.command(flags)).at(-2)).toBe(`${rule}${once}`);
  const said = lines(await machine.command(filing()));
  expect(said[1]).toBe(
    "did: asked chuggy to file ticket 1, released and sent to start, under development",
  );
  expect(machineProject(machine).filed.get(1)?.configurationRevision).toBe(
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
  expect(machineWrites(machine)).toEqual([]);

  const chosen = lines(
    await machine.command(filing("--configuration", "review")),
  );
  expect(chosen[1]).toBe(
    "did: asked chuggy to file ticket 1, released and sent to start, under review",
  );
  expect(machineProject(machine).filed.get(1)?.configurationRevision).toBe(
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
  await machine.command(filing(...worker));
  expect(machineProject(machine).filed.get(1)?.brief.branch).toBe(
    "refs/heads/fix-the-readme-s-install-steps",
  );
});

test("ticket files nothing where the project's first ticket is not the next thing, and says so", async () => {
  const machine = await machineSignedIn(setupSiteAt("Moving"));
  const said = lines(await machine.command(filing()));
  expect(said[1]).toBe(
    "found: nothing to file: the next thing is not the project's first ticket",
  );
  expect(machineWrites(machine)).toEqual([]);
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

test("where the project offers several configurations and some is a bootstrap, the worker image is recommended and the rule asks for it beside the configuration chosen", async () => {
  const site = setupSiteAt("Live");
  site.projects[0]?.repositories.push({
    repository: "https://github.com/acme-org/gadgets",
    configured: true,
  });
  const machine = await machineSignedIn(setupSiteBootstrap(site));
  expect(lines(await machine.command(flags)).slice(-4)).toEqual([
    recommend,
    `ask: ${asked} The project offers bootstrap · acme-org/gadgets or bootstrap · acme-org/widgets: which configuration should it use? ${yourself}`,
    `${rule}, then --configuration and the configuration they chose, then --image and the image recommended, or the one the person wants instead, then --toolchains and the toolchains it needs${once}`,
    "next: stop",
  ]);
});

test("a bootstrap offered where the person must still choose, as in a listing that may have missed some, is said to be offered, so the filing its rule asks for carries the image", () => {
  const bootstrap: CreationOffer = {
    ...creationOffer(
      creationSummary(
        setupSiteBootstrapRevision(setupSiteRepositoryAddress),
        "Ready",
      ),
    ),
    name: "bootstrap",
    listed: undefined,
  };
  const offers = setupTicketOffersOf({
    context: "Ready",
    offers: [bootstrap],
    partial: true,
    repositories: [],
  });
  expect(offers).toEqual({
    names: ["bootstrap"],
    choose: true,
    bootstrap: false,
    bootstrapOffered: true,
  });
  expect(
    setupTicketWritten(
      { said: { title, intent }, worker: { image, toolchains } },
      true,
      copyTextEn,
    ),
  ).toEqual({ title, intent: `${intent}${carried}` });
});

test("where the project offers several configurations and none is a bootstrap, the ask names no worker image", async () => {
  const machine = await machineSignedIn(live(["development", "review"]));
  const bare = lines(await machine.command(flags));
  expect(bare).not.toContain(recommend);
  expect(bare.join("\n")).not.toContain("--image");
});

test("ticket takes a title and what is wanted done together, a worker image and its toolchains together, or both, and nothing else", () => {
  const wrongly = (fault: string) => ({ asked: "Wrongly", fault });
  expect(setupAsked(["ticket", ...flags])).toEqual(wrongly("Brief"));
  expect(setupAsked(["ticket", ...flags, "--title", title])).toEqual(
    wrongly("Brief"),
  );
  expect(setupAsked(["ticket", ...flags, "--intent", intent])).toEqual(
    wrongly("Brief"),
  );
  expect(setupAsked(["ticket", ...flags, "--image", image])).toEqual(
    wrongly("Image"),
  );
  expect(setupAsked([...filing("--toolchains", toolchains)])).toEqual(
    wrongly("Image"),
  );
  expect(setupAsked(filing())).toMatchObject({
    asked: "Ticket",
    said: { title, intent },
    worker: undefined,
    configuration: undefined,
  });
  expect(setupAsked(["ticket", ...flags, ...worker])).toMatchObject({
    asked: "Ticket",
    said: undefined,
    worker: { image, toolchains },
  });
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
    filing(
      ...(held === "Bootstrap" ? worker : ["--configuration", held[0] ?? ""]),
    ),
  );
  return lines(await machine.command(flags)).find((line) =>
    line.startsWith("tell: "),
  );
}

const told = (ends: string): string =>
  `tell: Ticket 1 is in Work. ${ends} https://chuggy.example/acme/widgets/tickets/1 shows where it is. I'll keep watching it and tell you what changes.`;

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

test("a first ticket on its way is watched: the bare command names watch to run at once, and watch waits on the ticket as long as it was given and names itself again", async () => {
  const machine = await machineSignedIn(setupSiteAt("Moving"));
  const bare = lines(await machine.command(flags));
  expect(bare.slice(-2)).toEqual([
    "rule: Run the command on the next: line now, without asking the person, and tell them what the tell: line says when it differs from what you last told them. It waits while the ticket works, and ends once it needs the person or is done; go on running it while the next: line names it again. Nothing has failed, so do not tell the person that it did or give them a deadline.",
    `next: node ${machineScript} watch ${at}`,
  ]);
  const startedMs = machine.nowMs;
  const report = await machine.command(["watch", ...flags, "--wait-secs", "9"]);
  expect(machine.nowMs - startedMs).toBeGreaterThanOrEqual(9_000);
  expect(lines(report).at(-1)).toBe(`next: node ${machineScript} watch ${at}`);
  expect(machineWrites(machine)).toEqual([]);
});

test("watch ends at its first look where the first ticket is no longer on its way, and says what is next", async () => {
  const machine = await machineSignedIn(setupSiteAt("Landed"));
  const startedMs = machine.nowMs;
  const said = lines(await machine.command(["watch", ...flags]));
  expect(machine.nowMs - startedMs).toBeLessThan(machine.pacing.watchPollMs);
  expect(said.at(-1)).not.toBe(`next: node ${machineScript} watch ${at}`);
  expect(machineWrites(machine)).toEqual([]);
});
