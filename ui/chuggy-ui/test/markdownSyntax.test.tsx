/**
 * Code coloured by what each run of it is: which fences are coloured, that a
 * coloured block is the same characters it was, and that colour arriving
 * changes nothing a reader copies or a mark sits on.
 *
 * The reading itself is a pure function and is asserted as one. What draws a
 * block is handed a worker by `MarkdownProvider`, and here that is
 * `markdownSyntaxDouble.ts`'s: one that reads as the real worker does, or one
 * that says only what a case has it say. The desk between the two has its own
 * suite, `markdownSyntaxDesk.test.ts`.
 *
 * Every run of a grammar is counted, because the double runs them in the
 * thread the page is drawn in and the page itself must run none.
 */

import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type * as Lowlight from "lowlight";
import type { ReactNode } from "react";

import { markdownMarkClassName } from "../app/browser/ui/MarkdownBlocks.tsx";
import { MarkdownProvider } from "../app/browser/ui/markdownHeld.ts";
import { MarkdownReport } from "../app/browser/ui/MarkdownReport.tsx";
import {
  markdownSyntaxLanguage,
  markdownSyntaxLanguages,
} from "../app/browser/ui/markdownSyntax.ts";
import type { MarkdownSyntaxNode } from "../app/browser/ui/markdownSyntax.ts";
import {
  markdownSyntaxAnswered,
  markdownSyntaxDepthMax,
  markdownSyntaxGrammarNames,
  markdownSyntaxRead,
  markdownSyntaxScopesMax,
} from "../app/browser/ui/markdownSyntaxRead.ts";
import { corpusAnswers, corpusReview } from "./markdownCorpus.ts";
import {
  syntaxDoubleHeld,
  syntaxDoubleReading,
} from "./markdownSyntaxDouble.ts";
import type { SyntaxDouble } from "./markdownSyntaxDouble.ts";
import { styleless } from "./styleless.ts";

/** How many times a grammar has been run in this thread, which for the page
 * is the thread a reader is waiting on. */
const grammars = vi.hoisted(() => ({ run: 0 }));

vi.mock("lowlight", async (original) => {
  const real = await original<typeof Lowlight>();
  return {
    ...real,
    createLowlight: (...held: Parameters<typeof real.createLowlight>) => {
      const made = real.createLowlight(...held);
      return {
        ...made,
        highlight: (language: string, code: string) => {
          grammars.run += 1;
          return made.highlight(language, code);
        },
      };
    },
  };
});

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
    expect(markdownSyntaxDepthMax).toBe(8);
    const code = `${"`a${".repeat(16)}1${"}`".repeat(16)};`;
    const read = markdownSyntaxRead(code, "javascript") ?? [];
    expect(characters(read)).toBe(code);
    expect(depth(read)).toBe(8);
  });

  test("is coloured with no more scopes than its bound, and what follows them is one run of characters", () => {
    expect(markdownSyntaxScopesMax).toBe(16_384);
    const code = "1 ".repeat(20_000);
    const read = markdownSyntaxRead(code, "typescript") ?? [];
    expect(characters(read)).toBe(code);
    expect(scopes(read)).toHaveLength(16_384);
    expect(read.at(-1)).toBe(code.slice(16_384 * 2 - 1));
  });
});

describe("what a worker answers", () => {
  test("is the runs of the block it was asked about, under the number it was asked with", () => {
    const answer = markdownSyntaxAnswered({
      id: 4,
      code: "const wait = 250;",
      language: "typescript",
    });
    expect(answer?.id).toBe(4);
    expect(characters(answer?.runs ?? [])).toBe("const wait = 250;");
    expect(scopes(answer?.runs ?? [])).toContainEqual([
      "hljs-keyword",
      "const",
    ]);
  });

  test("is no runs for a language it has no grammar for", () => {
    expect(
      markdownSyntaxAnswered({ id: 5, code: "x", language: "quint" }),
    ).toEqual({ id: 5, runs: undefined });
  });

  test("is nothing for a message that asks nothing", () => {
    const messages: readonly unknown[] = [
      undefined,
      null,
      "const wait = 250;",
      { id: "4", code: "x", language: "typescript" },
      { id: 4, code: 250, language: "typescript" },
      { id: 4, code: "x" },
    ];
    for (const message of messages)
      expect(markdownSyntaxAnswered(message)).toBeUndefined();
  });
});

