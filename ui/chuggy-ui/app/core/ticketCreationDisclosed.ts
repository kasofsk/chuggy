/**
 * What the ticket form keeps out of sight until it is asked for, and whether
 * anything kept there holds a value a fresh form under the same configuration,
 * selection and repository would not.
 *
 * The first screen holds what a ticket cannot be filed without: the
 * configuration it is drawn under, its intent, and the repository the work
 * happens in where the project binds one. Every other field is disclosed, and a
 * field is judged by what a submit would send of it, so a blank line added to
 * the links is not a value. A field the form does not draw holds no value here,
 * because nothing on screen could show it.
 */

import { finalizationChoiceKey } from "./finalizationChoice.ts";
import {
  creationCatalogOf,
  creationConfigurationChosen,
  creationFormFrom,
  creationOfferDrawn,
  creationRepositoryChosen,
  creationSelectionChosen,
} from "./ticketCreation.ts";
import type {
  CreationField,
  CreationOffer,
  CreationStage,
  TicketCreationForm,
} from "./ticketCreation.ts";
import { overridesNestedOf } from "./ticketOverrides.ts";
import type { ProjectRepositoryResponse } from "../../../../src/contract/responses.ts";

/** The fields the first screen draws, in the order it draws them. */
export const creationFieldsEssential: readonly CreationField[] = [
  "configuration",
  "intent",
  "repository",
];

/** Every field a fault can name, in the order the form draws them: the
 * essentials, then the disclosed ones, then the fence, which is no field and
 * is said beside the submit. */
export const creationFieldsDrawn: readonly CreationField[] = [
  ...creationFieldsEssential,
  "title",
  "links",
  "images",
  "checks",
  "branch",
  "finalization",
  "target",
  "authoring",
  "overrides",
  "fence",
];

/** Whether a fault on this field is said inside the disclosure. */
export function creationFieldDisclosed(field: CreationField): boolean {
  return !creationFieldsEssential.includes(field) && field !== "fence";
}

/** The field a refused submit is answered at: the first the form draws that
 * a fault names, none where no fault names one. */
export function creationFieldFirstFaulted(
  faulted: readonly CreationField[],
): CreationField | undefined {
  return creationFieldsDrawn.find((field) => faulted.includes(field));
}

/** What the form draws of the disclosed fields, beyond what the form holds. */
export interface CreationDisclosedDrawn {
  /** Whether the epic is asked, which only a creation does. */
  readonly epic: boolean;
}

/** The form a fresh ticket holds under the configuration, selection and
 * repository this one names. */
function creationDisclosedDefault(
  offers: readonly CreationOffer[],
  repositories: readonly ProjectRepositoryResponse[],
  form: TicketCreationForm,
): TicketCreationForm {
  const configured = creationConfigurationChosen(
    creationFormFrom(offers, repositories),
    offers,
    form.configuration,
    repositories,
  );
  const selected = creationSelectionChosen(
    configured,
    offers,
    form.selection,
    repositories,
  );
  return creationRepositoryChosen(
    selected,
    repositories,
    form.repository,
    offers,
  );
}

function creationDisclosedLines(lines: readonly string[]): boolean {
  return lines.some((line) => line.trim() !== "");
}

function creationDisclosedWidths(program: readonly CreationStage[]): string {
  return program.map((stage) => String(stage.evaluators.length)).join(",");
}

/** Whether any disclosed field holds a value the fresh form would not. */
export function creationDisclosedHeld(
  offers: readonly CreationOffer[],
  repositories: readonly ProjectRepositoryResponse[],
  form: TicketCreationForm,
  drawn: CreationDisclosedDrawn,
): boolean {
  const fresh = creationDisclosedDefault(offers, repositories, form);
  const offer = creationOfferDrawn(offers, form);
  const catalog = creationCatalogOf(offer);
  const landed = form.finalization.kind !== "None";
  const checks = offer?.initialization.commandedCheckStage !== undefined;
  const held: readonly boolean[] = [
    form.title.trim() !== "",
    creationDisclosedLines(form.links),
    form.images.length > 0,
    checks && creationDisclosedLines(form.checks),
    form.branchName.trim() !== "",
    finalizationChoiceKey(form.finalization) !==
      finalizationChoiceKey(fresh.finalization),
    landed && form.targetBranchName.trim() !== fresh.targetBranchName.trim(),
    drawn.epic && form.epic !== "",
    catalog !== undefined && Object.keys(form.selection).length > 0,
    catalog === undefined && overridesNestedOf(form.overrides) !== undefined,
    offer !== undefined && form.dependencies.length > 0,
    offer !== undefined &&
      creationDisclosedWidths(form.program) !==
        creationDisclosedWidths(fresh.program),
  ];
  return held.includes(true);
}
