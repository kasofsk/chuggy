/**
 * View models to elements.
 *
 * Every panel is drawn through `panelSection`, which is what makes the
 * freshness caption, the age bar and the no-evidence hatch impossible to omit
 * from a panel by forgetting them.
 */

import {
  freshness,
  freshnessCaption,
  freshnessFraction,
  panelHeld,
} from "../app/panels.js";

export function element(tag, attributes, children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes ?? {})) {
    if (value !== undefined) node.setAttribute(name, String(value));
  }
  for (const child of children ?? []) {
    node.append(
      typeof child === "string" ? document.createTextNode(child) : child,
    );
  }
  return node;
}

function hatchedReason(panel) {
  if (panel.state === "Unknown") return "This panel has not read yet.";
  if (panel.state === "Loading") return "The first read is in flight.";
  if (panel.state === "Deferred")
    return `The server deferred the read: ${panel.code}.`;
  return `The read did not complete. ${panel.reason}`;
}

/**
 * The sentence above a panel that has a value but could not refresh it. A
 * panel with nothing to show gets no note: the hatch below already carries the
 * reason, and "showing the last good read" over an empty panel is a claim
 * about a read that never happened.
 */
function panelNote(panel, held) {
  if (panel.state === "Deferred")
    return element("p", { class: "note", "data-tone": "deferred" }, [
      `${panel.code} — the server asked for ${String(panel.retryAfterSeconds)}s before the next read.`,
    ]);
  if (panel.state === "Unavailable" && held !== undefined)
    return element("p", { class: "note", "data-tone": "halt" }, [
      `Showing the last good read. ${panel.reason}`,
    ]);
  return undefined;
}

/**
 * A panel with no evidence is hatched and says why; one whose newest read
 * failed keeps its last value, dimmed, above the reason it is not newer.
 */
export function panelSection(spec) {
  const verdict = freshness(spec.panel, spec.nowMs);
  const fraction =
    verdict.verdict === "NoEvidence"
      ? 1
      : freshnessFraction(verdict.ageMs, spec.dueMs);
  const held = panelHeld(spec.panel);
  const note = panelNote(spec.panel, held);
  const body =
    held === undefined
      ? [
          element("div", { class: "hatched" }, [
            element("strong", {}, ["No evidence"]),
            hatchedReason(spec.panel),
          ]),
        ]
      : spec
          .body(held.value)
          .map((child) =>
            spec.panel.state === "Ready"
              ? child
              : element("div", { class: "held" }, [child]),
          );
  return element("section", { class: "panel" }, [
    element("div", { class: "panel-head" }, [
      element("span", { class: "eyebrow" }, [spec.title]),
      element("span", { class: "caption", "data-verdict": verdict.verdict }, [
        freshnessCaption(spec.panel, spec.nowMs, spec.asOf),
      ]),
    ]),
    element("div", { class: "age", "data-verdict": verdict.verdict }, [
      element(
        "span",
        { style: `width:${String(Math.round(fraction * 100))}%` },
        [],
      ),
    ]),
    element("div", { class: "panel-body" }, [
      ...(note === undefined ? [] : [note]),
      ...(spec.controls ?? []),
      ...body,
    ]),
  ]);
}

function meter(label, headroom) {
  const filled =
    headroom.limit === 0 ? 100 : (headroom.used / headroom.limit) * 100;
  return element("div", { class: "meter" }, [
    element("div", { class: "meter-line" }, [
      element("span", { class: "eyebrow" }, [label]),
      element("span", { class: "numeric" }, [
        `${String(headroom.used)} / ${String(headroom.limit)}`,
      ]),
    ]),
    element(
      "div",
      { class: "meter-track", "data-exhausted": headroom.exhausted },
      [
        element(
          "span",
          { style: `width:${String(Math.min(filled, 100))}%` },
          [],
        ),
      ],
    ),
  ]);
}

/** The scheduler's freshness claim is printed as the scheduler made it. */
export function schedulerBody(view) {
  const deficit =
    view.reservationDeficit === 0
      ? []
      : [
          element("p", { class: "note", "data-tone": "deferred" }, [
            `${String(view.reservationDeficit)} reservation(s) the account owes are unmet.`,
          ]),
        ];
  return [
    element("div", { class: "hatched" }, [
      element("strong", {}, [
        `Scheduler freshness: ${view.schedulerFreshness}`,
      ]),
      "The scheduler claims no currency for these counts.",
    ]),
    element(
      "div",
      { class: "stages" },
      view.stages.map((stage) =>
        element("div", { class: "stage" }, [
          element("span", { class: "value" }, [String(stage.value)]),
          element("span", { class: "eyebrow" }, [stage.name]),
        ]),
      ),
    ),
    meter("Cluster slots", view.cluster),
    meter("Account slots", view.account),
    ...deficit,
    element("p", { class: "caption" }, [
      `Server observed at ${view.observedAt}`,
    ]),
  ];
}

export function boardBody(view) {
  return [
    element(
      "div",
      { class: "board" },
      view.columns.map((column) =>
        element("div", { class: "column", "data-settled": column.settled }, [
          element("span", { class: "eyebrow" }, [
            `${column.phase} · ${String(column.tickets.length)}`,
          ]),
          column.tickets.length === 0
            ? element("p", { class: "empty" }, ["None in this phase"])
            : element(
                "ul",
                {},
                column.tickets.map((entry) =>
                  element("li", {}, [String(entry.ticket)]),
                ),
              ),
        ]),
      ),
    ),
  ];
}

