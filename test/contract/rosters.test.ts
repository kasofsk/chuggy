/**
 * The contract's copies of the model's and the interpreter's closed sets, held
 * against their sources.
 *
 * `src/contract/` reaches neither directory, so each roster is written twice;
 * this suite is what makes the second copy a checked claim rather than a
 * comment. Each is held against a runtime list where one exists, and otherwise
 * against a record the compiler rejects when the union gains or loses a member.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  artifactRoles,
  attemptStates,
  configurationProvenanceSources,
  configurationReadinesses,
  draftStates,
  dispatchViewResults,
  evaluationCombinators,
  executionOutcomes,
  executionStatuses,
  executionTaskKinds,
  finalizers,
  nativeActionResolutions,
  notificationKinds,
  notificationResults,
  operationRefusalCodes,
  operationStates,
  outputRenderers,
  phaseRoster,
  repositoryConfigurationFaults,
  resultVerdicts,
  resumePricings,
  schedulerFreshnesses,
} from "../../src/contract/rosters.ts";
import { nativeHttpPageItemsMax } from "../../src/contract/http.ts";
import { projectChangeKinds } from "../../src/contract/events.ts";
import { phaseTags } from "../../src/domain/generated/modelTypes.ts";
import type {
  Combinator,
  Finalizer,
  RetryPricing,
} from "../../src/domain/generated/modelTypes.ts";
import {
  allAttemptStates,
  allExecutionOutcomes,
  allExecutionStatuses,
} from "../../src/interpreter/executionScheduler.ts";
import type { ExecutionTaskKind } from "../../src/interpreter/executionScheduler.ts";
import { allArtifactRoles } from "../../src/interpreter/resultManifest.ts";
import { allNativeActionResolutions } from "../../src/interpreter/ticketCommand.ts";
import { projectPageLimitMax } from "../../src/interpreter/nativeWeb.ts";
import type { OperationRefusalCode } from "../../src/interpreter/nativeWeb.ts";
import {
  executionPageLimitMax,
  type ExecutionResultResource,
  type OutputRenderer,
  type ProjectOperationalStatus,
} from "../../src/interpreter/operationsView.ts";
import type { OperationState } from "../../src/interpreter/operationInbox.ts";
import {
  notificationPageLimitMax,
  type NotificationBatch,
} from "../../src/interpreter/notifications.ts";
import {
  dispatchViewPageLimitMax,
  type DispatchViewPage,
} from "../../src/interpreter/dispatchView.ts";
import type {
  ConfigurationRevisionProvenance,
  ConfigurationRevisionSummary,
  DraftState,
} from "../../src/interpreter/authoring.ts";
import type { RepositoryConfigurationFault } from "../../src/interpreter/repositoryConfiguration.ts";

function keysOf(record: Readonly<Record<string, true>>): readonly string[] {
  return Object.keys(record).sort();
}

const sorted = (values: readonly string[]) => [...values].sort();

test("the phase and scheduler rosters are the model's", () => {
  assert.deepEqual([...phaseRoster], [...phaseTags]);
  assert.deepEqual([...executionStatuses], [...allExecutionStatuses]);
  assert.deepEqual([...executionOutcomes], [...allExecutionOutcomes]);
  assert.deepEqual([...attemptStates], [...allAttemptStates]);
  assert.deepEqual([...artifactRoles], [...allArtifactRoles]);
  assert.deepEqual(
    sorted(nativeActionResolutions),
    sorted(allNativeActionResolutions),
  );
});

test("one page bound serves every collection route", () => {
  assert.equal(nativeHttpPageItemsMax, projectPageLimitMax);
  assert.equal(nativeHttpPageItemsMax, executionPageLimitMax);
  assert.equal(nativeHttpPageItemsMax, notificationPageLimitMax);
  assert.equal(nativeHttpPageItemsMax, dispatchViewPageLimitMax);
});

test("the rosters with no runtime list are exhaustive over their unions", () => {
  const kinds: Record<ExecutionTaskKind, true> = {
    Work: true,
    Evaluation: true,
  };
  const renderers: Record<OutputRenderer, true> = {
    UnifiedDiff: true,
    Markdown: true,
    Json: true,
    Text: true,
  };
  const states: Record<OperationState, true> = {
    Pending: true,
    Succeeded: true,
    Refused: true,
    Answered: true,
    Cancelled: true,
  };
  const refusals: Record<OperationRefusalCode, true> = {
    NotEnabled: true,
    AuthoringChanged: true,
    ConfigurationInvalid: true,
    TicketChanged: true,
    SelectionChanged: true,
    CommandUnreadable: true,
  };
  const freshness: Record<
    ProjectOperationalStatus["schedulerFreshness"],
    true
  > = { Unknown: true };
  const verdicts: Record<ExecutionResultResource["verdict"], true> = {
    Pass: true,
    Fail: true,
  };
  const dispatchResults: Record<DispatchViewPage["result"], true> = {
    Page: true,
    Reset: true,
  };
  const batches: Record<NotificationBatch["result"], true> = {
    Events: true,
    Reset: true,
  };
  assert.deepEqual(sorted(executionTaskKinds), keysOf(kinds));
  assert.deepEqual(sorted(outputRenderers), keysOf(renderers));
  assert.deepEqual(sorted(operationStates), keysOf(states));
  assert.deepEqual(sorted(operationRefusalCodes), keysOf(refusals));
  assert.deepEqual(sorted(schedulerFreshnesses), keysOf(freshness));
  assert.deepEqual(sorted(resultVerdicts), keysOf(verdicts));
  assert.deepEqual(sorted(dispatchViewResults), keysOf(dispatchResults));
  assert.deepEqual(sorted(notificationResults), keysOf(batches));
});

test("the authoring rosters are exhaustive over the model unions", () => {
  const states: Record<DraftState, true> = {
    Draft: true,
    Released: true,
    Deleted: true,
  };
  const combinators: Record<Combinator, true> = {
    UnanimousPass: true,
    AnyPass: true,
  };
  const pricing: Record<RetryPricing, true> = {
    RetryCharged: true,
    RetryFree: true,
  };
  const finalizer: Record<Finalizer, true> = {
    NoFinalizer: true,
    ManagedFinalizer: true,
  };
  const provenance: Record<ConfigurationRevisionProvenance["source"], true> = {
    Authored: true,
    Repository: true,
  };
  const readiness: Record<ConfigurationRevisionSummary["readiness"], true> = {
    Ready: true,
    Incomplete: true,
  };
  const faults: Record<RepositoryConfigurationFault, true> = {
    TooManyDeclarations: true,
    PathInvalid: true,
    SymlinkRefused: true,
    ContentTooLarge: true,
    DocumentUnreadable: true,
    EnvelopeInvalid: true,
    NameInvalid: true,
    ConfigurationInvalid: true,
    DuplicateName: true,
    DuplicatePath: true,
  };
  assert.deepEqual(sorted(draftStates), keysOf(states));
  assert.deepEqual(sorted(evaluationCombinators), keysOf(combinators));
  assert.deepEqual(sorted(resumePricings), keysOf(pricing));
  assert.deepEqual(sorted(finalizers), keysOf(finalizer));
  assert.deepEqual(sorted(configurationProvenanceSources), keysOf(provenance));
  assert.deepEqual(sorted(configurationReadinesses), keysOf(readiness));
  assert.deepEqual(sorted(repositoryConfigurationFaults), keysOf(faults));
});

test("the stream carries every polled kind and the executions polling omits", () => {
  assert.deepEqual(
    sorted(projectChangeKinds),
    sorted([...notificationKinds, "Execution"]),
  );
});
