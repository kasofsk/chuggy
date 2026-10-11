/**
 * The one next thing, from where a person stands on each step of setup.
 *
 * The first step that is not done decides it. This program does one step
 * itself, the runner's, and it never prints a `next:` it cannot run, so for
 * every other step what it names is a page of the console by its full address
 * and what is pressed there, and the checklist is read again only once the
 * person says the step is done. The runner's step changes the machine, so it
 * is offered and never run unasked: the person is told what `runner` would
 * put here, and the command is named under a rule that waits on their yes;
 * where the machine could not take a runner, they are told that instead.
 * `setupMend` is where each thing a step can lack is turned into its next
 * thing; the slice that gives a step its command changes that step's line
 * there and nowhere else. A tell says of a page only what is pressed there:
 * whether a step is done is this program's to say, from the reads, and never
 * a page's. A step that was not read is said as that: a read the site refused
 * or cut short is the person's to take up, and one that failed is a failure.
 * Where which project is meant is still open, the next thing is the question,
 * one flag at a time.
 */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { forgeInstallLabel } from "./forgeInstallation.ts";
import { inviteRoutePath } from "./inviteLinks.ts";
import { invitePageWords } from "./invitePage.ts";
import { projectCreationPathIn } from "./projectCreation.ts";
import {
  repositoryGrantLines,
  repositoryLabel,
} from "./projectRepositories.ts";
import { runnerPackageOffered } from "./runners.ts";
import { selectorSettingsSection } from "./selectorSettingsForm.ts";
import { settingsRoutes } from "./settingsNav.ts";
import type { SetupAnswers } from "./setupArguments.ts";
import type { SetupChoice } from "./setupReads.ts";
import type { SetupNext, SetupThing } from "./setupReport.ts";
import type { SetupRunnerHere } from "./setupRunnerMachine.ts";
import {
  setupDockerBarredTold,
  setupEngineNeedsPassword,
  setupEnginesNone,
  setupMacNone,
} from "./setupRunnerSaid.ts";
import type { SetupLack, SetupStanding, SetupStep } from "./setupStanding.ts";
import { setupListed } from "./setupText.ts";
import { navRoutes } from "./shellNav.ts";

/**
 * What is pressed on the console's pages, by the name each page draws. The
 * pages write these names themselves and core has no constant for them, so a
 * case reads each page's source for its name and fails where a page renamed it.
 */
export const setupPressed = {
  projectPage: "New project",
  projectCreate: "Create project",
  edit: "Edit",
  save: "Save changes",
  connect: "Connect GitHub",
  add: "Add",
  retry: "Retry",
  runner: "Add runner",
  ticket: "Create ticket",
  dispatch: "Dispatch",
} as const;

/** How many names a question lists before it says how many more there are. */
export const setupAskNamesMax = 12;

/** Where the pages a step is done on are: the site, and the workspace and project as far as the checklist is of one. */
interface SetupAt {
  readonly site: string;
  readonly workspace: string;
  readonly project: string;
}

function setupPage(at: SetupAt, route: string): string {
  return `${at.site}${route
    .replace("$tenant", encodeURIComponent(at.workspace))
    .replace("$project", encodeURIComponent(at.project))}`;
}

function setupTicketPage(at: SetupAt, ticket: number): string {
  return `${setupPage(at, navRoutes.overview)}/tickets/${String(ticket)}`;
}

function setupHand(tell: string, when: string): SetupThing {
  return { thing: "Hand", tell, when };
}

const setupLookAgain = "if the person asks to look again";