function table(headings, rows) {
  return element("div", { class: "scroller" }, [
    element("table", {}, [
      element("thead", {}, [
        element(
          "tr",
          {},
          headings.map((heading) => element("th", {}, [heading])),
        ),
      ]),
      element("tbody", {}, rows),
    ]),
  ]);
}

function cells(values) {
  return values.map((value) => element("td", {}, [value ?? "—"]));
}

/** Every candidate row carries its own expected version, and dispatches only that. */
export function candidatesBody(rows, onDispatch) {
  if (rows.length === 0)
    return [
      element("p", { class: "caption" }, [
        "No ticket is dispatchable right now.",
      ]),
    ];
  return [
    table(
      ["Ticket", "Version", "Fanout", "Revision", ""],
      rows.map((row) => {
        const action = element("button", { class: "primary", type: "button" }, [
          "Dispatch",
        ]);
        action.addEventListener("click", () => {
          onDispatch(row);
        });
        return element("tr", {}, [
          ...cells([
            String(row.ticket),
            String(row.ticketVersion),
            String(row.workFanout),
            row.configurationRevision,
          ]),
          element("td", {}, [action]),
        ]);
      }),
    ),
  ];
}

export function executionsBody(rows, onOpen) {
  if (rows.length === 0)
    return [
      element("p", { class: "caption" }, [
        "No execution matches this selection.",
      ]),
    ];
  return [
    table(
      [
        "Execution",
        "Ticket",
        "Kind",
        "Status",
        "Outcome",
        "Retries",
        "Cluster",
      ],
      rows.map((row) => {
        const identity = element("button", { type: "button" }, [row.execution]);
        identity.addEventListener("click", () => {
          onOpen(row);
        });
        return element("tr", { "data-active": row.active }, [
          element("td", {}, [identity]),
          ...cells([
            String(row.ticket),
            row.taskKind,
            row.status,
            row.outcome,
            String(row.retriesSpent),
            row.cluster,
          ]),
        ]);
      }),
    ),
  ];
}

function attemptsTable(attempts) {
  return table(
    ["Attempt", "Number", "Generation", "State", "Opened", "Ended"],
    attempts.map((attempt) =>
      element(
        "tr",
        {},
        cells([
          attempt.attempt,
          String(attempt.number),
          String(attempt.generation),
          attempt.state,
          attempt.openedAt,
          attempt.endedAt,
        ]),
      ),
    ),
  );
}

function artifactsTable(artifacts, onPreview) {
  return table(
    ["Ordinal", "Role", "Path", "Bytes", ""],
    artifacts.map((artifact) => {
      const open = element(
        "button",
        {
          type: "button",
          ...(artifact.renderer === undefined ? { disabled: "" } : {}),
        },
        [artifact.renderer === undefined ? "No preview" : "Preview"],
      );
      open.addEventListener("click", () => {
        onPreview(artifact);
      });
      return element("tr", {}, [
        ...cells([
          String(artifact.ordinal),
          artifact.role,
          artifact.path,
          String(artifact.bytes),
        ]),
        element("td", {}, [open]),
      ]);
    }),
  );
}

/** The detail an operator opens by hand; it is not part of the refresh loop. */
export function executionDetailBody(detail, onPreview, preview) {
  const result =
    detail.result === undefined
      ? element("p", { class: "caption" }, ["No result has been recorded."])
      : element("div", {}, [
          element("p", { class: "caption" }, [
            `Verdict ${detail.result.verdict}, recorded at ${detail.result.recordedAt}`,
          ]),
          artifactsTable(detail.result.artifacts, onPreview),
        ]);
  return [
    element("p", { class: "caption" }, [
      `Ticket ${String(detail.ticket)} · ${detail.taskKind} · ${detail.status}` +
        ` · registered ${detail.registeredAt}`,
    ]),
    element("span", { class: "eyebrow" }, ["Attempts"]),
    attemptsTable(detail.attempts),
    element("span", { class: "eyebrow" }, ["Result"]),
    result,
    ...(preview === undefined
      ? []
      : [element("pre", { class: "preview" }, [preview])]),
  ];
}

function operationLine(step) {
  if (step.step === "Settled")
    return `Ticket ${String(step.ticket)} — ${step.state}${
      step.refusalCode === undefined ? "" : ` (${step.refusalCode})`
    }`;
  if (step.step === "Backlogged")
    return `Ticket ${String(step.ticket)} — ${step.code}, retry in ${String(step.retryAfterSeconds)}s`;
  if (step.step === "Abandoned")
    return `Ticket ${String(step.ticket)} — stopped following: ${step.reason}`;
  if (step.step === "Following")
    return `Ticket ${String(step.ticket)} — following ${step.operation}`;
  return `Ticket ${String(step.ticket)} — submitting`;
}

function operationTone(step) {
  if (step.step === "Backlogged") return "deferred";
  if (step.step === "Abandoned") return "halt";
  if (step.step === "Settled" && step.state !== "Succeeded") return "halt";
  return "plain";
}

export function operationsBody(steps) {
  if (steps.length === 0)
    return [
      element("p", { class: "caption" }, ["No dispatch has been submitted."]),
    ];
  return [
    element(
      "ul",
      { class: "log" },
      steps.map((step) =>
        element("li", { class: "note", "data-tone": operationTone(step) }, [
          operationLine(step),
        ]),
      ),
    ),
  ];
}
