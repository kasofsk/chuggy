import { element } from "./render.js";

/** @param {unknown} value */
function valueLabel(value) {
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  if (value !== null && typeof value === "object") {
    const fields = /** @type {Record<string, unknown>} */ (value);
    if (fields["type"] !== undefined)
      return `${String(fields["type"])} ${String(fields["value"] ?? "")}`.trim();
    if (fields["fanout"] !== undefined)
      return `fanout ${String(fields["fanout"])} · ${String(fields["combinator"])}`;
  }
  return JSON.stringify(value);
}

/** @param {string} label @param {readonly unknown[]} choices @param {unknown} selected @param {(value: unknown) => void} changed */
function choice(label, choices, selected, changed) {
  const select = element(
    "select",
    {},
    choices.map((value, index) =>
      element(
        "option",
        {
          value: String(index),
          selected: valueLabel(value) === valueLabel(selected) || undefined,
        },
        [valueLabel(value)],
      ),
    ),
  );
  select.addEventListener("change", () =>
    changed(choices[Number(select.value)]),
  );
  return element("label", { class: "field" }, [
    element("span", { class: "eyebrow" }, [label]),
    select,
  ]);
}

/** @param {string} label @param {readonly unknown[]} choices @param {readonly unknown[]} selected @param {(values: unknown[]) => void} changed */
function choiceSet(label, choices, selected, changed) {
  const inputs = choices.map((value, index) => {
    const input = element("input", {
      type: "checkbox",
      value: String(index),
      checked:
        selected.some((item) => valueLabel(item) === valueLabel(value)) ||
        undefined,
    });
    input.addEventListener("change", () => {
      const next = input.checked
        ? [...selected, value]
        : selected.filter((item) => valueLabel(item) !== valueLabel(value));
      changed(next);
    });
    return element("label", {}, [input, valueLabel(value)]);
  });
  return element("fieldset", {}, [
    element("legend", { class: "eyebrow" }, [label]),
    ...inputs,
  ]);
}

/** @param {any} controller @param {Extract<import("../app/ticketCreation.js").TicketCreationState, {step: "Editing"}>} state */
function programControl(controller, state) {
  const program = state.authoring.program;
  const choices = state.initialization.choices;
  const replace = (index, value) =>
    controller.edit({
      ...state.authoring,
      program: program.map((stage, ordinal) =>
        ordinal === index ? value : stage,
      ),
    });
  const rows = program.map((stage, index) =>
    element("div", { class: "field-row" }, [
      choice(`Stage ${String(index + 1)}`, choices.stages, stage, (value) =>
        replace(index, value),
      ),
      ...(program.length === 1
        ? []
        : [
            (() => {
              const remove = element("button", { type: "button" }, ["Remove"]);
              remove.addEventListener("click", () =>
                controller.edit({
                  ...state.authoring,
                  program: program.filter((_, ordinal) => ordinal !== index),
                }),
              );
              return remove;
            })(),
          ]),
    ]),
  );
  if (program.length < choices.programStagesMax && choices.stages.length > 0) {
    const add = element("button", { type: "button" }, ["Add evaluation stage"]);
    add.addEventListener("click", () =>
      controller.edit({
        ...state.authoring,
        program: [...program, choices.stages[0]],
      }),
    );
    rows.push(add);
  }
  return element("fieldset", {}, [
    element("legend", { class: "eyebrow" }, ["Evaluation program"]),
    ...rows,
  ]);
}

/** @param {unknown} canonical */
function configurationPreview(canonical) {
  let presented = String(canonical);
  try {
    presented = JSON.stringify(JSON.parse(presented), null, 2);
  } catch {
    // Canonical configuration text remains useful when it is not JSON.
  }
  return element("section", { class: "panel" }, [
    element("div", { class: "panel-head" }, [
      element("h2", {}, ["Configuration preview"]),
    ]),
    element("div", { class: "panel-body" }, [element("pre", {}, [presented])]),
  ]);
}

