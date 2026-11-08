/**
 * The console's lint refuses copy a component spells, read from the
 * configuration `npm run lint` runs. It runs on Node, where the linter does.
 *
 * @vitest-environment node
 */

import { ESLint } from "eslint";
import { expect, test } from "vitest";

import source from "../app/browser/shell/DetailsPane.tsx?raw";

/** A file of the console's whose copy is all in the catalog. */
const migrated = decodeURIComponent(
  new URL("../app/browser/shell/DetailsPane.tsx", import.meta.url).pathname,
);

/** What the console's lint says of `text` as that file, by the copy rule
 * and of its directives, or by every rule. */
async function copyLintSaid(
  text: string,
  every = false,
): Promise<readonly string[]> {
  const [result] = await new ESLint().lintText(text, { filePath: migrated });
  return (result?.messages ?? [])
    .filter(
      (message) =>
        every ||
        message.ruleId === null ||
        message.ruleId === "copy/no-literal-text",
    )
    .map((message) => `${message.ruleId ?? "directive"}: ${message.message}`);
}

function copySpelledIn(from: string, to: string): string {
  expect(source).toContain(from);
  return source.replace(from, to);
}

test("a file whose copy is in the catalog is clean", async () => {
  expect(await copyLintSaid(source, true)).toStrictEqual([]);
});

test("text a component spells between its tags is a finding", async () => {
  const said = await copyLintSaid(
    copySpelledIn('{text({ id: "shell-details" })}\n', "Details\n"),
  );
  expect(said).toStrictEqual([
    "copy/no-literal-text: text a reader is shown comes from the copy catalog",
  ]);
});

test("an attribute a reader hears, spelled out, is a finding", async () => {
  const said = await copyLintSaid(
    copySpelledIn(
      'aria-label={text({ id: "shell-details" })}',
      'aria-label="Details"',
    ),
  );
  expect(said).toStrictEqual([
    "copy/no-literal-text: `aria-label` is shown to a reader, so its text comes from the copy catalog",
  ]);
});