function setupWorkspaceMend(
  lack: Extract<SetupLack, { readonly lacks: "Workspace" | "Administration" }>,
  at: SetupAt,
): SetupThing {
  if (lack.lacks === "Administration")
    return setupHand(
      `Setting chuggy up takes an admin of the workspace, and you are not one in ${lack.workspace}. Ask an admin of ${lack.workspace} to make you one on its People page, ${setupPage(at, settingsRoutes.workspace.people)}. Tell me once you are an admin.`,
      `once the person says they are an admin of ${lack.workspace}`,
    );
  const none =
    lack.workspace === undefined
      ? "You are not in a chuggy workspace yet."
      : `You are not in a chuggy workspace named ${lack.workspace}.`;
  return setupHand(
    `${none} A new workspace is made from an invite link: open the one you were sent (it starts ${at.site}${inviteRoutePath}), and under ${invitePageWords.naming} name the workspace and press ${invitePageWords.create}. Tell me once it is made.`,
    "once the person says their workspace is made",
  );
}

function setupProjectMend(
  lack: Extract<SetupLack, { readonly lacks: "Project" | "NorthStar" }>,
  at: SetupAt,
): SetupThing {
  if (lack.lacks === "Project")
    return setupHand(
      `Open ${at.site}${projectCreationPathIn(at.workspace)}, the ${setupPressed.projectPage} page, name the project and press ${setupPressed.projectCreate}. Tell me once it is made.`,
      "once the person says the project is made",
    );
  const section = selectorSettingsSection("northStar").title;
  return setupHand(
    `Open ${setupPage(at, settingsRoutes.project.lead)}, press ${setupPressed.edit} beside ${section}, write a paragraph that says what the project is for, and press ${setupPressed.save}. Tell me once it is saved.`,
    `once the person says the ${section} is saved`,
  );
}

/** An app that is installed and not let into the repository: the picker draws a line for it under its list, with a link to that app's own page on the forge. */
function setupGrantMend(
  lack: Extract<SetupLack, { readonly lacks: "Grant" }>,
  page: string,
): SetupThing {
  const line = repositoryGrantLines[lack.app];
  return setupHand(
    `The ${lack.app} app is installed on ${lack.account}, and GitHub does not let it into ${lack.repository}. Open ${page}, press ${setupPressed.add}, and under the list find ${line.status}. Follow the link beside it, ${line.label}, and on GitHub add ${lack.repository} to the repositories the app may reach. Tell me once it is granted.`,
    `once the person says the ${lack.app} app is granted ${lack.repository}`,
  );
}

function setupGithubMend(
  lack: Extract<SetupLack, { readonly lacks: "Account" | "App" | "Grant" }>,
  at: SetupAt,
): SetupThing {
  const page = setupPage(at, navRoutes.repositories);
  if (lack.lacks === "Grant") return setupGrantMend(lack, page);
  if (lack.lacks === "Account")
    return setupHand(
      `Open ${page} and press ${setupPressed.connect}, then install the chuggy app on the GitHub account that owns your repository. Tell me once GitHub is connected.`,
      "once the person says GitHub is connected",
    );
  if (lack.app === "worker") {
    const install = forgeInstallLabel(lack.app);
    return setupHand(
      `Open ${page} and press ${install}, then install it on ${lack.account}. Where ${lack.account} is an organisation you do not own, GitHub asks its owner for you and this waits on them. Tell me once it is installed.`,
      `once the person says the worker app is installed on ${lack.account}`,
    );
  }
  return setupHand(
    `Open ${setupPage(at, settingsRoutes.workspace.accounts)}, the workspace's accounts page, and press ${setupPressed.connect}, so chuggy is shown ${lack.account}. Tell me once GitHub is connected.`,
    "once the person says GitHub is connected",
  );
}

function setupRepositoryMend(
  lack: Extract<SetupLack, { readonly lacks: "Binding" | "Configuration" }>,
  at: SetupAt,
  mine: string | undefined,
): SetupThing {
  const page = setupPage(at, navRoutes.repositories);
  if (lack.lacks === "Binding")
    return setupHand(
      `Open ${page}, press ${setupPressed.add} and choose ${mine === undefined ? "your repository" : `${mine}, this folder's repository`}. Tell me once it is added.`,
      "once the person says the repository is added",
    );
  return setupHand(
    `${lack.repository} is added, but chuggy has not read its configuration. Open ${page} and press ${setupPressed.retry} on the row for ${lack.repository}; if it still cannot, the row then says why. Tell me once ${setupPressed.retry} has answered.`,
    `once the person says ${setupPressed.retry} has answered for ${lack.repository}`,
  );
}

