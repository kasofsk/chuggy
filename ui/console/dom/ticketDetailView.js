import { ticketDetailActions, ticketDetailHeld } from "../app/ticketDetail.js";
import { element } from "./render.js";

/** @typedef {import("../app/ticketDetail.js").TicketDetailState} TicketDetailState */
/** @typedef {{ state: { detail: TicketDetailState | undefined }, edit: () => void, delete: () => void, release: () => void, openExecution: (execution: string) => void, nextExecutions: () => Promise<void> }} TicketDetailController */

/** @param {import("../app/ticketDetail.js").DetailResource<unknown>} resource @param {string} label */
function notice(resource, label) {
  if (resource.state === "Loading" && resource.held === undefined)
    return element("p", { class: "hatched", "aria-live": "polite" }, [
      `Loading ${label}…`,
    ]);
  if (resource.state !== "Error") return undefined;
  const message =
    resource.error.kind === "Deferred"
      ? `${label} was deferred (${resource.error.code}); retry after ${String(resource.error.retryAfterSeconds)}s.`
      : resource.error.reason;
  return element("p", { class: "note", role: "alert" }, [message]);
}

/** @param {string} label @param {string} value */
function valueLine(label, value) {
  return element("div", { class: "detail-line" }, [
    element("span", { class: "eyebrow" }, [label]),
    element("span", {}, [value]),
  ]);
}

/** @param {ReturnType<import("../app/resources.js").parseDraft>} draft */
function authoringView(draft) {
  const authoring = draft.authoring;
  const pricing =
    typeof authoring.finalizationPricing === "string"
      ? "Deadline only"
      : `Budgeted ${String(authoring.finalizationPricing.value)}`;
  return element(
    "section",
    { class: "panel", "aria-labelledby": "authoring-title" },
    [
      element("div", { class: "panel-head" }, [
        element("h2", { id: "authoring-title" }, ["Ticket authoring"]),
      ]),
      element("div", { class: "panel-body" }, [
        valueLine("State", draft.state),
        valueLine("Authoring version", String(draft.authoringVersion)),
        valueLine(
          "Dependencies",
          authoring.dependencies.length === 0
            ? "None"
            : authoring.dependencies.join(", "),
        ),
        valueLine("Work fanout", String(authoring.workFanout)),
        valueLine("Evaluation stages", String(authoring.program.length)),
        valueLine("Rework", String(authoring.reworkPolicy.value)),
        valueLine("Finalization", pricing),
        valueLine("Resume pricing", authoring.resumePricing),
        valueLine("Finalizer", authoring.finalizer),
      ]),
    ],
  );
}

/** @param {import("../app/ticketDetail.js").ConfigurationState} resource */
function configurationView(resource) {
  if (resource.state === "Waiting")
    return element("p", { class: "hatched", "aria-live": "polite" }, [
      "Waiting for the ticket configuration…",
    ]);
  if (resource.state === "Absent")
    return element("p", { class: "note" }, [
      "This ticket has no retained draft configuration.",
    ]);
  const warning = notice(resource, "configuration");
  const configuration = ticketDetailHeld(resource);
  return element(
    "section",
    { class: "panel", "aria-labelledby": "configuration-title" },
    [
      element("div", { class: "panel-head" }, [
        element("h2", { id: "configuration-title" }, ["Configuration"]),
      ]),
      element("div", { class: "panel-body" }, [
        ...(warning === undefined ? [] : [warning]),
        ...(configuration === undefined
          ? []
          : [
              valueLine("Revision", configuration.revision),
              valueLine("Digest", configuration.digest),
              element("pre", { class: "preview" }, [configuration.canonical]),
            ]),
      ]),
    ],
  );
}

/** @param {import("../app/ticketDetail.js").DetailResource<ReturnType<import("../app/resources.js").parseExecutionsPage>>} resource @param {TicketDetailController} controller */
function executionsView(resource, controller) {
  const warning = notice(resource, "executions");
  const page = ticketDetailHeld(resource);
  const rows = page?.executions ?? [];
  return element(
    "section",
    { class: "panel", "aria-labelledby": "executions-title" },
    [
      element("div", { class: "panel-head" }, [
        element("h2", { id: "executions-title" }, ["Executions"]),
      ]),
      element("div", { class: "panel-body" }, [
        ...(warning === undefined ? [] : [warning]),
        ...(page === undefined
          ? []
          : rows.length === 0
            ? [
                element("p", { class: "empty" }, [
                  "No executions for this ticket.",
                ]),
              ]
            : [
                element(
                  "ul",
                  { class: "execution-list" },
                  rows.map((row) => {
                    const open = element("button", { type: "button" }, [
                      row.execution,
                    ]);
                    open.addEventListener("click", () =>
                      controller.openExecution(row.execution),
                    );
                    return element("li", {}, [
                      open,
                      ` · ${row.taskKind} · ${row.status} · ${row.outcome ?? "No outcome"}`,
                    ]);
                  }),
                ),
              ]),
        ...(page?.nextAfter === undefined
          ? []
          : (() => {
              const more = element("button", { type: "button" }, [
                "Load more executions",
              ]);
              more.addEventListener(
                "click",
                () => void controller.nextExecutions(),
              );
              return [more];
            })()),
      ]),
    ],
  );
}

/** @param {TicketDetailController} controller */
export function ticketDetailPage(controller) {
  const state = controller.state.detail;
  if (state === undefined)
    return element("p", { class: "hatched" }, ["Select a ticket to view it."]);
  const identity = ticketDetailHeld(state.identity);
  const draft = ticketDetailHeld(state.draft);
  const identityWarning = notice(state.identity, "ticket");
  const draftWarning = notice(state.draft, "draft");
  const actions = ticketDetailActions(state);
  const actionButtons = [
    ["Edit", actions.edit, controller.edit],
    ["Delete", actions.delete, controller.delete],
    ["Release", actions.release, controller.release],
  ].flatMap(([label, enabled, callback]) => {
    if (!enabled) return [];
    const button = element("button", { type: "button" }, [label]);
    button.addEventListener("click", callback);
    return [button];
  });
  return element("main", { class: "ticket-detail" }, [
    element("header", { class: "registry-actions" }, [
      element("div", {}, [
        element("span", { class: "eyebrow" }, ["Ticket"]),
        element("h1", {}, [`#${String(state.ticket)}`]),
      ]),
      ...actionButtons,
    ]),
    ...(identityWarning === undefined ? [] : [identityWarning]),
    ...(identity === undefined
      ? []
      : [
          valueLine("Phase", identity.phase),
          valueLine("Latest sequence", String(identity.sequence)),
        ]),
    ...(draftWarning === undefined ? [] : [draftWarning]),
    ...(draft === undefined ? [] : [authoringView(draft)]),
    configurationView(state.configuration),
    executionsView(state.executions, controller),
  ]);
}
