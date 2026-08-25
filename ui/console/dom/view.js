/**
 * The whole page, drawn from the console's state.
 *
 * The tree is rebuilt on each change rather than patched: the console is small,
 * and one drawing path is what keeps a panel from acquiring a second way to
 * render itself without its freshness.
 */

import {
  board,
  candidateRows,
  executionRows,
  scheduler,
} from "../app/views.js";
import { readers } from "./console.js";
import { configurationRegistryPage } from "./configurationRegistryView.js";
import { ticketCreationPage } from "./ticketCreationView.js";
import { ticketDetailPage } from "./ticketDetailView.js";
import { ticketHomePage } from "./ticketHomeView.js";
import {
  boardBody,
  candidatesBody,
  element,
  executionDetailBody,
  executionsBody,
  operationsBody,
  panelSection,
  schedulerBody,
} from "./render.js";

const bodies = {
  status: (value) => schedulerBody(scheduler(value)),
  tickets: (value) => boardBody(board(value.tickets)),
  candidates: (value, controller) =>
    value.result === "Reset"
      ? [
          element("p", { class: "note", "data-tone": "deferred" }, [
            "The dispatch snapshot moved under the read; the next one starts over.",
          ]),
        ]
      : candidatesBody(candidateRows(value), (row) => {
          void controller.dispatch(row);
        }),
  executions: (value, controller) =>
    executionsBody(executionRows(value), (row) => {
      void controller.openDetail(row.execution);
    }),
};

/** The selections the server owns; the console sends a name, never a phase list it invented. */
const filters = {
  tickets: {
    cursor: "phases",
    choices: [
      { label: "All phases", selection: { selection: "All" } },
      { label: "Non-terminal", selection: { selection: "NonTerminal" } },
    ],
  },
  executions: {
    cursor: "states",
    choices: [
      { label: "Non-terminal", selection: { selection: "NonTerminal" } },
      { label: "All states", selection: { selection: "All" } },
    ],
  },
};

function filterControls(reader, controller) {
  const filter = filters[reader.name];
  if (filter === undefined) return [];
  const chosen = controller.state.cursor[filter.cursor].selection;
  return [
    element(
      "p",
      { class: "caption" },
      filter.choices.map((choice) => {
        const button = element(
          "button",
          {
            type: "button",
            ...(choice.selection.selection === chosen
              ? { class: "primary" }
              : {}),
          },
          [choice.label],
        );
        button.addEventListener("click", () => {
          controller.filter(filter.cursor, choice.selection);
        });
        return button;
      }),
    ),
  ];
}

function panelFor(reader, controller, nowMs) {
  return panelSection({
    title: reader.title,
    panel: controller.state.panels[reader.name],
    nowMs,
    dueMs: controller.dueMs(reader.name),
    asOf: reader.asOf,
    controls: filterControls(reader, controller),
    body: (value) => bodies[reader.name](value, controller),
  });
}

function detailPanel(controller, nowMs) {
  const detail = controller.state.detail;
  if (detail === undefined) return undefined;
  return panelSection({
    title: `Execution ${detail.execution}`,
    panel: detail.panel,
    nowMs,
    dueMs: 1,
    asOf: "Read",
    body: (value) =>
      executionDetailBody(
        value,
        (artifact) => {
          void controller.previewArtifact(artifact.ordinal);
        },
        detail.preview,
      ),
  });
}

function operationsPanel(controller, nowMs) {
  return panelSection({
    title: "Dispatch operations",
    panel: {
      state: "Ready",
      value: controller.state.operations,
      observedAtMs: nowMs,
    },
    nowMs,
    dueMs: 1,
    asOf: "Updated",
    body: (value) => operationsBody(value),
  });
}

function projectOptions(controller) {
  const chosen = controller.state.partition;
  const placeholder =
    chosen === undefined
      ? [element("option", { value: "" }, ["Choose a project"])]
      : [];
  return [
    ...placeholder,
    ...controller.state.projects.map((partition) =>
      element(
        "option",
        {
          value: JSON.stringify(partition),
          ...(chosen !== undefined &&
          chosen.tenant === partition.tenant &&
          chosen.project === partition.project
            ? { selected: "" }
            : {}),
        },
        [`${partition.tenant} / ${partition.project}`],
      ),
    ),
  ];
}

