/**
 * The base language's catalog, every section of it, and the formatter over it
 * that a reader is drawn in. Each section is the module generated from its
 * `.ftl`, so a bundler and Node load it alike.
 */

import type { CopyText } from "../core/copy.ts";
import { copyBundleOf, copyTextOf } from "./copyBundle.ts";
import { apiFtl } from "./generated/apiFtl.ts";
import { chatFtl } from "./generated/chatFtl.ts";
import { codesFtl } from "./generated/codesFtl.ts";
import { configurationCatalogFtl } from "./generated/configurationCatalogFtl.ts";
import { conversationFtl } from "./generated/conversationFtl.ts";
import { figuresFtl } from "./generated/figuresFtl.ts";
import { inboxFtl } from "./generated/inboxFtl.ts";
import { leadFtl } from "./generated/leadFtl.ts";
import { operationFtl } from "./generated/operationFtl.ts";
import { panelFtl } from "./generated/panelFtl.ts";
import { permissionsFtl } from "./generated/permissionsFtl.ts";
import { projectFtl } from "./generated/projectFtl.ts";
import { repositoriesFtl } from "./generated/repositoriesFtl.ts";
import { runnersFtl } from "./generated/runnersFtl.ts";
import { sentencesFtl } from "./generated/sentencesFtl.ts";
import { sessionFtl } from "./generated/sessionFtl.ts";
import { settingsFtl } from "./generated/settingsFtl.ts";
import { setupFtl } from "./generated/setupFtl.ts";
import { setupRunnerFtl } from "./generated/setupRunnerFtl.ts";
import { shellFtl } from "./generated/shellFtl.ts";
import { standingFtl } from "./generated/standingFtl.ts";
import { streamFtl } from "./generated/streamFtl.ts";
import { termsFtl } from "./generated/termsFtl.ts";
import { ticketFtl } from "./generated/ticketFtl.ts";
import { ticketAuthoringFtl } from "./generated/ticketAuthoringFtl.ts";
import { tonesFtl } from "./generated/tonesFtl.ts";
import { uiFtl } from "./generated/uiFtl.ts";

export const copyLocale = "en";

export const copyCatalogEn: readonly string[] = [
  termsFtl,
  apiFtl,
  chatFtl,
  codesFtl,
  configurationCatalogFtl,
  conversationFtl,
  figuresFtl,
  inboxFtl,
  leadFtl,
  operationFtl,
  panelFtl,
  permissionsFtl,
  projectFtl,
  repositoriesFtl,
  runnersFtl,
  sentencesFtl,
  sessionFtl,
  settingsFtl,
  setupFtl,
  setupRunnerFtl,
  shellFtl,
  standingFtl,
  streamFtl,
  ticketFtl,
  ticketAuthoringFtl,
  tonesFtl,
  uiFtl,
];

export const copyTextEn: CopyText = copyTextOf(
  copyBundleOf(copyLocale, copyCatalogEn),
);
