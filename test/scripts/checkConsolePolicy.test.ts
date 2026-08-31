/**
 * The console policy check as it runs: the script, over a built document.
 *
 * `consolePolicy.test.ts` holds the decisions this reaches for;
 * what is held here is the wiring between them — that a finding reaches the
 * exit code, that a build the check could not read exits 2 rather than
 * printing a success line over it, and that the stylesheets are read as one
 * text in the order the document loads them. A decision nothing carries to an
 * exit code is a control that reports success and is believed, so the fixtures
 * are whole miniature `dist` directories rather than strings.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const script = join(process.cwd(), "scripts/check-console-policy.ts");
const built: string[] = [];

after(() => {
  for (const root of built) rmSync(root, { recursive: true, force: true });
});

/** One layer with one rule in it, which is all the cascade check reads. */
function layer(name: string): string {
  return `@layer ${name}{.a{color:red}}`;
}

/**
 * The sheets are named against the order they are linked in, so a fold that
 * sorted them — or read a directory — would draw a different cascade from the
 * one the document asks for.
 */
function sheetName(at: number, count: number): string {
  return `${String.fromCharCode("z".charCodeAt(0) - at)}-sheet-${String(count - at)}.css`;
}

function dist(
  sheets: readonly string[],
  document?: (links: string) => string,
): string {
  const root = mkdtempSync(join(tmpdir(), "chuggy-console-policy-"));
  built.push(root);
  mkdirSync(join(root, "assets"));
  const links = sheets
    .map((css, at) => {
      const name = sheetName(at, sheets.length);
      writeFileSync(join(root, "assets", name), css);
      return `<link rel="stylesheet" href="/assets/${name}">`;
    })
    .join("");
  const head =
    document === undefined ? `${links}${loadsScript}` : document(links);
  writeFileSync(
    join(root, "index.html"),
    `<!doctype html><html lang="en"><head>${head}</head><body><div id="root"></div></body></html>`,
  );
  return root;
}

const loadsScript = '<script type="module" src="/assets/index.js"></script>';

function ran(root: string): { readonly code: number; readonly said: string } {
  const done = spawnSync(process.execPath, [script, root], {
    encoding: "utf8",
  });
  return { code: done.status ?? 2, said: `${done.stdout}${done.stderr}` };
}

test("a build whose layers are in order passes, and says which order", () => {
  const done = ran(
    dist([["tokens", "base", "ui", "page"].map(layer).join("")]),
  );
  assert.equal(done.code, 0);
  assert.match(done.said, /declares tokens, base, ui, page in that order/u);
});

test("a build whose layers are emitted in the wrong order exits 1", () => {
  const done = ran(
    dist([["ui", "page", "tokens", "base"].map(layer).join("")]),
  );
  assert.equal(done.code, 1);
  assert.match(
    done.said,
    /layers emitted as ui, page, tokens, base, not tokens, base, ui, page/u,
  );
});

test("a layer the bundle never carried is the same finding", () => {
  const done = ran(dist([["tokens", "base", "ui"].map(layer).join("")]));
  assert.equal(done.code, 1);
  assert.match(done.said, /not tokens, base, ui, page/u);
});

test("the sheets are one text in the order the document loads them", () => {
  const split = ran(
    dist([
      ["tokens", "base"].map(layer).join(""),
      ["ui", "page"].map(layer).join(""),
    ]),
  );
  assert.equal(split.code, 0);
  assert.match(split.said, /z-sheet-2\.css,.*y-sheet-1\.css/u);
  const inverted = ran(
    dist([
      ["ui", "page"].map(layer).join(""),
      ["tokens", "base"].map(layer).join(""),
    ]),
  );
  assert.equal(inverted.code, 1);
  assert.match(inverted.said, /layers emitted as ui, page, tokens, base/u);
});

test("a stylesheet declaring no layer exits 2, not 0", () => {
  const done = ran(dist([".a{color:red}"]));
  assert.equal(done.code, 2);
  assert.match(
    done.said,
    /declares no layer, so the cascade could not be read/u,
  );
});

test("a document that loads no stylesheet exits 2, not 0", () => {
  const done = ran(dist([], () => loadsScript));
  assert.equal(done.code, 2);
  assert.match(done.said, /loads no stylesheet/u);
});

test("a stylesheet the build did not write exits 2, not 0", () => {
  const done = ran(
    dist(
      [],
      () => `<link rel="stylesheet" href="/assets/absent.css">${loadsScript}`,
    ),
  );
  assert.equal(done.code, 2);
  assert.match(done.said, /absent\.css could not be read/u);
});

test("the policy half still reaches the exit code beside the cascade", () => {
  const done = ran(
    dist(
      [["tokens", "base", "ui", "page"].map(layer).join("")],
      (links) =>
        `${links}<script type="module" src="https://cdn.example.invalid/x.js"></script>`,
    ),
  );
  assert.equal(done.code, 1);
  assert.match(done.said, /cdn\.example\.invalid/u);
});

test("a document root that was never built exits 2, not 0", () => {
  const done = ran(join(tmpdir(), "chuggy-console-policy-absent"));
  assert.equal(done.code, 2);
  assert.match(done.said, /could not be read/u);
});
