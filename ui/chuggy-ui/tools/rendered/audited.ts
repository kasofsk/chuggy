/**
 * axe over a painted page: every rule axe runs by default, the contrast rule
 * among them, with the findings `ui/chuggy-ui/test/accessibilityExceptions.ts`
 * lists let pass and every other one returned.
 *
 * axe is evaluated into the page rather than loaded by it, so the served
 * policy sees no script of its own and nothing the console ships carries it.
 */

import axe from "axe-core";
import type { Page } from "@playwright/test";

import { accessibilityExceptions } from "../../test/accessibilityExceptions.ts";
import type { AccessibilityException } from "../../test/accessibilityExceptions.ts";

export interface AuditedFinding {
  readonly rule: string;
  readonly target: string;
  readonly summary: string;
}

/** The window in which nothing in the document may change for it to count
 * as drawn, and the most a page is given to fall that still. */
const auditedQuietMs = 300;
const auditedQuietWaitMsMax = 10_000;

/** Resolves once the document has gone `auditedQuietMs` with no mutation, so
 * what a screen reads after its `ready` is drawn before axe judges it. */
export async function auditedSettled(page: Page): Promise<void> {
  const settled = await page.evaluate(
    ({ quietMs, waitMsMax }) =>
      new Promise<boolean>((resolve) => {
        let quiet = setTimeout(done, quietMs, true);
        const bound = setTimeout(done, waitMsMax, false);
        const observer = new MutationObserver(() => {
          clearTimeout(quiet);
          quiet = setTimeout(done, quietMs, true);
        });
        function done(still: boolean): void {
          observer.disconnect();
          clearTimeout(quiet);
          clearTimeout(bound);
          resolve(still);
        }
        observer.observe(document, {
          subtree: true,
          childList: true,
          attributes: true,
          characterData: true,
        });
      }),
    { quietMs: auditedQuietMs, waitMsMax: auditedQuietWaitMsMax },
  );
  if (!settled)
    throw new Error(
      `the page did not go ${String(auditedQuietMs)}ms unchanged within ${String(auditedQuietWaitMsMax)}ms, so there is no drawn page to audit`,
    );
}

/** Every finding axe makes on `page` as it stands that `exceptions` does not
 * let pass. */
export async function auditedFindings(
  page: Page,
  exceptions: readonly AccessibilityException[] = accessibilityExceptions,
): Promise<readonly AuditedFinding[]> {
  if (!(await page.evaluate(() => "axe" in window)))
    await page.evaluate(axe.source);
  return page.evaluate(async (excepted) => {
    const run = (window as unknown as { axe: typeof axe }).axe;
    const results = await run.run(document, { resultTypes: ["violations"] });
    return results.violations.flatMap((violation) =>
      violation.nodes
        .filter((node) => {
          const element =
            node.target.length === 1
              ? document.querySelector(String(node.target[0]))
              : null;
          return !excepted.some(
            (exception) =>
              exception.rule === violation.id &&
              element?.matches(exception.selector) === true,
          );
        })
        .map((node) => ({
          rule: violation.id,
          target: node.target.join(" "),
          summary: node.failureSummary ?? violation.help,
        })),
    );
  }, exceptions);
}
