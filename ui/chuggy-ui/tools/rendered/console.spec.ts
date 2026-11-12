/**
 * The console's first rendered cases: each screen loads under the served
 * policy with no violation, and does not scroll sideways at a phone's width.
 *
 * THE POLICY CASES ARE EXPECTED FAILURES. zod probes whether it may compile
 * its parsers by calling `Function("")` once, inside a `try`, and
 * `script-src 'self'` refuses it: nothing breaks, and the document reports a
 * violation on every screen. When the console stops making that probe each
 * case reports an unexpected pass, which is the signal to drop its `fail`.
 * Until then the sideways cases fail on every violation but that one, so the
 * expected failure hides nothing else.
 */

import {
  renderedNoOverflow,
  renderedNoViolations,
  renderedOpen,
  test,
} from "./driver.ts";
import type { RenderedOpening } from "./driver.ts";
import { stubApiProject, stubApiTenant } from "./stubApi.ts";

const signedOut: RenderedOpening = {
  route: "/",
  viewport: "phone",
  signedIn: false,
  ready: (page) => page.getByRole("button", { name: "Sign in" }),
};

const ticketsList: RenderedOpening = {
  route: `/${stubApiTenant}/${stubApiProject}/`,
  viewport: "phone",
  signedIn: true,
  ready: (page) => page.getByRole("link", { name: "#1", exact: true }),
};

const zodProbe = "zod's Function(\"\") probe is refused by script-src 'self'";
const zodProbeViolation = { directive: "script-src", blocked: "eval" };

test("the signed-out card loads with no policy violation", async ({
  browser,
  served,
}) => {
  test.fail(true, zodProbe);
  renderedNoViolations(await renderedOpen(browser, served.origin, signedOut));
});

test("the signed-out card does not scroll sideways on a phone, and nothing else is refused", async ({
  browser,
  served,
}) => {
  const rendered = await renderedOpen(browser, served.origin, signedOut);
  await renderedNoOverflow(rendered.page);
  renderedNoViolations(rendered, [zodProbeViolation]);
});

test("the tickets list loads with no policy violation", async ({
  browser,
  served,
}) => {
  test.fail(true, zodProbe);
  renderedNoViolations(await renderedOpen(browser, served.origin, ticketsList));
});

test("the tickets list does not scroll sideways on a phone, and nothing else is refused", async ({
  browser,
  served,
}) => {
  const rendered = await renderedOpen(browser, served.origin, ticketsList);
  await renderedNoOverflow(rendered.page);
  renderedNoViolations(rendered, [zodProbeViolation]);
  test.expect(served.unanswered).toEqual([]);
});
