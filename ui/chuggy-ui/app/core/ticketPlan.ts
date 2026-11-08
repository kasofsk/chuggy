/**
 * What a ticket will run, step by step, as its configuration and its release
 * say: the work, each evaluation stage with its evaluators, and how it lands.
 *
 * THE STAGES ARE THE PROGRAM THE TICKET WAS RELEASED WITH, or the one a draft
 * never released holds, and the names are its catalog's selected plan's, laid
 * over that program by position, as the catalog initializes one. A version 1 configuration names no stages, so its
 * stages and evaluators are named by their numbers; a configuration not read
 * yet is the same.
 *
 * THE LANDING IS THE BRIEF'S, and the selected finalizer's where the brief
 * names none, as the Configuration tab reads it. One whose mode is `None`
 * lands nothing, so the ticket has no landing to wait on.
 */

import type { BriefFinalizationOf } from "../../../../src/contract/brief.ts";
import type { TicketResponse } from "../../../../src/contract/responses.ts";
import { finalizationMethodLabel } from "./codeLabels.ts";
import {
  configurationCatalogOf,
  configurationCatalogSelected,
  configurationCatalogWorkload,
} from "./configurationCatalog.ts";
import type {
  CatalogPlanStage,
  CatalogWorkload,
  ConfigurationCatalog,
} from "./configurationCatalog.ts";
import { stageLabel } from "./ticketLedger.ts";
import type { StageNames, TicketProgram } from "./ticketLedger.ts";
import { copyOrDataText } from "./copy.ts";
import type { Copy, CopyText } from "./copy.ts";

/** One evaluator of a stage: its key, its name, and what it runs. */
export interface TicketPlanEvaluator {
  readonly key: number;
  readonly name: string;
  readonly runs: string | undefined;
}

export interface TicketPlanStage {
  readonly stage: number;
  readonly name: string;
  readonly evaluators: readonly TicketPlanEvaluator[];
}

export interface TicketPlan {
  /** What the work runs on, where the configuration says. */
  readonly work: string | undefined;
  readonly stages: readonly TicketPlanStage[];
  /** The plan's stage names, none where it names none. */
  readonly names: StageNames;
  /** Whether the ticket lands anything at all. */
  readonly lands: boolean;
  /** How it lands, where the configuration says. */
  readonly landing: Copy | undefined;
}

/** What a workload runs on: its agent and model, or that it runs commands. */
function ticketPlanRuns(
  workload: CatalogWorkload,
  text: CopyText,
): string | undefined {
  if (workload.runner === "Commands")
    return text({ id: "ticket-plan-commands" });
  const said = [
    workload.agent,
    workload.model === "Default" ? undefined : workload.model,
  ].filter((part) => part !== undefined);
  return said.length === 0 ? undefined : said.join(" · ");
}

/** An evaluator the plan does not name, by its number. */
export function ticketPlanEvaluatorNumber(key: number): Copy {
  return { id: "ticket-plan-evaluator", args: { key: String(key) } };
}

function ticketPlanEvaluator(
  catalog: ConfigurationCatalog | undefined,
  named: CatalogPlanStage | undefined,
  key: number,
  text: CopyText,
): TicketPlanEvaluator {
  const name = named?.evaluators[key - 1];
  const workload =
    catalog === undefined || name === undefined
      ? undefined
      : configurationCatalogWorkload(catalog, name);
  const runs =
    workload === undefined ? undefined : ticketPlanRuns(workload, text);
  return {
    key,
    name: name ?? text(ticketPlanEvaluatorNumber(key)),
    runs:
      name === undefined || runs === undefined
        ? undefined
        : `${name} · ${runs}`,
  };
}

/** The program the ticket was released with, or the plan's own shape where
 * the read carries none. */
function ticketPlanProgram(
  program: TicketProgram | undefined,
  named: readonly CatalogPlanStage[] | undefined,
): TicketProgram {
  return (
    program ??
    (named ?? []).map((stage, index) => ({
      key: index + 1,
      evaluators: stage.evaluators.map((_name, position) => ({
        key: position + 1,
      })),
    }))
  );
}

/** What a plan is read from: a released ticket's own read, or a draft's
 * authoring as it stands. */
export type TicketPlanned = Pick<
  TicketResponse,
  "selection" | "brief" | "program"
>;

export function ticketPlanOf(
  canonical: string | undefined,
  ticket: TicketPlanned | undefined,
  text: CopyText,
): TicketPlan {
  const catalog =
    canonical === undefined ? undefined : configurationCatalogOf(canonical);
  const selected =
    catalog === undefined
      ? undefined
      : configurationCatalogSelected(catalog, ticket?.selection);
  const named =
    selected === undefined
      ? undefined
      : catalog?.plans.get(selected.evaluation);
  const work =
    catalog === undefined || selected === undefined
      ? undefined
      : configurationCatalogWorkload(catalog, selected.work);
  const finalization: BriefFinalizationOf<string | undefined> | undefined =
    ticket?.brief?.finalization ??
    catalog?.finalizers.find((held) => held.name === selected?.finalization)
      ?.finalization;
  const names = named?.map((stage) => stage.name);
  return {
    work: work === undefined ? undefined : ticketPlanRuns(work, text),
    stages: ticketPlanProgram(ticket?.program, named).map((stage, index) => ({
      stage: index + 1,
      name: copyOrDataText(text, stageLabel(index + 1, names)),
      evaluators: stage.evaluators.map((evaluator) =>
        ticketPlanEvaluator(catalog, named?.[index], evaluator.key, text),
      ),
    })),
    names,
    lands: finalization?.kind !== "None",
    landing:
      finalization === undefined
        ? undefined
        : finalizationMethodLabel(finalization),
  };
}