/**
 * A report drawn under a provider whose workers are a double's, on a clock
 * that stands still: a block rests after a reading for a multiple of the time
 * the reading took, and a case that has one block read twice must not have to
 * wait a rest out.
 */
function mounted(
  double: SyntaxDouble,
  text: string,
  writing = false,
): RenderResult {
  const wrapper = (props: { readonly children: ReactNode }): ReactNode => (
    <MarkdownProvider clock={() => 0} syntax={double.open}>
      {props.children}
    </MarkdownProvider>
  );
  return render(<MarkdownReport text={text} bare writing={writing} />, {
    wrapper,
  });
}

function blocks(container: HTMLElement): readonly Element[] {
  return Array.from(container.querySelectorAll("pre > code"));
}

async function coloured(text: string, writing = false): Promise<HTMLElement> {
  const view = mounted(syntaxDoubleReading(), text, writing);
  await waitFor(() => {
    for (const block of blocks(view.container))
      expect(block.querySelector('[class^="hljs-"]')).not.toBeNull();
  });
  return view.container;
}

/** The newest worker of a double answers the last thing it was asked, as the
 * real one would. */
function answered(double: SyntaxDouble): void {
  const worker = double.workers.at(-1);
  act(() => {
    worker?.say({ ready: true });
    worker?.say(markdownSyntaxAnswered(worker.asked.at(-1)));
  });
}

