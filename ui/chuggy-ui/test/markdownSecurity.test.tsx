/**
 * What reaches the document from a text written to get something into it.
 *
 * The text a report draws is a model's, written after reading pages nobody
 * chose, so every element, attribute, class and address the report can be made
 * to draw is held to a list here: the elements the report draws on purpose,
 * the attributes they carry, the classes this console's sheets name, and an
 * address a member could be sent to. Anything else in the document is a
 * finding, whatever it would have done.
 *
 * Each payload is drawn whole, at every moment of being written with prose on
 * either side of it, and as one line of a note; a seeded soup of the same
 * marks is drawn after them; and code is audited once it has its colours.
 */

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import type { ReactNode } from "react";

import { CopyProvider } from "../app/browser/ui/copyHeld.tsx";
import { MarkdownProvider } from "../app/browser/ui/markdownHeld.ts";
import {
  MarkdownLine,
  MarkdownReport,
} from "../app/browser/ui/MarkdownReport.tsx";
import { syntaxDoubleReading } from "./markdownSyntaxDouble.ts";

afterEach(cleanup);

const tagsAllowed = new Set(
  "div p h1 h2 h3 h4 h5 h6 ul ol li input em strong del code br a blockquote pre span table thead tbody tr th td hr button svg path rect".split(
    " ",
  ),
);

const attributesAllowed = new Set(
  "class href target rel start type checked disabled readonly aria-label aria-hidden role viewBox viewbox d x y width height rx".split(
    " ",
  ),
);

const classAllowedPattern =
  /^(?:run-report(?:-[a-z-]+)?|hljs-[a-z_-]+|copy(?:-[a-z]+)?|visually-hidden|num)$/u;

const addressAllowedPattern = /^(?:https?:\/\/|mailto:)/iu;

const forbidden =
  "style, script, img, iframe, object, embed, link, base, form, meta, video, audio, source";

/** The schemes a link may be read as going to, the last being what an
 * address that parses as none is given. */
const protocolsAllowed = ["http:", "https:", "mailto:", ":"];

/** What is wrong with a link: where it goes, or how it is opened. */
function auditLink(element: Element): readonly string[] {
  if (!(element instanceof HTMLAnchorElement)) return [];
  const href = element.getAttribute("href") ?? "";
  return [
    ...(addressAllowedPattern.test(href) ? [] : [`href ${href}`]),
    ...(protocolsAllowed.includes(element.protocol)
      ? []
      : [`protocol ${element.protocol}`]),
    ...(element.rel === "noreferrer" && element.target === "_blank"
      ? []
      : ["a link opened in this tab, or with its referrer"]),
  ];
}

/** What is wrong with one element, by the lists above. */
function auditElement(element: Element): readonly string[] {
  const tag = element.tagName.toLowerCase();
  const names = Array.from(element.attributes, (attribute) => attribute.name);
  const start = element.getAttribute("start") ?? "1";
  return [
    ...(tagsAllowed.has(tag) ? [] : [`element <${tag}>`]),
    ...names
      .filter((name) => !attributesAllowed.has(name) || name.startsWith("on"))
      .map((name) => `attribute ${name} on <${tag}>`),
    ...auditLink(element),
    ...(tag !== "ol" || /^\d+$/u.test(start) ? [] : [`start ${start}`]),
    ...Array.from(element.classList)
      .filter((name) => !classAllowedPattern.test(name))
      .map((name) => `class ${name}`),
  ];
}

/** Everything wrong with what a text was drawn as, each said with the text. */
function audit(root: Element | null, source: string): readonly string[] {
  if (root === null) return [];
  const findings = [root, ...Array.from(root.querySelectorAll("*"))].flatMap(
    auditElement,
  );
  if (document.querySelectorAll(forbidden).length > 0)
    findings.push("a forbidden element in the document");
  return findings.map((finding) => `${finding} from ${JSON.stringify(source)}`);
}

