/**
 * The console's focus indicator and what forced colours keep, as its sheets
 * state them: an outline drawn from the focus tokens, an outline taken away
 * only in a sheet that draws one back on a keyboard's focus, and the rules
 * that hold under `forced-colors: active`. Whether a browser in forced colours
 * draws what these rules say is for a rendered harness; this reads the rules.
 */

import { expect, test } from "vitest";

import baseSheet from "../app/styles/base.css?raw";
import tokenSheet from "../app/styles/tokens.css?raw";
import { sheetRules } from "./sheet.ts";

const focusIndicatorSheets = import.meta.glob<string>("../app/**/*.css", {
  query: "?raw",
  import: "default",
  eager: true,
});

const focusIndicatorForced = "(forced-colors: active)";

/** CSS Color 4's system colours, the only ones forced colours leave as
 * written. */
const focusIndicatorSystemColours = new Set([
  "accentcolor",
  "accentcolortext",
  "activetext",
  "buttonborder",
  "buttonface",
  "buttontext",
  "canvas",
  "canvastext",
  "field",
  "fieldtext",
  "graytext",
  "highlight",
  "highlighttext",
  "linktext",
  "mark",
  "marktext",
  "selecteditem",
  "selecteditemtext",
  "visitedtext",
]);

function focusIndicatorSheet(path: string): string {
  const text = focusIndicatorSheets[`../app/${path}`];
  if (text === undefined) throw new Error(`no sheet app/${path}`);
  return text;
}

/** Every style rule of a sheet, under any condition, in source order. */
function focusIndicatorRules(text: string): readonly CSSStyleRule[] {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(text);
  const rules: CSSStyleRule[] = [];
  const walk = (list: CSSRuleList): void => {
    for (const rule of Array.from(list)) {
      if (rule instanceof CSSStyleRule) rules.push(rule);
      else if (rule instanceof CSSGroupingRule) walk(rule.cssRules);
    }
  };
  walk(sheet.cssRules);
  return rules;
}

/** A rule's selectors, split at the commas no parenthesis holds. */
function focusIndicatorSelectors(rule: CSSStyleRule): readonly string[] {
  const selectors: string[] = [];
  let depth = 0;
  let start = 0;
  const text = rule.selectorText.replace(/\s+/gu, " ");
  for (const [index, character] of [...text].entries()) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      selectors.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  selectors.push(text.slice(start).trim());
  return selectors;
}

/** The style rules a sheet holds under forced colours alone. */
function focusIndicatorForcedRules(text: string): readonly CSSStyleRule[] {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(text);
  const rules: CSSStyleRule[] = [];
  const walk = (list: CSSRuleList, forced: boolean): void => {
    for (const rule of Array.from(list)) {
      if (rule instanceof CSSStyleRule) {
        if (forced) rules.push(rule);
      } else if (rule instanceof CSSMediaRule)
        walk(
          rule.cssRules,
          forced || rule.conditionText === focusIndicatorForced,
        );
      else if (rule instanceof CSSGroupingRule) walk(rule.cssRules, forced);
    }
  };
  walk(sheet.cssRules, false);
  return rules;
}

function focusIndicatorRemoves(rule: CSSStyleRule): boolean {
  return ["outline", "outline-style", "outline-width"].some((property) =>
    ["none", "0", "0px"].includes(rule.style.getPropertyValue(property)),
  );
}

/** The selectors of a sheet that take an outline away while no rule of the
 * same sheet draws one on a keyboard's focus. */
function focusIndicatorUnreplaced(text: string): readonly string[] {
  const rules = focusIndicatorRules(text);
  const replaced = rules.some(
    (rule) =>
      rule.selectorText.includes(":focus-visible") &&
      rule.style.getPropertyValue("outline") !== "" &&
      !focusIndicatorRemoves(rule),
  );
  return replaced
    ? []
    : rules.filter(focusIndicatorRemoves).map((rule) => rule.selectorText);
}

/** What one forced-colours rule of a sheet declares for one property. */
function focusIndicatorForcedValue(
  path: string,
  selector: string,
  property: string,
): string {
  const rule = focusIndicatorForcedRules(focusIndicatorSheet(path)).find(
    (held) => focusIndicatorSelectors(held).includes(selector),
  );
  return rule?.style.getPropertyValue(property) ?? "";
}

