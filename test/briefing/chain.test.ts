/**
 * The fixture transforms do nothing meaningful on purpose: what a prompt is
 * made of is not this module's, so one that looked real would be this suite
 * deciding it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { chainOf } from "../../src/briefing/chain.ts";
import { asTransformName } from "../../src/briefing/names.ts";
import { registryOf } from "../../src/briefing/registry.ts";
import type { Transform } from "../../src/briefing/transform.ts";

interface View {
  readonly body: string;
}

function appending(mark: string): Transform<View> {
  return (input) => `${input}[${mark}]`;
}

const opening: Transform<View> = (_input, view) => `<${view.body}>`;

const erasing: Transform<View> = () => "";

const open = asTransformName("open");
const alpha = asTransformName("alpha");
const beta = asTransformName("beta");
const erase = asTransformName("erase");

const registry = registryOf<View>([
  [open, opening],
  [alpha, appending("a")],
  [beta, appending("b")],
  [erase, erasing],
]);

const view: View = { body: "B" };

test("transforms fold in pipeline order, left to right", () => {
  const composed = chainOf(registry)
    .add(open)
    .add(alpha)
    .add(beta)
    .compose("", view);
  assert.equal(composed.prompt, "<B>[a][b]");
});

test("a transform opening a pipeline ignores its input, and is not a special kind", () => {
  const composed = chainOf(registry).add(alpha).add(open).compose("seed", view);
  assert.equal(composed.prompt, "<B>");
});

test("the trace says what the prompt was after each transform", () => {
  const composed = chainOf(registry).add(open).add(alpha).compose("", view);
  assert.deepEqual(
    composed.trace.map((entry) => entry.transformName),
    ["open", "alpha"],
  );
  assert.deepEqual(
    composed.trace.map((entry) => entry.output),
    ["<B>", "<B>[a]"],
  );
});

test("the prompt is what the last entry produced", () => {
  const composed = chainOf(registry).add(open).add(alpha).compose("", view);
  assert.equal(composed.prompt, composed.trace.at(-1)?.output);
});

test("a name the registry has not got fails when it is added, not when it runs", () => {
  assert.throws(
    () => chainOf(registry).add(asTransformName("absent")),
    /no transform is registered/,
  );
});

test("adding returns a new chain and leaves the base untouched", () => {
  const base = chainOf(registry).add(open);
  const extended = base.add(alpha);
  assert.equal(base.compose("", view).prompt, "<B>");
  assert.equal(extended.compose("", view).prompt, "<B>[a]");
});

test("an empty chain refuses, and says it was empty", () => {
  assert.throws(
    () => chainOf(registry).compose("", view),
    /composed no prompt after an empty chain/,
  );
});

test("a chain erased to nothing refuses, naming how far it got", () => {
  assert.throws(
    () => chainOf(registry).add(open).add(erase).compose("", view),
    /composed no prompt after 2 transform\(s\), last erase/,
  );
});

test("a blank transform name refuses", () => {
  assert.throws(() => asTransformName("  "), /transform name: blank/);
});

test("a registry refuses a name declared twice rather than replacing it", () => {
  assert.throws(
    () =>
      registryOf<View>([
        [alpha, appending("a")],
        [alpha, appending("b")],
      ]),
    /alpha is declared twice/,
  );
});