const payloads: readonly string[] = [
  "[x](javascript:alert(1)//https://a.test)",
  "[x](javascript:alert(1)//mailto:a@b.test)",
  "<javascript:alert(1)//https://a.test>",

  "<script>alert(1)</script>",
  "a <b onclick=alert(1)>b</b> <img src=x onerror=alert(1)> <svg/onload=alert(1)> <iframe src=javascript:alert(1)>",
  '<div style="position:fixed;inset:0">x</div>',
  "<style>*{display:none}</style>",
  "<!-- c --><![CDATA[x]]><?php x ?><!DOCTYPE html>",
  "| a | <img src=x onerror=alert(1)> |\n| - | - |\n| <script>x</script> | [x](javascript:alert(1)) |",
  "- <script>alert(1)</script>\n- [x](javascript:alert(1))\n  - <a href=javascript:alert(1)>y</a>",
  "> <script>alert(1)</script>",
  "# <script>alert(1)</script>",
  "[<img src=x onerror=alert(1)>](https://a.test)",
  "[x](javascript:alert(1))",
  "[x](JaVaScRiPt:alert(1))",
  "[x]( javascript:alert(1))",
  "[x](<javascript:alert(1)>)",
  "[x](\tjavascript:alert(1))",
  "[x](java\tscript:alert(1))",
  "[x](java&#x09;script:alert(1))",
  "[x](&#106;avascript:alert(1))",
  "[x](&#x6A;avascript:alert(1))",
  "[x](javascript&colon;alert(1))",
  "[x](javascript&#58;alert(1))",
  "[x](\\javascript:alert(1))",
  "[x](%6Aavascript:alert(1))",
  "[x](\u0001javascript:alert(1))",
  "[x]( javascript:alert(1))",
  "[x](&#1;javascript:alert(1))",
  "[x](&NewLine;javascript:alert(1))",
  "[x](&Tab;javascript:alert(1))",
  "[x](&#0;javascript:alert(1))",
  "[x](data:text/html,<script>alert(1)</script>)",
  "[x](DATA:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
  "[x](vbscript:msgbox(1))",
  "[x](//evil.test/a)",
  "[x](\\\\evil.test\\a)",
  "[x](/\\evil.test)",
  "[x](file:///etc/passwd)",
  "[x](blob:https://a.test/1)",
  "[x](ftp://a.test)",
  "[x](tel:1)",
  "[x](sms:1)",
  "[x](intent://a#Intent;end)",
  "[x](chrome://settings)",
  "[x](about:blank)",
  "[x](ws://a.test)",
  "[x](https:evil.test)",
  "[x](http:/evil.test)",
  "[x](https:/\\evil.test)",
  "[x](http://)",
  '[x](https://a.test "title <script>")',
  "[x](https://a.test 'onmouseover=alert(1)')",
  '[x](https://a.test" onmouseover="alert(1))',
  "[x](https://a.test'><script>alert(1)</script>)",
  "[x](mailto:a@b.test?subject=<script>)",
  "[x](MAILTO:a@b.test)",
  "[x](mailto:javascript:alert(1))",
  "[x](https://a.test/%0Ajavascript:alert(1))",
  "[x](http://a.test@evil.test)",
  "<javascript:alert(1)>",
  "<JAVASCRIPT:alert(1)>",
  "<data:text/html,x>",
  "<vbscript:x>",
  "<file:///etc/passwd>",
  '<https://a.test/"onmouseover=alert(1)>',
  "<x@y.z>",
  "<x@javascript:alert(1)>",
  "<mailto:x@y.z>",
  "<irc://a.test>",
  "<a+b.c-d:x>",
  "www.evil.test",
  "WWW.evil.test/<script>",
  'www.a.test/"onmouseover="alert(1)',
  "http://a.test/<script>alert(1)</script>",
  "https://a.test/'onclick='x",
  "a@b.test",
  "javascript:alert(1)@b.test",
  "x@y.test<script>",
  "mailto:a@b.test",
  "xmpp:a@b.test/c",
  "MAILTO:a@b.test",
  "ftp://a.test/b",
  "javascript://a.test/%0aalert(1)",
  "![x](https://a.test/a.png)",
  "![x](javascript:alert(1))",
  "![](https://a.test/a.png)",
  "![](javascript:alert(1))",
  "![x](data:image/svg+xml,<svg onload=alert(1)>)",
  '![<img src=x onerror=alert(1)>](https://a.test/x.png "t")',
  "[![x](https://a.test/i.png)](https://a.test/l)",
  "[![x](javascript:alert(1))](javascript:alert(2))",
  "![x](//evil.test/track.gif)",
  "![x](/api/v1/logout)",
  "![x][r]\n\n[r]: https://evil.test/track.gif",
  "[x][r]\n\n[r]: javascript:alert(1)",
  "[x]\n\n[x]: javascript:alert(1)",
  "[^1]\n\n[^1]: <script>x</script>",
  '```"><script>alert(1)</script>\ncode\n```',
  '```ts" onmouseover="alert(1)\ncode\n```',
  "```<img/src=x>\n<img src=x onerror=alert(1)>\n```",
  "```html\n<script>alert(1)</script><img src=x onerror=alert(1)>\n```",
  '```xml\n<a class="hljs-x" style="x">\n```',
  "```__proto__\nx\n```",
  "```constructor\nx\n```",
  "```hljs-keyword\nx\n```",
  "```ts hljs-evil style=x\nconst a = 1;\n```",
  '~~~js\n`${"<img src=x onerror=alert(1)>"}`\n~~~',
  "```toString\nx\n```",
  "```hasOwnProperty\nx\n```",
  "    <script>alert(1)</script>",
  "`<script>alert(1)</script>`",
  "``<img src=x onerror=alert(1)>``",
  "&lt;script&gt;alert(1)&lt;/script&gt;",
  "&#60;img src=x onerror=alert(1)&#62;",
  "&#x3C;svg onload=alert(1)&#x3E;",
  "&lt;img src=x onerror=alert(1)&gt;",
  "<scr\nipt>alert(1)</scr\nipt>",
  "<img src=x\nonerror=alert(1)>",
  '<a href="javascript:alert(1)">x</a>',
  '<a href="https://a.test" style="x">x</a>',
  "<details open ontoggle=alert(1)>",
  "<math><mtext><script>alert(1)</script>",
  "<input autofocus onfocus=alert(1)>",
  "<form action=javascript:alert(1)><button>x",
  "<base href=//evil.test/>",
  '<meta http-equiv=refresh content="0;url=javascript:alert(1)">',
  "<link rel=stylesheet href=//evil.test/x.css>",
  "| a |\n| :-: |\n| <td style=x> |",
  '| " style="x | b |\n| :-- | --: |\n| c | d |',
  '|a|\n|:-" onx="|\n|b|',
  "- [x] <script>alert(1)</script>",
  "- [ ] [x](javascript:alert(1))",
  "1000000000. a",
  "999999999. a",
  "0. a",
  "-1. a",
  "1e9. a",
  "[[ticket:1]]",
  "[[ticket:<script>]]",
  '[[ticket:1"onclick="x]]',
  "[[[ticket:1]]](javascript:alert(1))",
  "[[ticket:9007199254740993]]",
  "*<script>*",
  "**<img src=x onerror=alert(1)>**",
  "~~<svg onload=x>~~",
  "_<b>_",
  "***<i>***",
  "\\<script>alert(1)\\</script>",
  "<\\script>",
  "<script\\>",
  "<<script>script>alert(1)<</script>/script>",
  "‮<script>",
  "﻿<script>alert(1)</script>",
  "<script>\u0000alert(1)</script>",
  "<scr\u0000ipt>",
  "\u0000",
  "a\u0000b",
  "&#0;",
  "&#xD800;",
  "\ud800",
  "\udc00<",
];

