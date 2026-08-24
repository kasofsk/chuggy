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
 * @typedef {{ status: "Editing", commit: string, issue: string | undefined }
 *   | { status: "Submitting", commit: string }
 *   | { status: "Succeeded", commit: string }
 *   | { status: "Rejected", commit: string,
 *        faults: readonly RepositoryConfigurationImportFault[] }
 *   | { status: "Unavailable", commit: string, reason: string }} RepositoryConfigurationImportState
 */

/**
 * @typedef {{ path: string, fault: string, label: string,
 *   detail: string | undefined }} RepositoryConfigurationImportFault
 */

/** @returns {RepositoryConfigurationImportState} */
export function repositoryConfigurationImportInitial() {
  return { status: "Editing", commit: "", issue: undefined };
}

/**
 * @param {string} commit
 * @returns {RepositoryConfigurationImportState}
 */
export function repositoryConfigurationImportEdited(commit) {
  return { status: "Editing", commit, issue: undefined };
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
  if (!commitPattern.test(state.commit))
    return {
      state: {
        status: /** @type {const} */ ("Editing"),
        commit: state.commit,
        issue: "Enter the full 40-character lowercase commit hash.",
      },
    };
  return {
    state: {
      status: /** @type {const} */ ("Submitting"),
      commit: state.commit,
    },
    request: repositoryConfigurationImportRequest(
      accessToken,
      partition,
      state.commit,
    ),
  };
}

/** @param {ReturnType<typeof parseRepositoryConfigurationRefusals>} faults */
function repositoryConfigurationImportFaults(faults) {
  return faults.map((fault) => ({
    path: fault.path,
    fault: fault.fault,
    label: faultLabels[fault.fault],
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
  if (outcome.outcome === "Ok")
    return {
      state: {
        status: /** @type {const} */ ("Succeeded"),
        commit: state.commit,
      },
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
          commit: state.commit,
          faults: repositoryConfigurationImportFaults(
            parseRepositoryConfigurationRefusals(outcome.body),
          ),
        },
      };
    } catch {
      return {
        state: {
          status: /** @type {const} */ ("Unavailable"),
          commit: state.commit,
          reason: unreadableReason,
        },
      };
    }
  }
  return {
    state: {
      status: /** @type {const} */ ("Unavailable"),
      commit: state.commit,
      reason: repositoryConfigurationImportUnavailable(outcome),
    },
  };
}
