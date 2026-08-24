import { ticketHomeData } from "../app/ticketHome.js";
import { element } from "./render.js";

/** @param {import("../app/ticketHome.js").TicketHomeState} state */
function notice(state) {
  if (state.state === "Data") return [];
  if (state.state === "Loading")
    return [
      element("p", { class: "note", "aria-live": "polite" }, [
        state.load === "Initial"
          ? "Loading tickets…"
          : state.load === "Next"
            ? "Loading more tickets…"
            : "Refreshing tickets…",
      ]),
    ];
  const message =
    state.error.kind === "Deferred"
      ? `${state.error.code} — retry after ${String(state.error.retryAfterSeconds)}s.`
      : state.error.reason;
  return [
    element("p", { class: "note", "data-tone": "halt", role: "alert" }, [
      message,
    ]),
  ];
}

/** @param {{ ticket: number, phase: string, sequence: number }} ticket @param {(ticket: number) => void} onTicket */
function ticketRow(ticket, onTicket) {
  const link = element("a", { href: `#ticket-${String(ticket.ticket)}` }, [
    `Ticket ${String(ticket.ticket)}`,
  ]);
  /** @param {{ preventDefault: () => void }} event */
  const openTicket = (event) => {
    event.preventDefault();
    onTicket(ticket.ticket);
  };
  link.addEventListener("click", openTicket);
  return element("li", {}, [
    element("article", { class: "panel" }, [
      element("div", { class: "panel-head" }, [
        element("h2", {}, [link]),
        element("span", { class: "caption" }, [ticket.phase]),
      ]),
      element("div", { class: "panel-body" }, [
        element("span", { class: "eyebrow" }, ["Latest activity"]),
        element("span", { class: "numeric" }, [
          `Sequence ${String(ticket.sequence)}`,
        ]),
      ]),
    ]),
  ]);
}

/** @param {() => void} onNewTicket */
function newTicketAction(onNewTicket) {
  const button = element(
    "button",
    {
      class: "primary ticket-home-new",
      type: "button",
      style: {
        position: "fixed",
        right: "clamp(1rem, 4vw, 2rem)",
        bottom: "clamp(1rem, 4vw, 2rem)",
        "z-index": "2",
        "border-radius": "999px",
        padding: "0.9rem 1.25rem",
        "box-shadow": "0 0.5rem 1.5rem rgb(0 0 0 / 25%)",
      },
      "aria-label": "Create a new ticket",
    },
    ["＋ New ticket"],
  );
  button.addEventListener("click", onNewTicket);
  return button;
}

/** @param {ReturnType<import("./ticketHomeController.js").createTicketHome>} controller */
export function ticketHomePage(controller) {
  const data = ticketHomeData(controller.state.tickets);
  const refresh = element("button", { type: "button" }, ["Refresh"]);
  refresh.addEventListener("click", () => void controller.refresh());
  const more = element("button", { type: "button" }, ["Load more"]);
  more.addEventListener("click", () => void controller.next());
  const content =
    data === undefined
      ? [
          element("section", { class: "panel" }, [
            element("div", { class: "panel-body" }, [
              element("h2", {}, ["Tickets"]),
              ...notice(controller.state.tickets),
            ]),
          ]),
        ]
      : data.project.tickets.length === 0
        ? [
            ...notice(controller.state.tickets),
            element("p", { class: "note" }, [
              "No tickets have been created for this project.",
            ]),
          ]
        : [
            ...notice(controller.state.tickets),
            element(
              "ol",
              { class: "ticket-home-list" },
              data.project.tickets.map((ticket) =>
                ticketRow(ticket, controller.ticket),
              ),
            ),
          ];
  return element("section", { "aria-labelledby": "ticket-home-title" }, [
    element("div", { class: "registry-actions" }, [
      element("h1", { id: "ticket-home-title" }, ["Tickets"]),
      refresh,
      ...(data?.nextCursor === undefined ? [] : [more]),
    ]),
    ...content,
    newTicketAction(controller.newTicket),
  ]);
}