function drawnAudit(text: string, writing: boolean): readonly string[] {
  const view = render(
    <CopyProvider write={() => Promise.resolve(true)}>
      <MarkdownReport text={text} writing={writing} />
    </CopyProvider>,
  );
  const findings = audit(view.container.firstElementChild, text);
  cleanup();
  return findings;
}

describe("a text written to get something into the document", () => {
  test("draws nothing outside the lists, whole", () => {
    expect(payloads.flatMap((payload) => drawnAudit(payload, false))).toEqual(
      [],
    );
  });

  test("draws nothing outside the lists at any moment it is written, with prose before and after it", () => {
    const findings = new Set<string>();
    for (const payload of payloads) {
      const view = render(<MarkdownReport text="" bare writing />);
      const text = `Before.\n\n${payload}\n\nAfter <script>alert(2)</script> [y](javascript:alert(3)).`;
      for (let length = 1; length <= text.length; length += 1) {
        const written = text.slice(0, length);
        view.rerender(<MarkdownReport text={written} bare writing />);
        for (const finding of audit(view.container.firstElementChild, written))
          findings.add(finding);
      }
      view.rerender(<MarkdownReport text={text} bare />);
      for (const finding of audit(view.container.firstElementChild, text))
        findings.add(finding);
      cleanup();
    }
    expect([...findings].slice(0, 40)).toEqual([]);
  });

  test("draws nothing outside the lists as one line of a note", () => {
    const findings = payloads.flatMap((payload) => {
      const view = render(
        <p className="run-report">
          <MarkdownLine text={payload} />
        </p>,
      );
      const found = audit(view.container.firstElementChild, payload);
      cleanup();
      return found;
    });
    expect(findings).toEqual([]);
  });
});