/** Something `runner` would do on this machine for the checklist's project, which waits on the person's yes. */
function setupOffer(tell: string, at: SetupAt): SetupThing {
  const { workspace, project } = at;
  return {
    thing: "Offer",
    tell,
    when: "once the person says yes to a runner on this machine",
    workspace,
    project,
  };
}

const setupRunnerIs =
  "The next step is a runner: the machine that does the work on your tickets";

const setupRunnerRunning = "once the person says the runner is running";

/** A runner registered and not running: started here on the person's yes where this machine holds a registration for the project, and otherwise theirs to start where it is. */
function setupRunnerLiveMend(
  at: SetupAt,
  here: SetupRunnerHere | undefined,
): SetupThing {
  return here?.held === true
    ? setupOffer(
        `A runner is registered for ${at.workspace}/${at.project} and is not running, and this machine holds a registration for that project. With your yes I will check it and start it here as a background service of yours that starts when you log in, registering this machine again first if the site no longer knows that registration, so work on your tickets runs on this machine in containers, on your Claude plan. Tell me yes to go ahead.`,
        at,
      )
    : setupHand(
        "A runner is registered and is not running. Start it on its machine and tell me once it is running.",
        setupRunnerRunning,
      );
}

/**
 * No runner yet. Where this machine could take one the person is told what
 * `runner` would put here before it may be run; where it could not, why not;
 * and where the machine was not looked at, the console's own page.
 */
function setupRunnerMend(
  lack: Extract<SetupLack, { readonly lacks: "Runner" | "RunnerLive" }>,
  at: SetupAt,
  here: SetupRunnerHere | undefined,
): SetupThing {
  if (lack.lacks === "RunnerLive") return setupRunnerLiveMend(at, here);
  const page = setupPage(at, navRoutes.runners);
  const pressed = `press ${setupPressed.runner}`;
  const elsewhere = `Open ${page} and ${pressed}, then do what it shows on the machine that will run the work. Tell me once the runner is running.`;
  const instead = `For a runner on another machine instead, open ${page} there and ${pressed}, and tell me once it is running.`;
  const room = here?.room;
  switch (room?.room) {
    case undefined:
      return setupHand(elsewhere, setupRunnerRunning);
    case "Open":
      return setupOffer(
        `${setupRunnerIs}. I can make this machine one. That puts here the runner package, ${runnerPackageOffered.program}, and a background service of yours that starts when you log in; work on your tickets then runs on this machine in containers, on your Claude plan. Tell me yes to go ahead. For a runner on another machine instead, that machine's own browser opens ${page}, where you ${pressed}.`,
        at,
      );
    case "Mac":
      return setupHand(
        `${setupRunnerIs}. This machine is a Mac and ${setupMacNone}, so it cannot be one. A runner needs a machine with ${runnerPackageOffered.needs}: on one, open ${page}, ${pressed} and do what it shows there. Tell me once the runner is running.`,
        setupRunnerRunning,
      );
    case "Serviceless":
      return setupHand(
        `${setupRunnerIs}. chuggy setup runs one as a background service of yours, and this machine's user services did not answer, so it cannot set one up here. ${elsewhere}`,
        setupRunnerRunning,
      );
    case "Engineless":
      return setupHand(
        `${setupRunnerIs}, in containers. This machine cannot be one yet: ${setupEnginesNone(room.asked)} here without a password. ${setupEngineNeedsPassword} Tell me once one answers you here. ${instead}`,
        "once the person says a container engine answers them on this machine, or that a runner is running",
      );
    case "DockerBarred": {
      const told = setupDockerBarredTold(room.user, room.how);
      return setupHand(
        `${setupRunnerIs}, in containers. This machine cannot be one yet. ${told.why} ${told.state}. ${told.mend} ${instead}`,
        `${told.when}, or that a runner is running`,
      );
    }
  }
}

