/**
 * The base language's catalog, every section of it, and the formatter over it
 * that a reader is drawn in. Each section is the module generated from its
 * `.ftl`, so a bundler and Node load it alike.
 */

import type { CopyText } from "../core/copy.ts";
import { copyBundleOf, copyTextOf } from "./copyBundle.ts";
import { codesFtl } from "./generated/codesFtl.ts";
import { figuresFtl } from "./generated/figuresFtl.ts";
import { sentencesFtl } from "./generated/sentencesFtl.ts";
import { setupFtl } from "./generated/setupFtl.ts";
import { shellFtl } from "./generated/shellFtl.ts";
import { standingFtl } from "./generated/standingFtl.ts";
import { termsFtl } from "./generated/termsFtl.ts";
import { tonesFtl } from "./generated/tonesFtl.ts";

export const copyLocale = "en";

export const copyCatalogEn: readonly string[] = [
  termsFtl,
  codesFtl,
  figuresFtl,
  sentencesFtl,
  setupFtl,
  shellFtl,
  standingFtl,
  tonesFtl,
];

export const copyTextEn: CopyText = copyTextOf(
  copyBundleOf(copyLocale, copyCatalogEn),
);
