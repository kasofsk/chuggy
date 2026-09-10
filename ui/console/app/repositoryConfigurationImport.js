/**
 * Repository configuration import as a pure UI interaction.
 *
 * The caller performs the returned request and feeds its classified outcome
 * back in. A successful answer emits the registry invalidation event; the DOM
 * layer decides how to refresh what it currently displays.
 */

import { unavailableReason, unreadableReason } from "./outcomes.js";
import { repositoryConfigurationImportRequest } from "./protocol.js";
import { parseRepositoryConfigurationRefusals } from "./resources.js";

const commitPattern = /^[0-9a-f]{40}$/u;

/** @type {Readonly<Record<string, string>>} */
const faultLabels = {
  TooManyDeclarations: "Too many declarations",
  PathInvalid: "Invalid declaration path",
  SymlinkRefused: "Symbolic link refused",
  ContentTooLarge: "Declaration is too large",
  DocumentUnreadable: "Declaration is not readable JSON",
  EnvelopeInvalid: "Invalid declaration envelope",
  NameInvalid: "Invalid configuration name",
  ConfigurationInvalid: "Invalid configuration",
  DuplicateName: "Duplicate configuration name",
  DuplicatePath: "Duplicate declaration path",
};

/** @typedef {import("./protocol.js").ApiOutcome} ApiOutcome */

/**
 * @typedef {{ repository: string, commit: string }} RepositoryConfigurationImportSource
 */

/**
 * @typedef {RepositoryConfigurationImportSource &
 *   ({ status: "Editing", issue: string | undefined }
 *   | { status: "Submitting" }
 *   | { status: "Succeeded" }
 *   | { status: "Rejected",
 *        faults: readonly RepositoryConfigurationImportFault[] }
 *   | { status: "Unavailable", reason: string })} RepositoryConfigurationImportState
 */

/**
 * @typedef {{ path: string, fault: string, label: string,
 *   detail: string | undefined }} RepositoryConfigurationImportFault
 */

/**
 * @param {RepositoryConfigurationImportState} state
 * @returns {RepositoryConfigurationImportSource}
 */
function repositoryConfigurationImportSource(state) {
  return { repository: state.repository, commit: state.commit };
}

/** @returns {RepositoryConfigurationImportState} */
export function repositoryConfigurationImportInitial() {
  return { status: "Editing", repository: "", commit: "", issue: undefined };
}

/**
 * @param {RepositoryConfigurationImportSource} source
 * @returns {RepositoryConfigurationImportState}
 */
export function repositoryConfigurationImportEdited(source) {
  return { status: "Editing", ...source, issue: undefined };
}

/**
 * @param {RepositoryConfigurationImportState} state
 * @param {string} accessToken
 * @param {import("./protocol.js").Partition} partition
 */
export function repositoryConfigurationImportSubmitted(
  state,
  accessToken,
  partition,
) {
  const source = repositoryConfigurationImportSource(state);
  const issue =
    source.repository === ""
      ? "Name the repository to import from."
      : commitPattern.test(source.commit)
        ? undefined
        : "Enter the full 40-character lowercase commit hash.";
  if (issue !== undefined)
    return {
      state: { status: /** @type {const} */ ("Editing"), ...source, issue },
    };
  return {
    state: { status: /** @type {const} */ ("Submitting"), ...source },
    request: repositoryConfigurationImportRequest(
      accessToken,
      partition,
      source,
    ),
  };
}

/** @param {ReturnType<typeof parseRepositoryConfigurationRefusals>} faults */
function repositoryConfigurationImportFaults(faults) {
  return faults.map((fault) => ({
    path: fault.path,
    fault: fault.fault,
    label: faultLabels[fault.fault] ?? fault.fault,
    detail: fault.configurationFault,
  }));
}

/** @param {ApiOutcome} outcome */
function repositoryConfigurationImportUnavailable(outcome) {
  if (outcome.outcome === "Retryable")
    return `Import is temporarily unavailable: ${outcome.code}.`;
  if (outcome.outcome === "Accepted" || outcome.outcome === "Ok")
    return unreadableReason;
  return unavailableReason(outcome);
}

/**
 * @param {RepositoryConfigurationImportState} state
 * @param {ApiOutcome} outcome
 */
export function repositoryConfigurationImportAnswered(state, outcome) {
  if (state.status !== "Submitting") return { state };
  const source = repositoryConfigurationImportSource(state);
  if (outcome.outcome === "Ok")
    return {
      state: { status: /** @type {const} */ ("Succeeded"), ...source },
      event: { event: /** @type {const} */ ("ConfigurationsChanged") },
    };
  if (
    outcome.outcome === "Rejected" &&
    outcome.code === "RepositoryConfigurationsRefused"
  ) {
    try {
      return {
        state: {
          status: /** @type {const} */ ("Rejected"),
          ...source,
          faults: repositoryConfigurationImportFaults(
            parseRepositoryConfigurationRefusals(outcome.body),
          ),
        },
      };
    } catch {
      return {
        state: {
          status: /** @type {const} */ ("Unavailable"),
          ...source,
          reason: unreadableReason,
        },
      };
    }
  }
  return {
    state: {
      status: /** @type {const} */ ("Unavailable"),
      ...source,
      reason: repositoryConfigurationImportUnavailable(outcome),
    },
  };
}
