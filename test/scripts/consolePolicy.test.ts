/**
 * The console policy check, held to every finding it names and to the shapes
 * it must not miss.
 *
 * The quoting cases are the point: this is a control whose whole argument is
 * that it reads what a bundler wrote, and which quote style a bundler writes is
 * the bundler's business. A check that saw only one of them would report a
 * console loading its bundle from a content delivery network as clean. The
 * cascade cases are the same argument about the stylesheet: the order the
 * layers are emitted in is the order the browser applies them in, and a build
 * that inverts it changes no source file.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  consoleCascadeFindings,
  consoleCascadeLayers,
  consoleCascadeNames,
  consoleCollisionFindings,
  consolePolicyFetchingAttributes,
  consolePolicyFindings,
  consolePolicyStylesheetHrefs,
  consoleRawColourNames,
  consoleUtilitiesFindings,
} from "../../scripts/console-policy.ts";

const served = [
  "<!doctype html>",
  '<html lang="en"><head>',
  '<link rel="icon" href="data:," />',
  '<script type="module" crossorigin src="/assets/index-abc.js"></script>',
  '<link rel="stylesheet" crossorigin href="/assets/index-abc.css">',
  '</head><body><div id="root"></div></body></html>',
].join("\n");

test("the document a compliant build emits carries no finding", () => {
  assert.deepEqual(consolePolicyFindings(served), []);
});

test("an inline script is a finding, and one with a src is not", () => {
  assert.match(
    consolePolicyFindings(`${served}<script>window.x = 1;</script>`).join(" "),
    /inline <script>/u,
  );
  assert.deepEqual(consolePolicyFindings(served), []);
});

test("an inline style element and a style attribute are each a finding", () => {
  assert.match(
    consolePolicyFindings(`${served}<style>a{color:red}</style>`).join(" "),
    /inline <style>/u,
  );
  assert.match(
    consolePolicyFindings(`${served}<div style="color:red"></div>`).join(" "),
    /style attribute/u,
  );
});

test("a cross-origin subresource is found whichever way it is quoted", () => {
  const foreign = "https://cdn.example.invalid/x.js";
  for (const written of [
    `<script src="${foreign}"></script>`,
    `<script src='${foreign}'></script>`,
    `<script src=${foreign}></script>`,
  ]) {
    const findings = consolePolicyFindings(written);
    assert.equal(findings.length, 1, written);
    assert.match(findings[0] ?? "", /cdn\.example\.invalid/u);
  }
});

test("every fetching attribute is read, not only src and href", () => {
  for (const name of consolePolicyFetchingAttributes) {
    const value =
      name === "srcset" || name === "imagesrcset"
        ? "https://cdn.example.invalid/x.png 2x"
        : "https://cdn.example.invalid/x";
    const findings = consolePolicyFindings(`<x ${name}="${value}"></x>`);
    assert.equal(findings.length, 1, name);
    assert.match(findings[0] ?? "", /cdn\.example\.invalid/u);
  }
});

test("a srcset is a list, and one foreign entry among same-origin ones is found", () => {
  const findings = consolePolicyFindings(
    '<img srcset="/a.png 1x, https://cdn.example.invalid/b.png 2x, /c.png 3x">',
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0] ?? "", /cdn\.example\.invalid\/b\.png/u);
});

test("the same-origin forms a build actually writes are left alone", () => {
  assert.deepEqual(
    consolePolicyFindings(
      '<link href="/a.css"><img src="./b.png"><link href="data:,">',
    ),
    [],
  );
});

test("the attribute name is reported, so a finding says what to look at", () => {
  assert.match(
    consolePolicyFindings('<img poster="https://cdn.example.invalid/x">')[0] ??
      "",
    /^a poster of /u,
  );
});

const emitted = (order: readonly string[]): string =>
  order.map((name) => `@layer ${name}{a{color:red}}`).join("");

test("the order the minifier emits the layers in is the order asserted", () => {
  assert.deepEqual(consoleCascadeFindings(emitted(consoleCascadeLayers)), []);
  assert.match(
    consoleCascadeFindings(emitted(["ui", "page", "tokens", "base"]))[0] ?? "",
    /layers emitted as ui, page, tokens, base, not tokens, base, ui, page/u,
  );
});

test("a layer reopened later keeps the place it first took", () => {
  assert.deepEqual(
    consoleCascadeFindings(
      `${emitted(consoleCascadeLayers)}@layer base{a{color:red}}`,
    ),
    [],
  );
});

test("a layer the bundle never carried is a finding, not a shorter order", () => {
  assert.match(
    consoleCascadeFindings(emitted(["tokens", "base", "ui"]))[0] ?? "",
    /layers emitted as tokens, base, ui, not tokens, base, ui, page/u,
  );
});

test("the layers a build declares are what a document is asked for", () => {
  assert.deepEqual(consoleCascadeNames(emitted(["ui", "tokens"])), [
    "ui",
    "tokens",
  ]);
  assert.deepEqual(consoleCascadeNames("@layer tokens, base, ui, page;"), [
    "tokens",
    "base",
    "ui",
    "page",
  ]);
  assert.deepEqual(consoleCascadeNames(".a{color:red}"), []);
});

test("a layer the system does not order is a finding wherever it sits", () => {
  assert.match(
    consoleCascadeFindings(emitted(["tokens", "base", "vendor"]))[0] ?? "",
    /a layer named vendor/u,
  );
});

test("a statement kept by a build must name the order, and lead", () => {
  assert.deepEqual(
    consoleCascadeFindings(
      `@layer ${consoleCascadeLayers.join(", ")};${emitted(["ui", "tokens"])}`,
    ),
    [],
  );
  assert.match(
    consoleCascadeFindings(
      `@layer base, tokens, ui, page;@layer base{a{b:c}}`,
    )[0] ?? "",
    /a layer statement of base, tokens, ui, page/u,
  );
  assert.match(
    consoleCascadeFindings(
      `@layer ui{a{b:c}}@layer ${consoleCascadeLayers.join(", ")};`,
    ).join(" "),
    /a layer opened above the statement/u,
  );
});

test("the stylesheets a document loads are the ones read", () => {
  assert.deepEqual(consolePolicyStylesheetHrefs(served), [
    "/assets/index-abc.css",
  ]);
  assert.deepEqual(
    consolePolicyStylesheetHrefs('<link rel="icon" href="/favicon.ico">'),
    [],
  );
});

const utilities = (rules: string): string =>
  `@layer tokens{:root{--ink-1:#151a17}}@layer utilities{${rules}}`;

test("a utilities layer drawing from the tokens carries no finding", () => {
  assert.deepEqual(
    consoleUtilitiesFindings(
      utilities(
        ".text-ink-1{color:var(--ink-1)}.p-0{padding:0}.b{border-width:1px}" +
          ".w-\\[50\\%\\]{width:50%}.text-\\[1\\.2em\\]{font-size:1.2em}" +
          ".truncate{white-space:nowrap}.m-0{margin:0px}",
      ),
    ),
    [],
  );
});

test("a raw colour in the utilities layer is a finding, however written", () => {
  for (const [rules, said] of [
    [".text-\\[x\\]{color:#fff}", /#fff in the utilities layer/u],
    [".bg-x{background:rgb(1 2 3)}", /rgb\(\) in the utilities layer/u],
    [".bg-y{background:red}", /red in the utilities layer/u],
  ] as const) {
    const findings = consoleUtilitiesFindings(utilities(rules));
    assert.match(findings.join(" "), said);
  }
});

test("a raw length in the utilities layer is a finding, and 0 and 1px are not", () => {
  assert.match(
    consoleUtilitiesFindings(utilities(".max-w-\\[x\\]{max-width:34rem}")).join(
      " ",
    ),
    /34rem in the utilities layer, a raw length/u,
  );
  assert.match(
    consoleUtilitiesFindings(utilities(".sr{margin:-1px}")).join(" "),
    /-1px in the utilities layer, a raw length/u,
  );
});

test("only the utilities layer is judged, so the tokens may state values", () => {
  assert.deepEqual(
    consoleUtilitiesFindings(
      "@layer tokens{:root{--ink-1:#151a17;--space-2:0.5rem}}" +
        "@layer ui{.pill{color:var(--ink-1)}}",
    ),
    [],
  );
  assert.match(
    consoleUtilitiesFindings(
      `@layer utilities{@media (width >= 40em){.narrow\\:x{color:#fff}}}`,
    ).join(" "),
    /#fff in the utilities layer/u,
  );
});

test("the named colours are the roster the sheet gate states", () => {
  const gate = readFileSync(".chug/tasks/check-console-sheets.sh", "utf8");
  const stated = /split\("([^;]*?)", *\\\n\t\tname, " "\)/u.exec(gate);
  assert.notEqual(stated, null);
  assert.deepEqual(
    (stated?.[1] ?? "")
      .replace(/" *\\\n\t*"/gu, "")
      .trim()
      .split(/\s+/u),
    [...consoleRawColourNames],
  );
});

test("a class the utilities layer emits and a layered sheet selects is a finding", () => {
  const findings = consoleCollisionFindings(
    "@layer utilities{.table{display:table}}@layer ui{.table{width:100%}}",
  );
  assert.match(
    findings.join(" "),
    /a class `\.table` the utilities layer emits and a layered sheet selects/u,
  );
});

test("a class in the utilities layer alone carries no collision finding", () => {
  assert.deepEqual(
    consoleCollisionFindings("@layer utilities{.hidden{display:none}}"),
    [],
  );
});

test("a class in a layered sheet alone carries no collision finding", () => {
  assert.deepEqual(
    consoleCollisionFindings("@layer ui{.table{width:100%}}"),
    [],
  );
});

test("no utilities layer at all carries no collision finding", () => {
  assert.deepEqual(
    consoleCollisionFindings(
      "@layer tokens{:root{--ink-1:#151a17}}@layer ui{.table{width:100%}}",
    ),
    [],
  );
});

test("an escaped arbitrary-value name cannot collide and is skipped", () => {
  assert.deepEqual(
    consoleCollisionFindings(
      "@layer utilities{.grid-cols-\\[1fr\\]{grid-template-columns:1fr}}" +
        "@layer ui{.grid-cols-\\[1fr\\]{color:red}}",
    ),
    [],
  );
});

test("the layer tailwind writes beside its utilities takes no place", () => {
  assert.deepEqual(
    consoleCascadeFindings(
      `${emitted(consoleCascadeLayers)}@layer properties{*{--tw-x:initial}}`,
    ),
    [],
  );
  assert.match(
    consoleCascadeFindings(
      `${emitted(consoleCascadeLayers)}@layer vendor{a{b:c}}`,
    )[0] ?? "",
    /a layer named vendor/u,
  );
});
