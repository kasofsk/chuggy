/**
 * Code coloured by what each run of it is: which fences are coloured, that a
 * coloured block is the same characters it was, and that colour arriving
 * changes nothing a reader copies or a mark sits on.
 *
 * The grammars are a chunk fetched when code is first drawn, so the component
 * cases wait for them once and are drawn coloured from then on.
 */

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { markdownMarkClassName } from "../app/browser/ui/MarkdownBlocks.tsx";
import { MarkdownReport } from "../app/browser/ui/MarkdownReport.tsx";
import {
  markdownSyntaxCharsMax,
  markdownSyntaxLanguage,
  markdownSyntaxLanguages,
} from "../app/browser/ui/markdownSyntax.ts";
import type { MarkdownSyntaxNode } from "../app/browser/ui/markdownSyntax.ts";
import {
  markdownSyntaxDepthMax,
  markdownSyntaxGrammarNames,
  markdownSyntaxRead,
} from "../app/browser/ui/markdownSyntaxRead.ts";
import { corpusAnswers, corpusReview } from "./markdownCorpus.ts";
import { styleless } from "./styleless.ts";

function characters(nodes: readonly MarkdownSyntaxNode[]): string {
  return nodes
    .map((node) =>
      typeof node === "string" ? node : characters(node.children),
    )
    .join("");
}

/** Each scope a reading names, with the characters it holds. */
function scopes(
  nodes: readonly MarkdownSyntaxNode[],
): readonly (readonly [string, string])[] {
  return nodes.flatMap((node) =>
    typeof node === "string"
      ? []
      : [
          [node.scope, characters(node.children)] as const,
          ...scopes(node.children),
        ],
  );
}

function depth(nodes: readonly MarkdownSyntaxNode[]): number {
  return nodes.reduce(
    (deepest, node) =>
      typeof node === "string"
        ? deepest
        : Math.max(deepest, 1 + depth(node.children)),
    0,
  );
}

afterEach(cleanup);

describe("which fences are coloured", () => {
  test("a language is known by the names a fence gives it, in any case", () => {
    expect(markdownSyntaxLanguage("ts")).toBe("typescript");
    expect(markdownSyntaxLanguage("TypeScript")).toBe("typescript");
    expect(markdownSyntaxLanguage("sh")).toBe("bash");
    expect(markdownSyntaxLanguage("yml")).toBe("yaml");
    expect(markdownSyntaxLanguage("html")).toBe("xml");
  });

  test("a name outside the table, no name, and a name every object has are no language", () => {
    for (const named of ["", "quint", "text", "constructor", "__proto__"])
      expect(markdownSyntaxLanguage(named)).toBeUndefined();
    expect(markdownSyntaxRead("x", "constructor")).toBeUndefined();
    expect(markdownSyntaxRead("x", "quint")).toBeUndefined();
  });

  test("the table names every grammar the chunk carries, and no other", () => {
    expect([...new Set(Object.values(markdownSyntaxLanguages))].sort()).toEqual(
      [...markdownSyntaxGrammarNames()].sort(),
    );
  });
});

describe("a block read into its runs", () => {
  test("names what each run is", () => {
    const read = markdownSyntaxRead(
      'const wait = 250; // "soon"\nreturn `in ${wait}`;',
      "typescript",
    );
    expect(scopes(read ?? [])).toEqual(
      expect.arrayContaining([
        ["hljs-keyword", "const"],
        ["hljs-number", "250"],
        ["hljs-comment", '// "soon"'],
        ["hljs-keyword", "return"],
        ["hljs-subst", "${wait}"],
      ]),
    );
  });

  test("is the characters it was, in every language and at every moment of being written", () => {
    const fence = /```(\w+)\n([\s\S]*?)```/g;
    const fences = Object.values(corpusAnswers).flatMap((text) =>
      Array.from(text.matchAll(fence), (found) => [found[1], found[2]]),
    );
    expect(fences.length).toBeGreaterThan(3);
    for (const [named, code] of fences) {
      const language = markdownSyntaxLanguage(named ?? "");
      if (language === undefined || code === undefined) continue;
      for (let length = 0; length <= code.length; length += 1) {
        const written = code.slice(0, length);
        expect(characters(markdownSyntaxRead(written, language) ?? [])).toBe(
          written,
        );
      }
    }
  });

  test("keeps only the highlighter's own class names", () => {
    const read = markdownSyntaxRead(
      "function wait(ms: number): void {}\nclass Fold {}",
      "typescript",
    );
    const named = scopes(read ?? []).map(([scope]) => scope);
    expect(named).toContain("hljs-title");
    for (const scope of named)
      for (const name of scope.split(" ").filter((part) => part !== ""))
        expect(name.startsWith("hljs-")).toBe(true);
  });

  test("nests no deeper than its bound, and loses no character past it", () => {
    const levels = markdownSyntaxDepthMax * 2;
    const code = `${"`a${".repeat(levels)}1${"}`".repeat(levels)};`;
    const read = markdownSyntaxRead(code, "javascript") ?? [];
    expect(characters(read)).toBe(code);
    expect(depth(read)).toBeLessThanOrEqual(markdownSyntaxDepthMax);
    expect(depth(read)).toBeGreaterThan(2);
  });
});

