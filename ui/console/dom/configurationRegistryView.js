import { configurationRegistry } from "./configurationRegistry.js";
import { element } from "./render.js";

function importFaults(state) {
  if (state.status !== "Rejected") return [];
  return [
    element(
      "ul",
      { class: "fault-list" },
      state.faults.map((fault) =>
        element("li", {}, [
          element("code", {}, [fault.path]),
          `: ${fault.label}${fault.detail === undefined ? "" : ` — ${fault.detail}`}`,
        ]),
      ),
    ),
  ];
}

function importNotice(state) {
  if (state.status === "Editing" && state.issue !== undefined)
    return element("p", { class: "note", role: "alert" }, [state.issue]);
  if (state.status === "Succeeded")
    return element("p", { class: "note", "aria-live": "polite" }, [
      "Configurations imported. The registry has been refreshed.",
    ]);
  if (state.status === "Unavailable")
    return element("p", { class: "note", "data-tone": "halt", role: "alert" }, [
      state.reason,
    ]);
  return undefined;
}

function importForm(controller) {
  const state = controller.state.import;
  const input = element("input", {
    id: "repository-commit",
    name: "commit",
    autocomplete: "off",
    spellcheck: "false",
    value: state.commit,
    disabled: state.status === "Submitting",
  });
  input.addEventListener("input", () => controller.editImport(input.value));
  const form = element("form", {}, [
    element("label", { class: "field", for: "repository-commit" }, [
      element("span", { class: "eyebrow" }, ["Exact Git commit"]),
      input,
    ]),
    element(
      "button",
      {
        class: "primary",
        type: "submit",
        disabled: state.status === "Submitting",
      },
      [state.status === "Submitting" ? "Importing…" : "Import configurations"],
    ),
  ]);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void controller.import();
  });
  const notice = importNotice(state);
  return element(
    "section",
    { class: "panel registry-import", "aria-labelledby": "import-title" },
    [
      element("div", { class: "panel-head" }, [
        element("h2", { id: "import-title" }, ["Import from repository"]),
      ]),
      element("div", { class: "panel-body" }, [
        element("p", { class: "note" }, [
          "Load declarations from .chug/configurations at an immutable commit.",
        ]),
        form,
        ...(notice === undefined ? [] : [notice]),
        ...importFaults(state),
      ]),
    ],
  );
}

export function configurationRegistryPage(controller) {
  const data =
    controller.state.registry.state === "Data"
      ? controller.state.registry
      : controller.state.registry.held;
  const refresh = element("button", { type: "button" }, ["Refresh"]);
  refresh.addEventListener("click", () => void controller.refresh());
  const more = element("button", { type: "button" }, ["Load more"]);
  more.addEventListener("click", () => void controller.next());
  return element("div", { class: "registry-page" }, [
    element("div", { class: "registry-actions" }, [
      refresh,
      ...(data?.nextCursor === undefined ? [] : [more]),
    ]),
    importForm(controller),
    configurationRegistry(controller.state.registry),
  ]);
}