/** @param {any} controller @param {Extract<import("../app/ticketCreation.js").TicketCreationState, {step: "Editing"}>} state */
function authoringControls(controller, state) {
  const edit = (field, value) =>
    controller.edit({ ...state.authoring, [field]: value });
  const choices = state.initialization.choices;
  return [
    choiceSet(
      "Dependencies",
      state.initialization.dependencyCandidates,
      state.authoring.dependencies,
      (value) => edit("dependencies", value),
    ),
    programControl(controller, state),
    choice(
      "Work fanout",
      choices.workFanouts,
      state.authoring.workFanout,
      (value) => edit("workFanout", value),
    ),
    choice(
      "Rework policy",
      choices.reworkPolicies,
      state.authoring.reworkPolicy,
      (value) => edit("reworkPolicy", value),
    ),
    choice(
      "Finalization pricing",
      choices.finalizationPricings,
      state.authoring.finalizationPricing,
      (value) => edit("finalizationPricing", value),
    ),
    choice(
      "Resume pricing",
      choices.resumePricings,
      state.authoring.resumePricing,
      (value) => edit("resumePricing", value),
    ),
    choice(
      "Finalizer",
      choices.finalizers,
      state.authoring.finalizer,
      (value) => edit("finalizer", value),
    ),
  ];
}

/** @param {any} controller @param {Extract<import("../app/ticketCreation.js").TicketCreationState, {step: "Editing"}>} state */
function authoringForm(controller, state) {
  const form = element("form", { class: "ticket-authoring" }, [
    ...authoringControls(controller, state),
    element("button", { type: "submit", class: "primary" }, ["Create draft"]),
  ]);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void controller.submit();
  });
  return element("div", {}, [
    ...(state.issue === undefined
      ? []
      : [
          element("p", { role: "alert", class: "note", "data-tone": "halt" }, [
            state.issue,
          ]),
        ]),
    ...(state.initialization.dependencyCandidatesTruncated
      ? [
          element("p", { class: "note" }, [
            "Only the bounded dependency candidates returned by the server are shown.",
          ]),
        ]
      : []),
    configurationPreview(state.initialization.configuration.canonical),
    form,
  ]);
}

/** @param {any} controller @param {ReturnType<import("../app/resources.js").parseDraft>} draft @param {string | undefined} issue */
function draftPreview(controller, draft, issue) {
  const release = element("button", { type: "button", class: "primary" }, [
    "Release ticket",
  ]);
  release.addEventListener("click", () => controller.release());
  return element("section", { class: "panel" }, [
    element("div", { class: "panel-head" }, [
      element("h2", {}, [`Draft ticket ${String(draft.ticket)}`]),
    ]),
    element("div", { class: "panel-body" }, [
      ...(issue === undefined
        ? []
        : [
            element(
              "p",
              { role: "alert", class: "note", "data-tone": "halt" },
              [issue],
            ),
          ]),
      element("pre", {}, [JSON.stringify(draft.authoring, null, 2)]),
      release,
    ]),
  ]);
}

/** @param {any} controller */
export function ticketCreationPage(controller) {
  const state = controller.state.creation;
  if (state.step === "Choosing") {
    const ready = controller.state.configurations.filter(
      (entry) => entry.readiness === "Ready",
    );
    return element("section", { class: "panel" }, [
      element("div", { class: "panel-head" }, [
        element("h1", {}, ["Create ticket"]),
      ]),
      element(
        "div",
        { class: "panel-body" },
        ready.length === 0
          ? [
              element("p", { role: "status" }, [
                "No Ready configuration revision is available.",
              ]),
            ]
          : ready.map((entry) => {
              const button = element("button", { type: "button" }, [
                entry.revision,
              ]);
              button.addEventListener(
                "click",
                () => void controller.selectRevision(entry.revision),
              );
              return button;
            }),
      ),
    ]);
  }
  if (
    state.step === "Initializing" ||
    state.step === "Creating" ||
    state.step === "Releasing"
  )
    return element("p", { "aria-live": "polite" }, [
      state.step === "Initializing"
        ? "Loading ticket defaults…"
        : state.step === "Creating"
          ? "Creating draft…"
          : "Releasing ticket…",
    ]);
  if (state.step === "InitializationFailed")
    return element("p", { role: "alert", class: "note", "data-tone": "halt" }, [
      state.reason,
    ]);
  if (state.step === "Editing") return authoringForm(controller, state);
  return draftPreview(
    controller,
    state.draft,
    state.step === "ReleaseFailed" ? state.reason : undefined,
  );
}
