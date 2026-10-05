/**
 * What is drawn where the parser, or a grammar, gives up on a text.
 *
 * Neither is known to on a text that reaches it: the guard and the
 * highlighter's own safe mode are there so that none does. The case is the
 * text nobody has found yet, so each is made to throw here, on a word no other
 * suite writes, the way an engine out of stack does.
 */

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type * as Lowlight from "lowlight";
import type * as Parser from "mdast-util-from-markdown";

import { MarkdownProvider } from "../app/browser/ui/markdownHeld.ts";
import {
  MarkdownLine,
  MarkdownReport,
} from "../app/browser/ui/MarkdownReport.tsx";
import {
  markdownSyntaxAnswered,
  markdownSyntaxRead,
} from "../app/browser/ui/markdownSyntaxRead.ts";
import { syntaxDoubleReading } from "./markdownSyntaxDouble.ts";

const given = vi.hoisted(() => ({
  word: "overflowing",
  up: (): never => {
    throw new RangeError("Maximum call stack size exceeded");
  },
}));

vi.mock("mdast-util-from-markdown", async (original) => {
  const real = await original<typeof Parser>();
  return {
    ...real,
    fromMarkdown: (text: string, options: Parser.Options) =>
      text.includes(given.word) ? given.up() : real.fromMarkdown(text, options),
  };
});

vi.mock("lowlight", async (original) => {
  const real = await original<typeof Lowlight>();
  return {
    ...real,
    createLowlight: (...grammars: Parameters<typeof real.createLowlight>) => {
      const made = real.createLowlight(...grammars);
      return {
        ...made,
        highlight: (language: string, code: string) =>
          code.includes(given.word)
            ? given.up()
            : made.highlight(language, code),
      };
    },
  };
});

afterEach(cleanup);

describe("a text the parser gives up on", () => {
  const text = "An overflowing **text**.\n\n```ts\nconst a = 1;\n```";

  test("is drawn as its characters, and the code after it is still code", () => {
    const view = render(<MarkdownReport text={text} bare />);
    expect(view.container.querySelector("p")?.textContent).toBe(
      "An overflowing **text**.",
    );
    expect(view.container.querySelectorAll("strong")).toHaveLength(0);
    expect(view.container.querySelector("pre > code")?.textContent).toBe(
      "const a = 1;",
    );
  });

  test("is drawn as its characters at every moment it is written", () => {
    const view = render(<MarkdownReport text="" bare writing />);
    for (let length = 1; length <= text.length; length += 1) {
      const written = text.slice(0, length);
      view.rerender(<MarkdownReport text={written} bare writing />);
      if (!written.includes(given.word)) continue;
      expect(view.container.querySelectorAll("strong")).toHaveLength(0);
      expect(view.container.querySelector("p")?.textContent).toContain(
        written.slice(0, 24),
      );
    }
  });

  test("is, as one line, the line as it was written", () => {
    const view = render(
      <p>
        <MarkdownLine text="An overflowing **line**." />
      </p>,
    );
    expect(view.container.firstElementChild?.childElementCount).toBe(0);
    expect(view.container.textContent).toBe("An overflowing **line**.");
  });

  test("and a text it does not is read as it ever was", () => {
    const view = render(<MarkdownReport text="A **text**." bare />);
    expect(view.container.querySelector("strong")?.textContent).toBe("text");
  });
});

describe("code a grammar gives up on", () => {
  const code = "const overflowing = 1;";

  test("has no runs, and its worker answers that it has none", () => {
    expect(markdownSyntaxRead(code, "typescript")).toBeUndefined();
    expect(
      markdownSyntaxAnswered({ id: 3, code, language: "typescript" }),
    ).toEqual({ id: 3, runs: undefined });
    expect(
      markdownSyntaxRead("const a = 1;", "typescript"),
    ).not.toBeUndefined();
  });

  test("is drawn as its characters beside code that is coloured", async () => {
    const view = render(
      <MarkdownProvider
        clock={() => performance.now()}
        syntax={syntaxDoubleReading().open}
      >
        <MarkdownReport
          text={`\`\`\`ts\n${code}\n\`\`\`\n\n\`\`\`ts\nconst a = 1;\n\`\`\``}
          bare
        />
      </MarkdownProvider>,
    );
    const blocks = Array.from(view.container.querySelectorAll("pre > code"));
    await waitFor(() => {
      expect(blocks[1]?.querySelector(".hljs-keyword")).not.toBeNull();
    });
    expect(blocks[0]?.textContent).toBe(code);
    expect(blocks[0]?.childElementCount).toBe(0);
  });
});
