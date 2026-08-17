/**
 * The desk as markup: template literals over the derived view, with no build
 * step and no client code but the sign-in button's own script.
 *
 * EVERY VALUE THAT CAME FROM OUTSIDE THIS PROCESS PASSES THROUGH `htmlText`.
 * That is the whole of the escaping discipline and it is one function, so a
 * reviewer checks interpolations against a single name rather than against a
 * habit. What is interpolated raw is only what this module and the domain
 * already spell: branded numbers rendered with `String`, and closed
 * vocabularies — a phase, an outcome, an action — whose members are written
 * here and cannot carry markup.
 *
 * THE FORMS OFFER WHAT THE MACHINE WOULD TAKE. A ticket's action forms are its
 * enabled actions and nothing else, and the values a select carries are
 * rendered by the same functions the parse reads them back with, so the desk
 * cannot offer a draw its own routes would refuse. A refusal is still answered
 * rather than prevented: enablement is re-checked at the decision, and what
 * comes back is what the page shows.
 */

import { assertNever } from "../../domain/assertNever.ts";
import type { ProjectId, TicketId } from "../../domain/ids.ts";
import type { Stage } from "../../domain/program.ts";
import type { Task, TaskKind, TaskState } from "../../domain/task.ts";
import type {
  ArtifactMark,
  WrapUp,
  WrapUpOutcome,
} from "../../domain/wrapUp.ts";
import type { RegistryUser } from "../../interpreter/registry.ts";
import { httpApiStageText, httpApiWrapUpText } from "./arrival.ts";
import type { BoardRow, DeskAction, TicketView } from "./view.ts";

/** The characters that would otherwise close a tag or an attribute, and what each becomes. */
const htmlEscapes: ReadonlyMap<string, string> = new Map([
  ["&", "&amp;"],
  ["<", "&lt;"],
  [">", "&gt;"],
  ['"', "&quot;"],
  ["'", "&#39;"],
]);

/** The sign-in button's script, kept on one line so the page template carries no bare URL. */
const htmlGoogleScript = "https://accounts.google.com/gsi/client";

/** The page's whole styling, which is deliberately small enough to inline. */
const htmlStyle =
  "body{font:14px system-ui,sans-serif;margin:2rem;max-width:60rem}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:.3rem .5rem;text-align:left}form{display:inline}label{display:block;margin:.4rem 0}";

