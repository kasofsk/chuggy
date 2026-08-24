/**
 * The configuration registry, rendered only from parsed configuration summaries.
 *
 * This module does not know how summaries were fetched or encoded. Its state is
 * deliberately small so the application shell can make every pending or failed
 * read visible without teaching the renderer about transport outcomes.
 */

import { element } from "./render.js";

/**
 * @typedef {ReturnType<typeof import("../app/resources.js").parseConfigurationsPage>["configurations"][number]} ConfigurationSummary
 */

/**
 * @param {string} title
 * @param {string} message
 * @param {"polite" | "assertive" | undefined} tone
 */
function statusCard(title, message, tone) {
  return element(
    "section",
    {
      class: "panel",
      "aria-labelledby": "configuration-registry-title",
      ...(tone === undefined ? {} : { "aria-live": tone }),
    },
    [
      element("div", { class: "standing-body" }, [
        element("h2", { id: "configuration-registry-title" }, [title]),
        element(
          "p",
          {
            class: "note",
            ...(tone === "assertive" ? { "data-tone": "halt" } : {}),
          },
          [message],
        ),
      ]),
    ],
  );
}

/** @param {ConfigurationSummary} configuration */
function identity(configuration) {
  return configuration.provenance.source === "Repository"
    ? configuration.provenance.name
    : configuration.revision;
}

/** @param {ConfigurationSummary} configuration */
function provenance(configuration) {
  if (configuration.provenance.source === "Authored")
    return [
      element("dt", { class: "eyebrow" }, ["Source"]),
      element("dd", {}, ["Authored in Chuggy"]),
    ];
  return [
    element("dt", { class: "eyebrow" }, ["Source"]),
    element("dd", {}, ["Repository"]),
    element("dt", { class: "eyebrow" }, ["Repository"]),
    element("dd", { class: "numeric" }, [configuration.provenance.repository]),
    element("dt", { class: "eyebrow" }, ["Commit"]),
    element("dd", {}, [element("code", {}, [configuration.provenance.commit])]),
    element("dt", { class: "eyebrow" }, ["Declaration"]),
    element("dd", {}, [element("code", {}, [configuration.provenance.path])]),
  ];
}

/** @param {ConfigurationSummary} configuration */
function taskConfigurations(configuration) {
  if (configuration.readiness === "Incomplete")
    return element("p", { class: "note", "data-tone": "deferred" }, [
      "Task configuration is incomplete and cannot be used by a ticket.",
    ]);
  const practices =
    configuration.practices.length === 0
      ? "None"
      : configuration.practices.join(", ");
  return element("table", {}, [
    element("caption", { class: "eyebrow" }, ["Task configurations"]),
    element("thead", {}, [
      element("tr", {}, [
        element("th", { scope: "col" }, ["Task"]),
        element("th", { scope: "col" }, ["Instructions"]),
        element("th", { scope: "col" }, ["Image"]),
        element("th", { scope: "col" }, ["Practices"]),
      ]),
    ]),
    element("tbody", {}, [
      element("tr", {}, [
        element("th", { scope: "row" }, ["Work"]),
        element("td", {}, [String(configuration.workInstructionsCount)]),
        element("td", {}, [configuration.image]),
        element("td", {}, [practices]),
      ]),
      element("tr", {}, [
        element("th", { scope: "row" }, ["Evaluation"]),
        element("td", {}, [String(configuration.reviewInstructionsCount)]),
        element("td", {}, [configuration.image]),
        element("td", {}, [practices]),
      ]),
    ]),
  ]);
}

/**
 * @param {ConfigurationSummary} configuration
 * @param {number} index
 */
function configurationCard(configuration, index) {
  const titleId = `configuration-${String(index)}-title`;
  return element("article", { class: "panel", "aria-labelledby": titleId }, [
    element("div", { class: "panel-head" }, [
      element("h3", { id: titleId }, [identity(configuration)]),
      element("span", { class: "caption" }, [configuration.readiness]),
    ]),
    element("div", { class: "panel-body" }, [
      element("dl", {}, [
        element("dt", { class: "eyebrow" }, ["Revision"]),
        element("dd", {}, [element("code", {}, [configuration.revision])]),
        element("dt", { class: "eyebrow" }, ["Parent revision"]),
        element("dd", {}, [
          configuration.parent === undefined
            ? "None"
            : element("code", {}, [configuration.parent]),
        ]),
        element("dt", { class: "eyebrow" }, ["Digest"]),
        element("dd", {}, [element("code", {}, [configuration.digest])]),
        element("dt", { class: "eyebrow" }, ["Created"]),
        element("dd", {}, [
          element("time", { datetime: configuration.createdAt }, [
            configuration.createdAt,
          ]),
        ]),
        ...provenance(configuration),
      ]),
      taskConfigurations(configuration),
    ]),
  ]);
}

/**
 * @typedef {import("../app/configurationRegistry.js").ConfigurationRegistryState} ConfigurationRegistryState
 */

/** @param {ConfigurationRegistryState} state */
function registryData(state) {
  return state.state === "Data" ? state : state.held;
}

/** @param {ConfigurationRegistryState} state */
function registryNotice(state) {
  if (state.state === "Data") return [];
  if (state.state === "Loading")
    return [
      element("p", { class: "note", "aria-live": "polite" }, [
        state.load === "Next"
          ? "Loading more configurations…"
          : "Refreshing configurations…",
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

/** @param {ConfigurationRegistryState} state */
export function configurationRegistry(state) {
  const data = registryData(state);
  if (data === undefined && state.state === "Loading")
    return statusCard(
      "Configuration registry",
      "Loading ticket and task configurations…",
      "polite",
    );
  if (data === undefined && state.state === "Error") {
    const message =
      state.error.kind === "Deferred"
        ? `${state.error.code} — retry after ${String(state.error.retryAfterSeconds)}s.`
        : state.error.reason;
    return statusCard("Configuration registry", message, "assertive");
  }
  if (data === undefined) throw new TypeError("registry state has no data");
  if (data.configurations.length === 0)
    return statusCard(
      "Configuration registry",
      "No ticket configurations have been authored or imported for this project.",
      undefined,
    );
  return element(
    "section",
    { "aria-labelledby": "configuration-registry-title" },
    [
      element("h2", { id: "configuration-registry-title" }, [
        "Configuration registry",
      ]),
      ...registryNotice(state),
      ...data.configurations.map(configurationCard),
    ],
  );
}
