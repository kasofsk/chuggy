/**
 * The fixture transforms do nothing meaningful on purpose: what a prompt is
 * made of is not this module's, so one that looked real would be this suite
 * deciding it.
 *
 * What the spec refuses it refuses at compile time, so those cases are
 * `@ts-expect-error` over expressions the suite never calls — running one
 * would be running what the typechecker had already rejected. What a parse
 * can still hand over is a separate case, asserted the ordinary way.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { chainOf } from "../../src/briefing/chain.ts";
import { registryOf } from "../../src/briefing/registry.ts";
import type { Transform, TransformName } from "../../src/briefing/transform.ts";

interface View {
  readonly body: string;
}

interface Spec {
  readonly open: void;
  readonly append: { readonly mark: string };
  readonly repeat: { readonly mark: string; readonly times: number };
  readonly erase: void;
}

const opening: Transform<View, void> = (_input, view) => `<${view.body}>`;

const appending: Transform<View, Spec["append"]> = (input, _view, params) =>
  `${input}[${params.mark}]`;

const repeating: Transform<View, Spec["repeat"]> = (input, _view, params) =>
  `${input}${params.mark.repeat(params.times)}`;

const erasing: Transform<View, void> = () => "";

const registry = registryOf<View, Spec>({
  open: opening,
  append: appending,
  repeat: repeating,
  erase: erasing,
});

const view: View = { body: "B" };

/** What a parse that validated nothing hands over: the type is a claim, not a check. */
const asParsed = (name: string): TransformName<Spec> =>
  name as TransformName<Spec>;

test("transforms fold in pipeline order, left to right", () => {
  const composed = chainOf(registry)
    .add("open")
    .add("append", { mark: "a" })
    .add("append", { mark: "b" })
    .compose("", view);
  assert.equal(composed.prompt, "<B>[a][b]");
});

test("the same name added twice with different params is two steps", () => {
  const composed = chainOf(registry)
    .add("open")
    .add("repeat", { mark: "x", times: 2 })
    .add("repeat", { mark: "y", times: 3 })
    .compose("", view);
  assert.equal(composed.prompt, "<B>xxyyy");
});

test("params are bound where they are added, so a shared base keeps its own", () => {
  const base = chainOf(registry).add("open");
  const one = base.add("append", { mark: "a" });
  const other = base.add("append", { mark: "z" });
  assert.equal(one.compose("", view).prompt, "<B>[a]");
  assert.equal(other.compose("", view).prompt, "<B>[z]");
});

test("a transform opening a pipeline ignores its input, and is not a special kind", () => {
  const composed = chainOf(registry)
    .add("append", { mark: "a" })
    .add("open")
    .compose("seed", view);
  assert.equal(composed.prompt, "<B>");
});

test("the trace says what the prompt was after each transform", () => {
  const composed = chainOf(registry)
    .add("open")
    .add("append", { mark: "a" })
    .compose("", view);
  assert.deepEqual(
    composed.trace.map((entry) => entry.transformName),
    ["open", "append"],
  );
  assert.deepEqual(
    composed.trace.map((entry) => entry.output),
    ["<B>", "<B>[a]"],
  );
});

test("the prompt is what the last entry produced", () => {
  const composed = chainOf(registry).add("open").compose("", view);
  assert.equal(composed.prompt, composed.trace.at(-1)?.output);
});

test("adding returns a new chain and leaves the base untouched", () => {
  const base = chainOf(registry).add("open");
  const extended = base.add("append", { mark: "a" });
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
    () => chainOf(registry).add("open").add("erase").compose("", view),
    /composed no prompt after 2 transform\(s\), last erase/,
  );
});

test("a name that resolves to nothing is refused when it is added, not when it runs", () => {
  assert.throws(
    () => chainOf(registry).add(asParsed("absent"), { mark: "a" }),
    /no transform is registered as absent/,
  );
});

test("what the spec refuses, it refuses before anything runs", () => {
  const chain = chainOf(registry);
  const rejected = [
    // @ts-expect-error a name the spec has not got
    () => chain.add("absent"),
    // @ts-expect-error params for a name that declares none
    () => chain.add("open", { mark: "a" }),
    // @ts-expect-error no params for a name that declares some
    () => chain.add("append"),
    // @ts-expect-error params of the wrong shape for the name
    () => chain.add("append", { times: 2 }),
    // @ts-expect-error params of another name in the same spec
    () => chain.add("repeat", { mark: "a" }),
  ];
  assert.equal(rejected.length, 5);
});