test("the shared focus indicator is an outline drawn from the focus tokens, clear of the control", () => {
  const rule = sheetRules(baseSheet, []).find(
    (held) => held.selectorText === ":focus-visible",
  );
  expect(rule?.style.getPropertyValue("outline")).toBe(
    "var(--focus-width) solid var(--focus)",
  );
  expect(rule?.style.getPropertyValue("outline-offset")).toBe(
    "var(--focus-offset)",
  );
  expect(rule?.style.getPropertyValue("box-shadow")).toBe("");
});

test("no sheet draws focus as a shadow, and every focus outline takes the focus tokens", () => {
  const found = Object.entries(focusIndicatorSheets).flatMap(([path, text]) =>
    focusIndicatorRules(text)
      .filter((rule) => rule.selectorText.includes(":focus"))
      .flatMap((rule) => {
        const shadow = rule.style.getPropertyValue("box-shadow");
        const outline = rule.style.getPropertyValue("outline");
        const offset = rule.style.getPropertyValue("outline-offset");
        return [
          ...(shadow !== "" && shadow !== "none"
            ? [`${path}: ${rule.selectorText} draws a shadow`]
            : []),
          ...(outline !== "" &&
          !focusIndicatorRemoves(rule) &&
          outline !== "var(--focus-width) solid var(--focus)"
            ? [`${path}: ${rule.selectorText} outlines in ${outline}`]
            : []),
          ...(offset !== "" && !/^var\(--focus-/u.test(offset)
            ? [`${path}: ${rule.selectorText} offsets by ${offset}`]
            : []),
        ];
      }),
  );
  expect(found).toEqual([]);
});

test("no sheet takes an outline away without drawing one on a keyboard's focus", () => {
  const found = Object.entries(focusIndicatorSheets).flatMap(([path, text]) =>
    focusIndicatorUnreplaced(text).map((selector) => `${path}: ${selector}`),
  );
  expect(found).toEqual([]);
});

test("an outline taken away, as none or as zero, is named until the sheet draws one back", () => {
  const taken = `@layer ui {
    .a:focus-visible { outline: none; }
    .b { outline: 0; }
    .c { outline-style: none; }
  }`;
  expect(focusIndicatorUnreplaced(taken)).toEqual([
    ".a:focus-visible",
    ".b",
    ".c",
  ]);
  expect(
    focusIndicatorUnreplaced(`${taken} .d:focus-visible { outline: none; }`),
  ).toHaveLength(4);
  expect(
    focusIndicatorUnreplaced(
      `${taken} .a:has(:focus-visible) { outline: var(--focus-width) solid var(--focus); }`,
    ),
  ).toEqual([]);
});

test("where a scroller clips past its row, the focus outline is drawn inside", () => {
  for (const [path, selector] of [
    ["browser/ui/TabNav.css", ".tab-nav-tab:focus-visible"],
    ["browser/ticket/ticket.css", ".ticket-tab:focus-visible"],
    ["browser/ui/Menu.css", ".menu-item:focus-visible"],
    ["browser/shell/shell.css", ".chat-history-row:focus-visible"],
  ] as const) {
    const rule = focusIndicatorRules(focusIndicatorSheet(path)).find(
      (held) => held.selectorText === selector,
    );
    expect(rule?.style.getPropertyValue("outline-offset"), selector).toBe(
      "var(--focus-inset)",
    );
  }
});

test("under forced colours the focus indicator and the forced tokens are system colours", () => {
  const forced = focusIndicatorForcedRules(tokenSheet).find(
    (rule) => rule.selectorText === ":root",
  );
  expect(forced?.style.getPropertyValue("--focus")).toBe(
    "var(--forced-current)",
  );
  const root = sheetRules(tokenSheet, []).filter(
    (rule) => rule.selectorText === ":root",
  );
  for (const token of ["--forced-current", "--forced-ink"]) {
    const value = root
      .map((rule) => rule.style.getPropertyValue(token).trim())
      .find((held) => held !== "");
    expect(
      focusIndicatorSystemColours.has(value?.toLowerCase() ?? ""),
      token,
    ).toBe(true);
  }
});

test("under forced colours a state a wash drew alone gains an edge or an underline in a system colour", () => {
  for (const [path, selector, property] of [
    [
      "browser/ui/Menu.css",
      ".menu-item[data-highlighted]",
      "text-decoration-color",
    ],
    [
      "browser/conversation/conversation.css",
      ".conversation-trigger-item[data-highlighted]",
      "text-decoration-color",
    ],
    [
      "browser/shell/shell.css",
      '.topbar-inbox[aria-current="page"]',
      "text-decoration-color",
    ],
    [
      "browser/catalog/catalog.css",
      '.catalog-groups .record-row-title a[aria-current="page"]',
      "text-decoration-color",
    ],
    [
      "browser/ticket/ticket.css",
      '.ticket-rail-row[aria-current="page"]',
      "border-left-color",
    ],
    ["browser/ui/Button.css", '.btn[aria-pressed="true"]', "border-color"],
    [
      "browser/ui/ToggleGroup.css",
      '.toggle-group .btn[aria-checked="true"]',
      "border-color",
    ],
    [
      "browser/settings/ThemePicker.css",
      '.theme-card[data-state="checked"]',
      "border-color",
    ],
    [
      "browser/epic/epicGraph.css",
      '.epic-card .epic-card-button[aria-pressed="true"]',
      "border-color",
    ],
    [
      "browser/conversation/conversation.css",
      '.conversation-call[aria-current="location"]',
      "outline",
    ],
  ] as const) {
    expect(
      focusIndicatorForcedValue(path, selector, property),
      selector,
    ).toContain("var(--forced-current)");
  }
});

test("under forced colours a mark drawn as a ground is drawn in a system colour", () => {
  for (const [path, selector, property, token] of [
    [
      "browser/ui/TabNav.css",
      '.tab-nav-tab[aria-current="page"]::after',
      "background",
      "forced-current",
    ],
    [
      "browser/ticket/ticket.css",
      '.ticket-tab[aria-current="page"]::after',
      "background",
      "forced-current",
    ],
    [
      "browser/shell/shell.css",
      '.topbar-entry[aria-current="page"]::after',
      "background",
      "forced-current",
    ],
    [
      "browser/shell/shell.css",
      '.topbar-phone-item:is([aria-current="page"], [data-current])::before',
      "background",
      "forced-current",
    ],
    [
      "browser/ui/Pill.css",
      ".pill:not(.pill-queued) .pill-mark",
      "background",
      "forced-ink",
    ],
    ["browser/ui/Pill.css", ".pill-queued .pill-mark", "border", "forced-ink"],
    ["browser/ui/RadioGroup.css", ".radio-mark", "background", "forced-ink"],
    ["browser/ui/Picker.css", ".picker-mark", "background", "forced-ink"],
    [
      "browser/settings/lead/selector.css",
      ".selector-dot",
      "background",
      "forced-ink",
    ],
    [
      "browser/settings/lead/selector.css",
      ".selector-mark",
      "background",
      "forced-ink",
    ],
    [
      "browser/epic/epicGraph.css",
      ".epic-card-port[data-met]",
      "background",
      "forced-ink",
    ],
    [
      "browser/conversation/conversation.css",
      ".conversation-writing .run-report-mark::after",
      "background",
      "forced-ink",
    ],
  ] as const) {
    expect(
      focusIndicatorForcedValue(path, selector, property),
      selector,
    ).toContain(`var(--${token})`);
  }
});

test("forced colours are let alone only where a colour is what is shown, and only under forced colours", () => {
  const adjusted = Object.entries(focusIndicatorSheets).flatMap(
    ([path, text]) =>
      focusIndicatorRules(text)
        .filter(
          (rule) => rule.style.getPropertyValue("forced-color-adjust") !== "",
        )
        .flatMap((rule) =>
          focusIndicatorSelectors(rule).map(
            (selector) =>
              `${path.replace("../app/", "")} ${selector} ${rule.style.getPropertyValue("forced-color-adjust")}`,
          ),
        ),
  );
  expect(adjusted.sort()).toEqual([
    "browser/context/context.css .context-seg none",
    "browser/context/context.css .context-swatch none",
    "browser/epic/epic.css .epic-progress-swatch none",
    "browser/epic/epic.css .epic-progress-track none",
    "browser/settings/ThemePicker.css .theme-swatch none",
  ]);
  const adjusting = (rules: readonly CSSStyleRule[]): number =>
    rules.filter(
      (rule) => rule.style.getPropertyValue("forced-color-adjust") !== "",
    ).length;
  for (const text of Object.values(focusIndicatorSheets))
    expect(adjusting(focusIndicatorForcedRules(text))).toBe(
      adjusting(focusIndicatorRules(text)),
    );
});
