/**
 * The console's lint refuses `removeQueries` and `resetQueries` under `app/`,
 * read from the configuration `npm run lint` runs, so a rule scoped to a path
 * that does not exist, or dropped by a preset, fails here rather than reading
 * like a rule that is working. It runs on Node, where the linter does.
 *
 * @vitest-environment node
 */

import { ESLint, Linter } from "eslint";
import { expect, test } from "vitest";

/** A file of the console's, named from this suite's own place. */
function consoleFileOf(relative: string): string {
  return decodeURIComponent(new URL(relative, import.meta.url).pathname);
}

/** The rule as the console's configuration resolves it for one file. */
async function consoleRuleFor(
  path: string,
): Promise<Linter.RuleEntry | undefined> {
  const resolved = (await new ESLint().calculateConfigForFile(path)) as {
    readonly rules?: Readonly<Record<string, Linter.RuleEntry>>;
  };
  return resolved.rules?.["no-restricted-syntax"];
}

/** What that rule says of `source`. */
function consoleRuleSaid(
  entry: Linter.RuleEntry | undefined,
  source: string,
): readonly string[] {
  if (entry === undefined) return [];
  return new Linter()
    .verify(source, { rules: { "no-restricted-syntax": entry } })
    .map((message) => message.message);
}

test("a new removeQueries or resetQueries call under app/ is a finding", async () => {
  const entry = await consoleRuleFor(
    consoleFileOf("../app/browser/stream.tsx"),
  );
  expect(
    consoleRuleSaid(entry, "client.removeQueries({ queryKey: key });"),
  ).toHaveLength(1);
  expect(
    consoleRuleSaid(entry, "client.resetQueries({ queryKey: key });"),
  ).toHaveLength(1);
  expect(
    consoleRuleSaid(entry, "void client.invalidateQueries({ queryKey: key });"),
  ).toEqual([]);
});

test("a suite may still remove or reset an entry", async () => {
  const entry = await consoleRuleFor(
    consoleFileOf("./consoleTimeline.test.tsx"),
  );
  expect(
    consoleRuleSaid(entry, "client.removeQueries({ queryKey: key });"),
  ).toEqual([]);
});