async function coloured(text: string, writing = false): Promise<HTMLElement> {
  const view = render(<MarkdownReport text={text} bare writing={writing} />);
  await waitFor(() => {
    expect(view.container.querySelector('[class^="hljs-"]')).not.toBeNull();
  });
  return view.container;
}

describe("a block of code drawn", () => {
  const fenced = "Wait:\n\n```ts\nconst wait = 250;\nreturn wait;\n```";

  test("is coloured by class once the grammars arrive, and is the same characters", async () => {
    const container = await coloured(fenced);
    const code = container.querySelector("pre > code");
    expect(code?.textContent).toBe("const wait = 250;\nreturn wait;");
    expect(
      Array.from(
        code?.querySelectorAll(".hljs-keyword") ?? [],
        (run) => run.textContent,
      ),
    ).toEqual(["const", "return"]);
    expect(code?.querySelector(".hljs-number")?.textContent).toBe("250");
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
    expect(
      Array.from(code?.querySelectorAll("*") ?? [], (run) => run.tagName),
    ).toEqual(expect.arrayContaining(["SPAN"]));
    expect(code?.querySelectorAll(":not(span)")).toHaveLength(0);
    styleless();
  });

  test("being written carries the mark where it did, and is what the whole text is drawn as", async () => {
    const whole = (await coloured(fenced)).innerHTML;
    cleanup();
    const container = await coloured(fenced, true);
    const marked = container.querySelectorAll(`.${markdownMarkClassName}`);
    expect(marked).toHaveLength(1);
    expect(marked.item(0).tagName).toBe("CODE");
    marked.item(0).removeAttribute("class");
    expect(container.innerHTML).toBe(whole);
  });

  test("in no language, or one that is not coloured, is drawn as its characters", async () => {
    await coloured(fenced);
    cleanup();
    for (const named of ["", "quint", "text"]) {
      const view = render(
        <MarkdownReport
          text={`\`\`\`${named}\nconst wait = 250;\n\`\`\``}
          bare
        />,
      );
      const code = view.container.querySelector("pre > code");
      expect(code?.textContent).toBe("const wait = 250;");
      expect(code?.childElementCount).toBe(0);
      cleanup();
    }
  });

  test("longer than the bound is drawn as its characters", async () => {
    await coloured(fenced);
    cleanup();
    const line = "const wait = 250;\n";
    const long = line.repeat(
      Math.ceil(markdownSyntaxCharsMax / line.length) + 1,
    );
    const view = render(
      <MarkdownReport text={`\`\`\`ts\n${long}\`\`\``} bare />,
    );
    const code = view.container.querySelector("pre > code");
    expect(code?.textContent.length).toBeGreaterThan(markdownSyntaxCharsMax);
    expect(code?.childElementCount).toBe(0);
  });

  test("of an answer as a model writes one is coloured in each language it names", async () => {
    const container = await coloured(corpusReview);
    const blocks = Array.from(container.querySelectorAll("pre > code"));
    expect(blocks).toHaveLength(3);
    for (const block of blocks)
      expect(block.querySelector('[class^="hljs-"]')).not.toBeNull();
  });
});