function setupTicketMend(
  lack: Extract<
    SetupLack,
    {
      readonly lacks:
        "Ticket" | "Release" | "Dispatch" | "Landing" | "Decision";
    }
  >,
  at: SetupAt,
): SetupThing {
  const create = `Open ${setupPage(at, navRoutes.ticketNew)}, say what you want done and press ${setupPressed.ticket}`;
  const created = "once the person says the ticket is created";
  switch (lack.lacks) {
    case "Ticket":
      return setupHand(`${create}. Tell me once it is created.`, created);
    case "Release":
      return setupHand(
        `Ticket ${String(lack.ticket)} was drafted and never released, so nothing is working on it, and the console has no page that releases it. ${create}, which makes a ticket and releases it at once. Tell me once it is created.`,
        created,
      );
    case "Dispatch":
      return setupHand(
        `Ticket ${String(lack.ticket)} is released and has not started. Open ${setupTicketPage(at, lack.ticket)} and press ${setupPressed.dispatch} to start it. Tell me once it has started.`,
        `once the person says ticket ${String(lack.ticket)} has started`,
      );
    case "Landing":
      return setupHand(
        `Ticket ${String(lack.ticket)} is in ${lack.phase}, and setup is done when it lands. ${setupTicketPage(at, lack.ticket)} shows where it is. Tell me when you want me to look again.`,
        setupLookAgain,
      );
    case "Decision":
      return setupHand(
        `Ticket ${String(lack.ticket)} is escalated: it waits on a decision of yours at ${setupTicketPage(at, lack.ticket)}. Tell me once it is moving again.`,
        `once the person says ticket ${String(lack.ticket)} is moving again`,
      );
  }
}

/** A step that was not read: a failure where the read failed or was never asked, and otherwise the person's to take up with whoever can show it to them. */
function setupUnreadMend(
  lack: Extract<SetupLack, { readonly lacks: "Read" }>,
  step: SetupStep,
): SetupThing {
  const said = `the ${step.step} step is not read: ${step.detail}`;
  switch (lack.fate.fate) {
    case "Failed":
      return {
        thing: "Failed",
        found: said,
        stale: lack.fate.outcome === "Unreadable",
      };
    case "Unasked":
      return { thing: "Failed", found: said, stale: false };
    case "Refused":
      return setupHand(
        `The chuggy site does not show you what the ${step.step} step is read from, so I cannot say whether it is done. An admin of the workspace can see it, or can give you the access to. Tell me if your access changes.`,
        "if the person says their access has changed",
      );
    case "Cut":
      return setupHand(
        `The chuggy site sent only part of what the ${step.step} step is read from, so I cannot say whether it is done. Tell me if you want me to look again.`,
        setupLookAgain,
      );
  }
}

/**
 * How each thing a step lacks is mended: today, by the person, on a page of
 * the console. The slice that can do a step itself changes that step's line
 * here, and what stands on either side of it stays as it is.
 */
function setupMend(
  step: SetupStep,
  lack: SetupLack,
  at: SetupAt,
  mine: string | undefined,
  here: SetupRunnerHere | undefined,
): SetupThing {
  switch (lack.lacks) {
    case "Read":
      return setupUnreadMend(lack, step);
    case "Workspace":
    case "Administration":
      return setupWorkspaceMend(lack, at);
    case "Project":
    case "NorthStar":
      return setupProjectMend(lack, at);
    case "Account":
    case "App":
    case "Grant":
      return setupGithubMend(lack, at);
    case "Binding":
    case "Configuration":
      return setupRepositoryMend(lack, at, mine);
    case "Runner":
    case "RunnerLive":
      return setupRunnerMend(lack, at, here);
    case "Ticket":
    case "Release":
    case "Dispatch":
    case "Landing":
    case "Decision":
      return setupTicketMend(lack, at);
  }
}

