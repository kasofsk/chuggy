/**
 * Every message the setup program prints, formatted through the base
 * language's catalog with the variables its section's generated type declares:
 * an id the catalog holds no message for fails, and so does a variable the
 * type declares that the message does not take.
 *
 * @vitest-environment node
 */

import { expect, test } from "vitest";

import { copyCatalogEn, copyLocale } from "../app/copy/catalog.ts";
import { copyBundleOf } from "../app/copy/copyBundle.ts";
import setupCopy from "../app/core/generated/setupCopy.ts?raw";
import setupRunnerCopy from "../app/core/generated/setupRunnerCopy.ts?raw";

/** One id a section's type names, with the variables it declares. */
interface SetupCopyDeclared {
  readonly id: string;
  readonly variables: readonly string[];
}

/** Each id a generated module declares, read from its own text, so an id the
 * module names and the catalog lacks is still asked for. */
function setupCopyDeclared(module: string): readonly SetupCopyDeclared[] {
  const declared: { id: string; variables: string[] }[] = [];
  for (const line of module.split("\n")) {
    const id = /^ {2}readonly "([^"]+)":/u.exec(line)?.[1];
    if (id !== undefined) declared.push({ id, variables: [] });
    const variable = /^ {4}readonly ([\w$]+|"[^"]+"): unknown;$/u.exec(
      line,
    )?.[1];
    if (variable !== undefined)
      declared.at(-1)?.variables.push(variable.replace(/^"|"$/gu, ""));
  }
  return declared;
}

const setupDeclared = [
  ...setupCopyDeclared(setupCopy),
  ...setupCopyDeclared(setupRunnerCopy),
];

const setupBundle = copyBundleOf(copyLocale, copyCatalogEn);

/** Every error formatting a message with `given` raised. */
function setupFormatErrors(
  id: string,
  given: Readonly<Record<string, string>>,
): readonly string[] {
  const message = setupBundle.getMessage(id);
  if (message?.value === undefined || message.value === null)
    return [`the catalog holds no message ${id}`];
  const errors: Error[] = [];
  setupBundle.formatPattern(message.value, given, errors);
  return errors.map((error) => error.message);
}

/** The variables a message's pattern names as the runtime parsed it, in
 * every variant and in each message it references, each read once. */
function setupCopyTaken(id: string, seen: Set<string> = new Set()): string[] {
  seen.add(id);
  const taken: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const held = node as { readonly type?: unknown; readonly name?: unknown };
    if (held.type === "var" && typeof held.name === "string")
      taken.push(held.name);
    if (
      held.type === "mesg" &&
      typeof held.name === "string" &&
      !seen.has(held.name)
    )
      taken.push(...setupCopyTaken(held.name, seen));
    for (const value of Object.values(node)) walk(value);
  };
  walk(setupBundle.getMessage(id)?.value);
  return [...new Set(taken)];
}

/** What is wrong with one declared id: the errors formatting it with every
 * declared variable raised, each declared variable its pattern does not take,
 * and each it takes that its type does not declare. */
function setupCopyFaults({ id, variables }: SetupCopyDeclared): string[] {
  const given = Object.fromEntries(
    variables.map((name) => [name, `given-${name}`]),
  );
  const taken = setupCopyTaken(id);
  return [
    ...setupFormatErrors(id, given),
    ...variables
      .filter((name) => !taken.includes(name))
      .map((name) => `${id} does not take $${name}`),
    ...taken
      .filter((name) => !variables.includes(name))
      .map((name) => `${id} takes $${name}, which its type does not declare`),
  ];
}

test("the setup program's types declare messages for the suite to format", () => {
  expect(setupDeclared.length).toBeGreaterThan(1);
  expect(setupDeclared.some(({ variables }) => variables.length > 0)).toBe(
    true,
  );
});

test.each(setupDeclared)(
  "$id formats with the variables its type declares, and takes each",
  (declared) => {
    expect(setupCopyFaults(declared)).toStrictEqual([]);
  },
);

test("an id with no message, and a variable a message does not take, are faults", () => {
  const bare = setupDeclared.find(({ variables }) => variables.length === 0);
  if (bare === undefined) throw new Error("no setup message without variables");
  expect(
    setupCopyFaults({ id: "setup-no-such-message", variables: [] }),
  ).toStrictEqual(["the catalog holds no message setup-no-such-message"]);
  expect(setupCopyFaults({ id: bare.id, variables: ["absent"] })).toStrictEqual(
    [`${bare.id} does not take $absent`],
  );
  const varied = setupDeclared.find(({ variables }) => variables.length > 0);
  if (varied === undefined) throw new Error("no setup message with variables");
  const [first, ...others] = varied.variables;
  expect(setupCopyFaults({ id: varied.id, variables: others })).toContainEqual(
    `${varied.id} takes $${String(first)}, which its type does not declare`,
  );
});