const soup: readonly string[] = [
  "<script>",
  "</script>",
  "<img src=x onerror=alert(1)>",
  "<",
  ">",
  '"',
  "'",
  ' style="x"',
  " onclick=x",
  "javascript:",
  "JAVASCRIPT:",
  "data:",
  "vbscript:",
  "[",
  "]",
  "(",
  ")",
  "![",
  "](",
  "https://a.test",
  "http://",
  "mailto:",
  "www.a.test",
  "a@b.test",
  "//evil.test",
  "&#x6A;",
  "&colon;",
  "&Tab;",
  "&NewLine;",
  "&lt;",
  "&#0;",
  "\\",
  "`",
  "```",
  "```html",
  "~~~",
  "\n",
  "\n\n",
  "- ",
  "1. ",
  "> ",
  "| ",
  " |",
  "| - |",
  "# ",
  "*",
  "**",
  "_",
  "~~",
  " ",
  "\t",
  "x",
  "alert(1)",
  "[[ticket:1]]",
  "[x]: ",
  "[^1]",
  "\u0000",
  " ",
  "‮",
  "%0A",
  "%6A",
  ":",
  "/",
  "<a href=",
  "<svg/onload=",
  "<style>",
  "<!--",
  "-->",
  "&",
  ";",
  "#",
];

/** A generator of numbers below one that is the same on every run. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

describe("a seeded soup of the same marks", () => {
  test("draws nothing outside the lists, whole or written", () => {
    const random = seeded(12345);
    const findings = new Set<string>();
    for (let round = 0; round < 1_500 && findings.size < 20; round += 1) {
      const count = 3 + Math.floor(random() * 25);
      const text = Array.from(
        { length: count },
        () => soup[Math.floor(random() * soup.length)] ?? "",
      ).join("");
      for (const writing of [false, true])
        for (const finding of drawnAudit(text, writing)) findings.add(finding);
    }
    expect([...findings]).toEqual([]);
  });
});

const fences: readonly string[] = [
  "```html\n<script>alert(1)</script><img src=x onerror=alert(1)>\n```",
  '```xml\n<a class="hljs-x" style="x" onclick="alert(1)">\n```',
  '~~~js\n`${"<img src=x onerror=alert(1)>"}`\n~~~',
  "```ts hljs-evil style=x\nconst a = 1;\n```",
  '```md\n# <script>alert(1)</script>\n[x](javascript:alert(1)) <b style="x">\n```',
  "```css\na[href^='javascript:'] { background: url(javascript:alert(1)) }\n```",
];

describe("code written to get something into the document", () => {
  test("is coloured, and carries nothing outside the lists once it is", async () => {
    const wrapper = (props: { readonly children: ReactNode }): ReactNode => (
      <MarkdownProvider
        clock={() => performance.now()}
        syntax={syntaxDoubleReading().open}
      >
        {props.children}
      </MarkdownProvider>
    );
    for (const text of fences) {
      const view = render(<MarkdownReport text={text} />, { wrapper });
      await waitFor(() => {
        expect(view.container.querySelector('[class^="hljs-"]')).not.toBeNull();
      });
      expect(audit(view.container.firstElementChild, text)).toEqual([]);
      cleanup();
    }
  });
});
