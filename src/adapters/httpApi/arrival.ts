/**
 * An arrival read off a request: the draws the machine takes, and the annex it
 * does not.
 *
 * A DRAW IS FOUND IN ITS OWN VOCABULARY, NEVER BUILT FROM HALVES. A stage, a
 * wrap-up kind and a project are each looked up in the set `src/domain/config.ts`
 * says an arrival draws from, so a fan-out past the bound or a lease on a
 * resource no universe holds is refused by the same set the machine draws from
 * rather than by a range check written again here. That also means the text a
 * field carries and the text the desk's own form renders are one function, so
 * the form cannot offer a value the parse would refuse.
 *
 * WHAT THIS PARSE DOES NOT DECIDE. Whether the fleet has room, whether a
 * dependency may be depended on, whether the ids repeat — all of that is
 * `cmdEnabled`'s, and a submission it refuses comes back as a `Dropped` answer
 * carrying the reason. So this returns a well-formed arrival or a reason it
 * could not be read, and never a second opinion about enablement.
 */

import { assertNever } from "../../domain/assertNever.ts";
import {
  defaultProgram,
  projects,
  stageChoices,
  wrapUpChoices,
  type Config,
} from "../../domain/config.ts";
import { asTicketId, type ProjectId, type TicketId } from "../../domain/ids.ts";
import type { Stage } from "../../domain/program.ts";
import type { WrapUp } from "../../domain/wrapUp.ts";
import type { TicketAnnex } from "../../interpreter/registry.ts";
import type { Parsed } from "../../interpreter/wire.ts";
import {
  httpApiField,
  httpApiFieldAll,
  type HttpApiFields,
} from "./request.ts";

/** An arrival as the face submits it: the machine's four draws, and the annex written beside them. */
export interface HttpApiArrival {
  readonly deps: readonly TicketId[];
  readonly program: readonly Stage[];
  readonly project: ProjectId;
  readonly wrapUp: WrapUp;
  readonly annex: TicketAnnex;
}

/** The refusal every parse here answers with, named once so a caller reads one field to learn it failed. */
function httpApiRefused(why: string): Parsed<never> {
  return { parsed: "Refused", why };
}

/** A whole number at or above one, or nothing; the branding constructors throw where a caller's text may simply be wrong. */
export function httpApiWholeNumber(text: string): number | undefined {
  const value = Number(text);
  return text !== "" && Number.isSafeInteger(value) && value >= 1
    ? value
    : undefined;
}

/** The text a stage is written as, which is both what the form renders and what the parse reads. */
export function httpApiStageText(stage: Stage): string {
  return `${String(stage.fanout)}:${stage.combinator}`;
}

/** The text a wrap-up kind is written as, which is both what the form renders and what the parse reads. */
export function httpApiWrapUpText(wrapUp: WrapUp): string {
  switch (wrapUp.wrapUp) {
    case "WNone":
      return "WNone";
    case "WExclusive":
      return `WExclusive:${String(wrapUp.resource)}`;
    default:
      return assertNever(wrapUp);
  }
}

/** The authored program, found stage by stage in the vocabulary an arrival draws from. */
function httpApiProgram(
  config: Config,
  texts: readonly string[],
): readonly Stage[] | undefined {
  if (texts.length === 0) return defaultProgram(config);
  const program: Stage[] = [];
  for (const text of texts) {
    const stage = stageChoices(config).find(
      (choice) => httpApiStageText(choice) === text,
    );
    if (stage === undefined) return undefined;
    program.push(stage);
  }
  return program;
}

/** The dependency ids a request names, refusing the whole list where any one of them is not an id. */
function httpApiDeps(
  texts: readonly string[],
): readonly TicketId[] | undefined {
  const deps: TicketId[] = [];
  for (const text of texts) {
    const value = httpApiWholeNumber(text);
    if (value === undefined) return undefined;
    deps.push(asTicketId(value));
  }
  return deps;
}

/** The four draws an arrival carries, each found in its own vocabulary. */
function httpApiDraws(
  config: Config,
  fields: HttpApiFields,
): Parsed<Omit<HttpApiArrival, "annex">> {
  const project = projects(config).find(
    (choice) => String(choice) === httpApiField(fields, "project"),
  );
  if (project === undefined) {
    return httpApiRefused("project names no project this deployment has");
  }
  const wrapUp = wrapUpChoices(config).find(
    (choice) =>
      httpApiWrapUpText(choice) === (httpApiField(fields, "wrapUp") ?? "WNone"),
  );
  if (wrapUp === undefined) {
    return httpApiRefused("wrapUp names no wrap-up kind this deployment has");
  }
  const program = httpApiProgram(config, httpApiFieldAll(fields, "program"));
  if (program === undefined) {
    return httpApiRefused(
      "program names a stage this deployment cannot author",
    );
  }
  const deps = httpApiDeps(httpApiFieldAll(fields, "deps"));
  if (deps === undefined) {
    return httpApiRefused("deps names something that is not a ticket id");
  }
  return { parsed: "Ok", value: { deps, program, project, wrapUp } };
}

/** An arrival read off a request body, authored by the caller the token named. */
export function httpApiArrival(
  config: Config,
  fields: HttpApiFields,
  author: string,
): Parsed<HttpApiArrival> {
  const title = httpApiField(fields, "title") ?? "";
  const taskType = httpApiField(fields, "taskType") ?? "";
  if (title === "") return httpApiRefused("title is required");
  if (taskType === "") return httpApiRefused("taskType is required");
  const draws = httpApiDraws(config, fields);
  if (draws.parsed === "Refused") return draws;
  return {
    parsed: "Ok",
    value: {
      ...draws.value,
      annex: {
        title,
        brief: httpApiField(fields, "brief") ?? "",
        taskType,
        author,
      },
    },
  };
}