describe("a block of code drawn", () => {
  const fenced = "Wait:\n\n```ts\nconst wait = 250;\nreturn wait;\n```";

  test("is its characters at once, and coloured by class when its reading comes back, the same characters", async () => {
    const view = mounted(syntaxDoubleReading(), fenced);
    const [code] = blocks(view.container);
    expect(code?.textContent).toBe("const wait = 250;\nreturn wait;");
    expect(code?.childElementCount).toBe(0);
    await waitFor(() => {
      expect(code?.querySelector(".hljs-number")?.textContent).toBe("250");
    });
    expect(blocks(view.container)[0]).toBe(code);
    expect(code?.textContent).toBe("const wait = 250;\nreturn wait;");
    expect(
      Array.from(
        code?.querySelectorAll(".hljs-keyword") ?? [],
        (run) => run.textContent,
      ),
    ).toEqual(["const", "return"]);
    expect(view.container.querySelectorAll("[style]")).toHaveLength(0);
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

  test("in no language, or one outside the table, is its characters and no worker is started for it", () => {
    for (const named of ["", "quint", "text", "constructor"]) {
      const double = syntaxDoubleHeld();
      const view = mounted(double, `\`\`\`${named}\nconst wait = 250;\n\`\`\``);
      const [code] = blocks(view.container);
      expect(code?.textContent).toBe("const wait = 250;");
      expect(code?.childElementCount).toBe(0);
      expect(double.workers).toHaveLength(0);
      cleanup();
    }
  });

  test("with nothing to have it read is its characters, and stays them", async () => {
    const view = render(<MarkdownReport text={fenced} bare />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const [code] = blocks(view.container);
    expect(code?.textContent).toBe("const wait = 250;\nreturn wait;");
    expect(code?.childElementCount).toBe(0);
  });

  test("as long as an ordinary file is coloured to its last line", async () => {
    const long = "const wait = 250;\n".repeat(2_000);
    const container = await coloured(`\`\`\`ts\n${long}\`\`\``);
    const [code] = blocks(container);
    expect(code?.textContent).toBe(long.slice(0, -1));
    expect(code?.querySelectorAll(".hljs-keyword")).toHaveLength(2_000);
  });

  test("of an answer as a model writes one is coloured in each language it names", async () => {
    const container = await coloured(corpusReview);
    expect(blocks(container)).toHaveLength(3);
    for (const block of blocks(container))
      expect(block.querySelector('[class^="hljs-"]')).not.toBeNull();
  });
});

function keywords(code: Element | undefined): readonly string[] {
  return Array.from(
    code?.querySelectorAll(".hljs-keyword") ?? [],
    (run) => run.textContent,
  );
}

describe("the thread a block of code is drawn in", () => {
  test("is handed to its worker, and no grammar is run where it is drawn", () => {
    const double = syntaxDoubleHeld();
    grammars.run = 0;
    const view = mounted(
      double,
      "Wait:\n\n```ts\nconst wait = 250;\nreturn wait;\n```",
    );
    act(() => {
      double.workers[0]?.say({ ready: true });
    });
    expect(double.workers[0]?.asked.map((asked) => asked.code)).toEqual([
      "const wait = 250;\nreturn wait;",
    ]);
    expect(blocks(view.container)[0]?.childElementCount).toBe(0);
    expect(grammars.run).toBe(0);
    answered(double);
    expect(grammars.run).toBe(1);
    expect(blocks(view.container)[0]?.childElementCount).toBeGreaterThan(0);
  });
});

describe("a block of code that moves under its reading", () => {
  test("keeps the colours of what was read while it grows, and what was written since follows as characters", () => {
    const double = syntaxDoubleHeld();
    const view = mounted(double, "```ts\nconst a = 1;", true);
    answered(double);
    const [code] = blocks(view.container);
    expect(keywords(code)).toEqual(["const"]);
    view.rerender(
      <MarkdownReport text={"```ts\nconst a = 1;\nlet b"} bare writing />,
    );
    expect(blocks(view.container)[0]).toBe(code);
    expect(code?.textContent).toBe("const a = 1;\nlet b");
    expect(keywords(code)).toEqual(["const"]);
    expect(code?.lastChild?.textContent).toBe("\nlet b");
    answered(double);
    expect(code?.textContent).toBe("const a = 1;\nlet b");
    expect(keywords(code)).toEqual(["const", "let"]);
  });

  test("drops a reading of a text it no longer begins with", () => {
    const double = syntaxDoubleHeld();
    const view = mounted(double, "```ts\nconst a = 1;\n```");
    answered(double);
    const [code] = blocks(view.container);
    expect(keywords(code)).toEqual(["const"]);
    view.rerender(<MarkdownReport text={"```ts\nlet b = 2;\n```"} bare />);
    expect(blocks(view.container)[0]).toBe(code);
    expect(code?.textContent).toBe("let b = 2;");
    expect(code?.childElementCount).toBe(0);
    answered(double);
    expect(keywords(code)).toEqual(["let"]);
  });

  test("is not drawn in the colours of an answer to a text it has since left behind", () => {
    const double = syntaxDoubleHeld();
    const view = mounted(double, "```ts\nconst a = 1;\n```");
    const worker = double.workers[0];
    const first = worker?.asked[0];
    view.rerender(<MarkdownReport text={"```ts\nlet b = 2;\n```"} bare />);
    act(() => {
      worker?.say({ ready: true });
      worker?.say(markdownSyntaxAnswered(first));
    });
    const [code] = blocks(view.container);
    expect(code?.textContent).toBe("let b = 2;");
    expect(code?.childElementCount).toBe(0);
  });

  test("named in another language is not drawn in the colours of the one it was read in", () => {
    const double = syntaxDoubleHeld();
    const view = mounted(double, "```ts\nconst a = 1;\n```");
    answered(double);
    view.rerender(<MarkdownReport text={"```quint\nconst a = 1;\n```"} bare />);
    const [code] = blocks(view.container);
    expect(code?.textContent).toBe("const a = 1;");
    expect(code?.childElementCount).toBe(0);
  });
});