/** Renders a value as the text it is: every interpolation of outside text goes through here. */
export function htmlText(value: string): string {
  return value.replace(/[&<>"']/g, (char) => htmlEscapes.get(char) ?? char);
}

/** The one page shell every answer below is rendered into. */
function htmlPage(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${htmlText(title)}</title><style>${htmlStyle}</style></head><body>${body}</body></html>`;
}

/** The heading every signed-in page opens with, naming who the token said is calling. */
function htmlWhoami(user: RegistryUser): string {
  return `<p>${htmlText(user.display)}${user.admin ? " (admin)" : ""} — <a href="/">board</a></p>`;
}

/** An option element, its value and its label both escaped. */
function htmlOption(value: string, label: string): string {
  return `<option value="${htmlText(value)}">${htmlText(label)}</option>`;
}

/** The sign-in page: the button's own markup, and no other client code. */
export function htmlLogin(oauthClientId: string): string {
  return htmlPage(
    "chuggy — sign in",
    `<h1>chuggy</h1><div id="g_id_onload" data-client_id="${htmlText(oauthClientId)}" data-login_uri="/session" data-auto_prompt="false"></div><div class="g_id_signin" data-type="standard"></div><script src="${htmlText(htmlGoogleScript)}" async defer></script>`,
  );
}

/** A refusal as a page, carrying the same reason the JSON answer would. */
export function htmlRefusal(heading: string, why: string): string {
  return htmlPage(
    `chuggy — ${heading}`,
    `<h1>${htmlText(heading)}</h1><p>${htmlText(why)}</p><p><a href="/">board</a> — <a href="/login">sign in</a></p>`,
  );
}

/** One action as the form that submits it, the gate carrying the outcome the performer would have answered. */
function htmlAction(
  ticket: TicketId,
  action: DeskAction,
  outcomes: readonly WrapUpOutcome[],
): string {
  const outcome =
    action === "gate"
      ? `<select name="outcome">${outcomes.map((one) => htmlOption(one, one)).join("")}</select>`
      : "";
  return `<form method="post" action="/api/tickets/${String(ticket)}/${action}">${outcome}<button type="submit">${action}</button></form> `;
}

/** The actions a caller may take on a ticket: what the machine enables, less the gate for anyone but an operator. */
function htmlActions(
  user: RegistryUser,
  row: BoardRow,
  outcomes: readonly WrapUpOutcome[],
): string {
  return row.actions
    .filter((action) => action !== "gate" || user.admin)
    .map((action) => htmlAction(row.ticket, action, outcomes))
    .join("");
}

/** One board line: the ticket's own reading, its author's title, and what may be done to it. */
function htmlRow(
  user: RegistryUser,
  row: BoardRow,
  outcomes: readonly WrapUpOutcome[],
): string {
  const title = row.annex?.title ?? "(no annex)";
  const author = row.annex?.author ?? "";
  const budgets = `${String(row.gasLeft)}/${String(row.reworkLeft)}/${String(row.wrapUpLeft)}`;
  return `<tr><td><a href="/tickets/${String(row.ticket)}">${String(row.ticket)}</a></td><td>${row.phase}</td><td>${htmlText(title)}</td><td>${htmlText(author)}</td><td>${String(row.project)}</td><td>${budgets}</td><td>${htmlActions(user, row, outcomes)}</td></tr>`;
}

/** What a page needs of the deployment to offer an arrival the machine would take. */
export interface HtmlArrival {
  readonly projects: readonly ProjectId[];
  readonly wrapUps: readonly WrapUp[];
  readonly program: readonly Stage[];
  readonly dependable: readonly TicketId[];
}

/** The arrival form, every select drawn from the vocabulary the machine draws from. */
function htmlArrivalForm(draws: HtmlArrival): string {
  const projects = draws.projects
    .map((project) => htmlOption(String(project), String(project)))
    .join("");
  const wrapUps = draws.wrapUps
    .map((wrapUp) =>
      htmlOption(httpApiWrapUpText(wrapUp), httpApiWrapUpText(wrapUp)),
    )
    .join("");
  const deps = draws.dependable
    .map((ticket) => htmlOption(String(ticket), String(ticket)))
    .join("");
  const stages = draws.program
    .map(
      (stage) =>
        `<input name="program" value="${htmlText(httpApiStageText(stage))}">`,
    )
    .join("");
  return `<h2>author a ticket</h2><form method="post" action="/api/tickets"><label>title <input name="title" required></label><label>brief <textarea name="brief"></textarea></label><label>task type <input name="taskType" required></label><label>project <select name="project">${projects}</select></label><label>wrap-up <select name="wrapUp">${wrapUps}</select></label><label>program ${stages}</label><label>deps <select name="deps" multiple>${deps}</select></label><button type="submit">arrive</button></form>`;
}

/** The board: every ticket the core holds, joined with its annex, and the arrival form beneath. */
export function htmlBoard(
  user: RegistryUser,
  rows: readonly BoardRow[],
  outcomes: readonly WrapUpOutcome[],
  draws: HtmlArrival,
): string {
  const head =
    "<tr><th>id</th><th>phase</th><th>title</th><th>author</th><th>project</th><th>gas/rework/wrap-up</th><th>actions</th></tr>";
  const body = rows.map((row) => htmlRow(user, row, outcomes)).join("");
  return htmlPage(
    "chuggy — board",
    `<h1>board</h1>${htmlWhoami(user)}<table>${head}${body}</table>${htmlArrivalForm(draws)}`,
  );
}

/** What a task was for, in words. */
function htmlTaskKind(kind: TaskKind): string {
  switch (kind.kind) {
    case "TKWork":
      return "work";
    case "TKEval":
      return `eval stage ${String(kind.stage)}`;
    default:
      return assertNever(kind);
  }
}

/** How a task stands, in words. */
function htmlTaskState(state: TaskState): string {
  switch (state.state) {
    case "TSRunning":
      return "running";
    case "TSResolved":
      return state.outcome;
    default:
      return assertNever(state);
  }
}

/** What a ticket produced, in words. */
function htmlArtifact(mark: ArtifactMark): string {
  switch (mark.artifact) {
    case "ANone":
      return "none";
    case "ASome":
      return `mark ${String(mark.mark)}`;
    default:
      return assertNever(mark);
  }
}

/** A list of tasks as one line each, or a note that there are none. */
function htmlTasks(tasks: readonly Task[]): string {
  if (tasks.length === 0) return "<li>none</li>";
  return tasks
    .map(
      (task) =>
        `<li>${String(task.id)} ${htmlTaskKind(task.kind)} ${htmlTaskState(task.state)}</li>`,
    )
    .join("");
}

/** The annex as the author wrote it, or the note that a crash left the arrival without one. */
function htmlAnnex(view: TicketView): string {
  const annex = view.row.annex;
  if (annex === undefined) {
    return "<p>no annex was written for this ticket; it can be authored again</p>";
  }
  return `<h1>${htmlText(annex.title)}</h1><p>${htmlText(annex.taskType)} — authored by ${htmlText(annex.author)}</p><pre>${htmlText(annex.brief)}</pre>`;
}

/** One ticket in full: what the author wrote, what the machine holds, and what the desk was told. */
export function htmlTicket(
  user: RegistryUser,
  view: TicketView,
  outcomes: readonly WrapUpOutcome[],
): string {
  const facts = `<ul><li>phase ${view.row.phase}</li><li>project ${String(view.row.project)}</li><li>deps ${view.deps.map((dep) => String(dep)).join(", ")}</li><li>program ${view.program.map(httpApiStageText).join(", ")}</li><li>wrap-up ${httpApiWrapUpText(view.wrapUp)}</li><li>artifact ${htmlArtifact(view.artifact)}</li><li>resume ${view.resumeAt}</li><li>reason ${view.reason}</li><li>gas ${String(view.row.gasLeft)}, rework ${String(view.row.reworkLeft)}, wrap-up ${String(view.row.wrapUpLeft)}</li><li>spawned ${String(view.spawned)}</li></ul>`;
  const events = view.events
    .map((event) => `<li>${htmlText(event.key)} ${event.effect}</li>`)
    .join("");
  return htmlPage(
    `chuggy — ticket ${String(view.row.ticket)}`,
    `${htmlWhoami(user)}${htmlAnnex(view)}${facts}<h2>live tasks</h2><ul>${htmlTasks(view.tasks)}</ul><h2>retired tasks</h2><ul>${htmlTasks(view.record)}</ul><h2>desk log</h2><ul>${events}</ul><h2>actions</h2>${htmlActions(user, view.row, outcomes)}`,
  );
}
