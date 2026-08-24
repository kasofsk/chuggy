import { configurationRegistryData } from "../app/configurationRegistry.js";
import { releaseDraftMutation } from "../app/protocol.js";
import { routeParsed, routePath } from "../app/routes.js";
import { ticketDetailHeld } from "../app/ticketDetail.js";
import { createConfigurationRegistry } from "./configurationRegistryController.js";
import { createConsole } from "./console.js";
import { createSession } from "./session.js";
import { createTicketCreation } from "./ticketCreationController.js";
import { createTicketDetail } from "./ticketDetailController.js";
import { createTicketHome } from "./ticketHomeController.js";
import { send } from "./transport.js";
import { draw } from "./view.js";

const nowMs = () => Date.now();
const session = createSession(nowMs);
const page = {
  host: document.getElementById("console"),
  select: document.getElementById("project"),
  session: document.getElementById("session"),
  refresh: document.getElementById("refresh"),
  homePage: document.getElementById("home-page"),
  operationsPage: document.getElementById("operations-page"),
  configurationsPage: document.getElementById("configurations-page"),
  route: routeParsed(location.pathname),
  boot: { step: "Loading", reason: "Reading the console configuration…" },
  label: undefined,
  controller: undefined,
  registry: undefined,
  ticketHome: undefined,
  ticketCreation: undefined,
  ticketDetail: undefined,
  nowMs: nowMs(),
  onSignIn: () => settle(session.beginSignIn()),
  onSignOut: () => {
    session.signOut();
    page.controller?.pause();
    page.controller = undefined;
    page.registry = undefined;
    page.ticketHome = undefined;
    page.ticketCreation = undefined;
    page.ticketDetail = undefined;
    page.boot = { step: "SignedOut", reason: "Signed out of this tab." };
    changed();
  },
};

function changed() {
  page.nowMs = nowMs();
  draw(page);
}

function settle(promise) {
  promise.catch(() => {
    page.boot = {
      step: "Faulted",
      reason:
        "The console hit an error it could not place. Reload to try again.",
    };
    changed();
  });
}

async function activateRoute(route, replace = false) {
  page.route = route;
  history[replace ? "replaceState" : "pushState"](null, "", routePath(route));
  const partition = page.controller?.state.partition;
  if (partition !== undefined && route.page === "NewTicket") {
    const data = configurationRegistryData(page.registry.state.registry);
    page.ticketCreation.selectProject(partition, data?.configurations ?? []);
  }
  if (partition !== undefined && route.page === "Ticket")
    await page.ticketDetail.select(partition, route.ticket);
  changed();
}

page.select.addEventListener("change", () => {
  const chosen = page.select.value;
  if (chosen.length === 0) return;
  const partition = JSON.parse(chosen);
  page.controller?.select(partition);
  settle(
    Promise.all([
      page.registry?.select(partition),
      page.ticketHome?.select(partition),
    ]).then(() => activateRoute(page.route, true)),
  );
});
page.homePage.addEventListener("click", () =>
  settle(activateRoute({ page: "Home" })),
);
page.operationsPage.addEventListener("click", () =>
  settle(activateRoute({ page: "Operations" })),
);
page.configurationsPage.addEventListener("click", () =>
  settle(activateRoute({ page: "Configurations" })),
);
globalThis.addEventListener("popstate", () =>
  settle(activateRoute(routeParsed(location.pathname), true)),
);

function createTicketControllers() {
  page.ticketHome = createTicketHome({
    session,
    send,
    onChanged: changed,
    onTicket: (ticket) => settle(activateRoute({ page: "Ticket", ticket })),
    onNewTicket: () => settle(activateRoute({ page: "NewTicket" })),
  });
  page.ticketCreation = createTicketCreation({
    session,
    send,
    onChanged: changed,
    onRelease: (event) => {
      const mutation = releaseDraftMutation(
        event.ticket,
        event.authoringVersion,
        event.configurationRevision,
      );
      void page.controller
        .submitMutation(event.ticket, mutation)
        .then((result) => page.ticketCreation.releaseAnswered(result));
    },
    onNavigate: (ticket) => settle(activateRoute({ page: "Ticket", ticket })),
  });
  page.ticketDetail = createTicketDetail({
    session,
    send,
    onChanged: changed,
    onEdit: () => undefined,
    onDelete: () => undefined,
    onRelease: (ticket) => {
      const draft = ticketDetailHeld(page.ticketDetail.state.detail.draft);
      if (draft === undefined) return;
      const mutation = releaseDraftMutation(
        ticket,
        draft.authoringVersion,
        draft.configurationRevision,
      );
      void page.controller.submitMutation(ticket, mutation).then((result) => {
        if (result.result === "Succeeded")
          return page.ticketDetail.select(
            page.controller.state.partition,
            ticket,
          );
        return undefined;
      });
    },
    onExecution: (execution) => {
      void activateRoute({ page: "Operations" }).then(() =>
        page.controller.openDetail(execution),
      );
    },
    onArtifact: (execution, ordinal) => {
      void activateRoute({ page: "Operations" }).then(async () => {
        await page.controller.openDetail(execution);
        await page.controller.previewArtifact(ordinal);
      });
    },
  });
}

async function signedIn() {
  page.boot = { step: "SignedIn", reason: "" };
  page.label = session.label();
  page.controller = createConsole({ session, nowMs, send, onChanged: changed });
  page.registry = createConfigurationRegistry({
    session,
    send,
    onChanged: changed,
  });
  createTicketControllers();
  changed();
  await page.controller.loadProjects();
}

async function callback() {
  const outcome = await session.completeSignIn(location.search);
  history.replaceState(null, "", "/");
  page.route = { page: "Home" };
  if (outcome.result === "Denied")
    page.boot = {
      step: "SignedOut",
      reason: `Sign-in did not complete: ${outcome.reason}`,
    };
}

async function boot() {
  changed();
  try {
    await session.load();
  } catch {
    page.boot = {
      step: "Faulted",
      reason:
        "This deployment has no readable /config.json, or its issuer did not answer.",
    };
    changed();
    return;
  }
  if (location.pathname === session.redirectPath()) await callback();
  if (session.signedIn()) return signedIn();
  if (page.boot.step !== "SignedOut")
    page.boot = {
      step: "SignedOut",
      reason: "Sign in to read this installation.",
    };
  changed();
}

settle(boot());