/** The question a choice still open is put as, with the names it is among as far as the site sent them. */
function setupAsk(
  choice: Extract<SetupChoice, { readonly choice: "Open" }>,
): SetupThing {
  const of =
    choice.open === "workspace"
      ? "Which workspace"
      : `Which project of ${choice.workspace ?? ""}`;
  const shown = choice.among.slice(0, setupAskNamesMax);
  const more = choice.among.length - shown.length;
  const names =
    more > 0
      ? `${shown.join(", ")} and ${String(more)} more`
      : setupListed(shown);
  const part = choice.whole
    ? ""
    : " The site sent only part of the list, so the one meant may not be named here.";
  const among = shown.length === 0 ? "?" : `: ${names}?`;
  return {
    thing: "Ask",
    ask: `${of} is this for${among}${part} Pass the name as --${choice.open}.`,
    flag: choice.open,
  };
}

/** The workspace and project a checklist's commands carry: none where there was nothing to choose, and otherwise the choice as far as it is made. */
function setupCarried(
  choice: SetupChoice,
  answers: SetupAnswers,
): SetupAnswers {
  if (choice.choice === "Made")
    return choice.by === "Only"
      ? answers
      : { workspace: choice.workspace, project: choice.project };
  return choice.open === "workspace"
    ? { workspace: undefined, project: answers.project }
    : { workspace: choice.workspace, project: undefined };
}

/** Setup said to be done in the ticket step's own words, so a pull request that was opened is not said to have landed. */
function setupDoneThing(standing: SetupStanding, at: SetupAt): SetupThing {
  const ticket = standing.steps.find((step) => step.step === "ticket");
  const how = ticket === undefined ? "" : `: ${ticket.detail}`;
  return {
    thing: "Done",
    tell: `chuggy is set up for ${at.workspace}/${at.project}${how}. The next ticket is made at ${setupPage(at, navRoutes.ticketNew)}.`,
  };
}

/** The project whose runner step is the one next, which is when the machine is looked at before the next thing is named. */
export function setupRunnerDue(
  standing: SetupStanding,
): PartitionIdentity | undefined {
  if (standing.choice.choice === "Open") return undefined;
  const { workspace, project } = standing.choice;
  const lacks = standing.steps.find((step) => step.lacks !== undefined)?.lacks;
  if (lacks?.lacks !== "Runner" && lacks?.lacks !== "RunnerLive")
    return undefined;
  return workspace === undefined || project === undefined
    ? undefined
    : { tenant: workspace, project };
}

function setupThing(
  standing: SetupStanding,
  here: SetupRunnerHere | undefined,
): SetupThing {
  if (standing.choice.choice === "Open") return setupAsk(standing.choice);
  const at: SetupAt = {
    site: standing.site,
    workspace: standing.choice.workspace ?? "",
    project: standing.choice.project ?? "",
  };
  const undone = standing.steps.find((step) => step.lacks !== undefined);
  if (undone?.lacks === undefined) return setupDoneThing(standing, at);
  const mine =
    standing.remote === undefined
      ? undefined
      : repositoryLabel(standing.remote.said);
  return setupMend(undone, undone.lacks, at, mine, here);
}

/**
 * Names the one next thing and the choice every command printed with it
 * carries, where `answers` is what the run's own arguments named, which a
 * question about the other name keeps. `here` is what this machine showed
 * where `setupRunnerDue` named a project, and nothing where it was not
 * looked at.
 */
export function setupNext(
  standing: SetupStanding,
  answers: SetupAnswers,
  here?: SetupRunnerHere,
): SetupNext {
  return {
    carried: setupCarried(standing.choice, answers),
    thing: setupThing(standing, here),
  };
}
