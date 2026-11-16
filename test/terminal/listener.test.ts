/**
 * The listener a sign-in returns to, over real HTTP: each answer with a page
 * is that page, in the catalog's words and the console's tokens, and an answer
 * without one is bodiless.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { copyTextEn } from "../../ui/chuggy-ui/app/copy/catalog.ts";
import type { Copy } from "../../ui/chuggy-ui/app/core/copy.ts";
import type { SetupAnswered } from "../../ui/chuggy-ui/app/core/setupPorts.ts";
import { listen } from "../../ui/chuggy-ui/terminal/listener.ts";
import {
  listenerPage,
  listenerPagePolicy,
  listenerPageTokens,
} from "../../ui/chuggy-ui/terminal/listenerPage.ts";

const host = "127.0.0.1";
const closeWaitMs = 1_000;

/** Every page the sign-in answers with, as `setupSignIn.ts` names them. */
const outcomes: readonly Copy[] = [
  { id: "setup-page-signed-in" },
  { id: "setup-page-unfinished" },
  { id: "setup-page-answered" },
  { id: "setup-page-nothing" },
];

/** What a browser is sent for `answered`, read without following a redirect. */
async function browsedTo(answered: SetupAnswered): Promise<Response> {
  const listening = await listen(host, () => Promise.resolve(answered));
  try {
    const response = await fetch(`http://${host}:${String(listening.port)}/`, {
      redirect: "manual",
    });
    await response.clone().arrayBuffer();
    return response;
  } finally {
    await listening.close(closeWaitMs);
  }
}

/** Each custom property `tokens.css` declares, its value with its whitespace folded as a formatter would write it on one line. */
function tokensDeclared(): ReadonlyMap<string, string> {
  const sheet = readFileSync(
    new URL("../../ui/chuggy-ui/app/styles/tokens.css", import.meta.url),
    "utf8",
  ).replaceAll(/\/\*[\s\S]*?\*\//gu, "");
  const declared = new Map<string, string>();
  for (const match of sheet.matchAll(/(--[\w-]+):([^;]*);/gu)) {
    const [, name, value] = match;
    if (name === undefined || value === undefined || declared.has(name))
      continue;
    declared.set(
      name,
      value
        .replaceAll(/\s+/gu, " ")
        .replaceAll("( ", "(")
        .replaceAll(" )", ")")
        .trim(),
    );
  }
  return declared;
}

test("every token the page draws with is the console's own, as tokens.css first declares it", () => {
  const declared = tokensDeclared();
  for (const [name, value] of Object.entries(listenerPageTokens))
    assert.equal(value, declared.get(name), name);
});

for (const outcome of outcomes)
  test(`the ${outcome.id} answer is an HTML page with the program's name, the outcome as its heading, and what to do next`, async () => {
    const response = await browsedTo({ status: 400, page: outcome });
    assert.equal(response.status, 400);
    assert.equal(
      response.headers.get("content-type"),
      "text/html; charset=utf-8",
    );
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(
      response.headers.get("content-security-policy"),
      listenerPagePolicy,
    );
    const body = await response.text();
    assert.equal(
      body,
      listenerPage(
        copyTextEn({ id: "setup-page-brand" }),
        copyTextEn(outcome),
        copyTextEn({ id: "setup-page-next" }),
      ),
    );
    assert.ok(body.includes(`<h1>${copyTextEn(outcome)}</h1>`));
    assert.ok(body.includes(`<p class="brand">chuggy</p>`));
    assert.ok(
      body.includes("<p>Go back to your agent. You can close this tab.</p>"),
    );
    assert.doesNotMatch(body, /<script|<link|src=|url\(/iu);
  });

test("an answer that redirects is bodiless and says no content type", async () => {
  const location = "https://issuer.example/authorize";
  const response = await browsedTo({ status: 302, location });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), location);
  assert.equal(response.headers.get("content-type"), null);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(await response.text(), "");
});

test("text the catalog writes is set as text, never as markup", () => {
  const page = listenerPage("a & b", "<b>bold</b>", 'say "so"');
  assert.ok(page.includes("<h1>&lt;b&gt;bold&lt;/b&gt;</h1>"));
  assert.ok(page.includes("a &amp; b"));
  assert.ok(page.includes("say &quot;so&quot;"));
});