function refreshControls(controller) {
  if (controller === undefined || controller.state.partition === undefined)
    return [];
  const stopped = controller.stopped();
  const button = element("button", { type: "button" }, [
    stopped ? "Resume" : "Pause",
  ]);
  button.addEventListener("click", () => {
    if (stopped) controller.resume();
    else controller.pause();
  });
  return [
    element("span", { class: "eyebrow" }, [
      stopped ? "Refresh stopped" : "Refreshing",
    ]),
    button,
  ];
}

function sessionControls(page) {
  if (page.boot.step !== "SignedIn")
    return [element("span", { class: "eyebrow" }, ["Not signed in"])];
  const out = element("button", { type: "button" }, ["Sign out"]);
  out.addEventListener("click", page.onSignOut);
  return [
    element("span", { class: "numeric" }, [page.label ?? "signed in"]),
    out,
  ];
}

function standingReason(page) {
  if (page.boot.step !== "SignedIn") return page.boot.reason;
  return page.controller.state.projects.length === 0
    ? "No project is visible to this account."
    : "Choose a project to read.";
}

/**
 * Signed out, unconfigured, faulted or unchosen. It is deliberately not a
 * panel: there is no reading to be old, so there is nothing to hatch.
 */
function standingCard(page) {
  const action = element("button", { class: "primary", type: "button" }, [
    "Sign in",
  ]);
  action.addEventListener("click", page.onSignIn);
  return element("section", { class: "panel" }, [
    element("div", { class: "standing-body" }, [
      element("span", { class: "eyebrow" }, ["Session"]),
      element(
        "p",
        {
          class: "note",
          "data-tone": page.boot.step === "Faulted" ? "halt" : "plain",
        },
        [standingReason(page)],
      ),
      ...(page.boot.step === "SignedOut" ? [action] : []),
    ]),
  ]);
}

export function draw(page) {
  const controller = page.controller;
  page.session.replaceChildren(...sessionControls(page));
  page.refresh.replaceChildren(...refreshControls(controller));
  page.select.replaceChildren(
    ...(controller === undefined
      ? [element("option", { value: "" }, ["Not loaded"])]
      : projectOptions(controller)),
  );
  page.select.disabled =
    controller === undefined || controller.state.projects.length === 0;
  drawNavigation(page);
  if (controller === undefined || controller.state.partition === undefined) {
    page.host.className = "console standing";
    page.host.replaceChildren(standingCard(page));
    return;
  }
  if (page.route.page === "Configurations") {
    page.host.className = "registry-shell";
    page.host.replaceChildren(configurationRegistryPage(page.registry));
    return;
  }
  if (page.route.page === "Home") {
    page.host.className = "ticket-page";
    page.host.replaceChildren(ticketHomePage(page.ticketHome));
    return;
  }
  if (page.route.page === "NewTicket") {
    page.host.className = "ticket-page";
    page.host.replaceChildren(ticketCreationPage(page.ticketCreation));
    return;
  }
  if (page.route.page === "Ticket") {
    page.host.className = "ticket-page";
    page.host.replaceChildren(ticketDetailPage(page.ticketDetail));
    return;
  }
  const named = Object.fromEntries(
    readers
      .filter((reader) => reader.name !== "notifications")
      .map((reader) => [reader.name, panelFor(reader, controller, page.nowMs)]),
  );
  const detail = detailPanel(controller, page.nowMs);
  page.host.className = "console";
  page.host.replaceChildren(
    element("div", {}, [
      named["status"],
      operationsPanel(controller, page.nowMs),
    ]),
    element("div", {}, [
      named["tickets"],
      named["candidates"],
      named["executions"],
      ...(detail === undefined ? [] : [detail]),
    ]),
  );
}

function drawNavigation(page) {
  const entries = [
    [page.homePage, "Home"],
    [page.operationsPage, "Operations"],
    [page.configurationsPage, "Configurations"],
  ];
  for (const [button, name] of entries) {
    const selected = page.route.page === name;
    button.className = selected ? "primary" : "";
    button.setAttribute("aria-current", selected ? "page" : "false");
  }
}
