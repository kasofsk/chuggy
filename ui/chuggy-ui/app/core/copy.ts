/**
 * What a reader is told, as the decision layer says it: a catalog id and the
 * variables its message is formatted with, never the words. The words are the
 * catalog's, in `ui/chuggy-ui/app/copy/`, and what formats a descriptor is the
 * layer that draws it.
 *
 * Each section's ids are typed by the module generated from its catalog file,
 * so an id the catalog lacks, or a message handed other variables than its
 * own, does not compile.
 */

import type { ApiCopy } from "./generated/apiCopy.ts";
import type { ChatCopy } from "./generated/chatCopy.ts";
import type { CodesCopy } from "./generated/codesCopy.ts";
import type { ConfigurationCatalogCopy } from "./generated/configurationCatalogCopy.ts";
import type { ConversationCopy } from "./generated/conversationCopy.ts";
import type { FiguresCopy } from "./generated/figuresCopy.ts";
import type { InboxCopy } from "./generated/inboxCopy.ts";
import type { LeadCopy } from "./generated/leadCopy.ts";
import type { OperationCopy } from "./generated/operationCopy.ts";
import type { PanelCopy } from "./generated/panelCopy.ts";
import type { PermissionsCopy } from "./generated/permissionsCopy.ts";
import type { ProjectCopy } from "./generated/projectCopy.ts";
import type { RepositoriesCopy } from "./generated/repositoriesCopy.ts";
import type { RunnersCopy } from "./generated/runnersCopy.ts";
import type { SentencesCopy } from "./generated/sentencesCopy.ts";
import type { SessionCopy } from "./generated/sessionCopy.ts";
import type { SettingsCopy } from "./generated/settingsCopy.ts";
import type { SetupCopy } from "./generated/setupCopy.ts";
import type { SetupRunnerCopy } from "./generated/setupRunnerCopy.ts";
import type { ShellCopy } from "./generated/shellCopy.ts";
import type { StandingCopy } from "./generated/standingCopy.ts";
import type { StreamCopy } from "./generated/streamCopy.ts";
import type { TicketCopy } from "./generated/ticketCopy.ts";
import type { TicketAuthoringCopy } from "./generated/ticketAuthoringCopy.ts";
import type { TonesCopy } from "./generated/tonesCopy.ts";
import type { UiCopy } from "./generated/uiCopy.ts";

/** Each message's variables by name, as its section's module names them. */
type CopyVariables = ApiCopy &
  ChatCopy &
  CodesCopy &
  ConfigurationCatalogCopy &
  ConversationCopy &
  FiguresCopy &
  InboxCopy &
  LeadCopy &
  OperationCopy &
  PanelCopy &
  PermissionsCopy &
  ProjectCopy &
  RepositoriesCopy &
  RunnersCopy &
  SentencesCopy &
  SessionCopy &
  SettingsCopy &
  SetupCopy &
  SetupRunnerCopy &
  ShellCopy &
  StandingCopy &
  StreamCopy &
  TicketCopy &
  TicketAuthoringCopy &
  TonesCopy &
  UiCopy;

type CopyCatalog = {
  readonly [Id in keyof CopyVariables]: {
    readonly [Name in keyof CopyVariables[Id]]: CopyArgument;
  };
};

export type CopyId = keyof CopyCatalog;

/** The ids of the messages with no variables. */
type CopyIdBare = {
  readonly [Id in CopyId]: keyof CopyCatalog[Id] extends never ? Id : never;
}[CopyId];

/** A message with no variables is one shape whatever its id, so the union a
 * descriptor is checked against grows by a member only for a message that has
 * variables: TypeScript reduces a union of object types pairwise, and gives up
 * on one past a bound the whole catalog's ids would cross. */
export type Copy =
  | { readonly id: CopyIdBare }
  | {
      readonly [Id in Exclude<CopyId, CopyIdBare>]: {
        readonly id: Id;
        readonly args: CopyCatalog[Id];
      };
    }[Exclude<CopyId, CopyIdBare>];

/** What a message is formatted with: a value, or another descriptor, whose
 * words stand in its place, so a line a decision joins from two is still
 * worded by the catalog alone. */
export type CopyArgument = string | number | CopyHanded;

/** A descriptor handed to another as a variable, held by its id: its own
 * variables were checked where it was made, as a `Copy`, and an interface is
 * what lets a descriptor be one of the variables that type it. */
export interface CopyHanded {
  readonly id: CopyId;
  readonly args?: object;
}

/** The port a decision that needs the words themselves, to measure or to
 * print them, is handed. */
export type CopyText = (copy: Copy) => string;

/** A line that is the catalog's, or text that is data: what a browser's error
 * or another server said, drawn as it arrived. */
export type CopyOrData = Copy | string;

export function copyOrDataText(text: CopyText, line: CopyOrData): string {
  return typeof line === "string" ? line : text(line);
}
