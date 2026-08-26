/**
 * The console policy check, held to every finding it names and to the shapes
 * it must not miss.
 *
 * The quoting cases are the point: this is a control whose whole argument is
 * that it reads what a bundler wrote, and which quote style a bundler writes is
 * the bundler's business. A check that saw only one of them would report a
 * console loading its bundle from a content delivery network as clean.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  consolePolicyFetchingAttributes,
  consolePolicyFindings,
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
