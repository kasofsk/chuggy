/**
 * The console's focus indicator and what forced colours keep, as its sheets
 * state them: an outline drawn from the focus tokens, an outline taken away
 * only where a rule of its sheet draws one on that element's keyboard focus,
 * and the rules that hold under `forced-colors: active`. Whether a browser in forced colours
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

/** How an outline taken away is answered: markup in which the element its
 * rule names holds a keyboard's focus, marked `data-under-test`, or the reason
 * that element is a region rather than a control and wears no ring. */
type FocusIndicatorTaken =
  { readonly markup: string } | { readonly region: string };

/** A selector as `Element.matches` can test it: a keyboard's focus as an
 * attribute, and a trailing pseudo-element read as the element drawing it. */
function focusIndicatorMatchable(selector: string): string {
  return selector
    .replace(/::[\w-]+$/u, "")
    .replaceAll(":focus-visible", "[data-focus-visible]");
}

/** Whether a rule draws an outline on a keyboard's focus. */
function focusIndicatorDraws(rule: CSSStyleRule): boolean {
  return (
    rule.selectorText
      .replace(/:not\(:focus[\w-]*\)/gu, "")
      .includes(":focus-visible") &&
    rule.style.getPropertyValue("outline") !== "" &&
    !focusIndicatorRemoves(rule)
  );
}

/** Whether a rule of the sheet draws an outline on the focused element of the
 * markup, on an element holding it, or on one it holds. */
function focusIndicatorAnswered(
  rules: readonly CSSStyleRule[],
  removed: string,
  markup: string,
): boolean {
  const host = document.createElement("div");
  host.innerHTML = markup;
  const focused = host.querySelector("[data-under-test]");
  if (focused === null) throw new Error(`nothing under test in ${markup}`);
  focused.setAttribute("data-focus-visible", "");
  if (!focused.matches(focusIndicatorMatchable(removed)))
    throw new Error(`${removed} does not name the focus in ${markup}`);
  const related = [...host.querySelectorAll("*")].filter(
    (element) => element.contains(focused) || focused.contains(element),
  );
  return rules
    .filter(focusIndicatorDraws)
    .flatMap(focusIndicatorSelectors)
    .some((selector) =>
      related.some((element) =>
        element.matches(focusIndicatorMatchable(selector)),
      ),
    );
}

/** The selectors of a sheet that take an outline away and are not answered as
 * `taken` says: unnamed there, or with no rule of the same sheet drawing one on
 * the focused element, an element holding it, or one it holds. */
function focusIndicatorUnreplaced(
  text: string,
  taken: Readonly<Record<string, FocusIndicatorTaken>>,
): readonly string[] {
  const rules = focusIndicatorRules(text);
  return rules
    .filter(focusIndicatorRemoves)
    .flatMap(focusIndicatorSelectors)
    .filter((selector) => {
      const answer = taken[selector];
      if (answer === undefined) return true;
      return "markup" in answer
        ? !focusIndicatorAnswered(rules, selector, answer.markup)
        : false;
    });
}

/** Each outline the console's sheets take away, by sheet and selector. */
const focusIndicatorTakenAway: Readonly<
  Record<string, Readonly<Record<string, FocusIndicatorTaken>>>
> = {
  "browser/ProjectTable.css": {
    ".ticket-list-standing:focus-visible": {
      markup:
        '<a class="ticket-list-standing" data-under-test><span class="status-badge"></span></a>',
    },
  },
  "browser/RunnerMint.css": {
    ".runner-mint .checkbox:focus-visible": {
      markup:
        '<div class="runner-mint"><button class="checkbox" data-under-test></button></div>',
    },
  },
  "browser/conversation/conversation.css": {
    ".conversation-input:focus-visible": {
      markup:
        '<div class="conversation-field"><textarea class="conversation-input" data-under-test></textarea></div>',
    },
  },
  "browser/repositories/Repositories.css": {
    ".repositories-page .radio-item:focus-visible": {
      markup:
        '<div class="repositories-page"><button class="radio-item" data-under-test></button></div>',
    },
  },
  "browser/settings/PreferencesPage.css": {
    ".preferences-section .radio-item:focus-visible": {
      markup:
        '<section class="preferences-section"><button class="radio-item" data-under-test></button></section>',
    },
  },
  "browser/shell/shell.css": {
    ".shell-main:focus-visible": {
      region: "the page a skip link moves the reader to",
    },
  },
  "browser/ui/Chip.css": {
    ".chip-remove:focus-visible": {
      markup:
        '<span class="chip"><button class="chip-remove" data-under-test></button></span>',
    },
  },
  "browser/ui/ListControls.css": {
    ".list-search > .list-search-toggle:focus-visible": {
      markup:
        '<div class="list-search"><button class="list-search-toggle" data-under-test></button></div>',
    },
    ".list-search-field .input-box:focus-visible": {
      markup:
        '<div class="list-search"><div class="list-search-field"><input class="input-box" data-under-test></div></div>',
    },
  },
  "browser/ui/Menu.css": {
    ".menu:focus-visible": {
      region:
        "the panel focus rests in between items, each item outlined when the keys reach it",
    },
  },
};

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
      .filter((rule) =>
        rule.selectorText
          .replace(/:not\(:focus[\w-]*\)/gu, "")
          .includes(":focus"),
      )
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

test("no sheet takes an outline away without drawing one on the same element's keyboard focus", () => {
  const found = Object.entries(focusIndicatorSheets).flatMap(([path, text]) =>
    focusIndicatorUnreplaced(
      text,
      focusIndicatorTakenAway[path.replace("../app/", "")] ?? {},
    ).map((selector) => `${path}: ${selector}`),
  );
  expect(found).toEqual([]);
});

test("an outline taken away, as none or as zero, is named until a rule draws one on the element it was taken from", () => {
  const taken = `@layer ui {
    .a:focus-visible { outline: none; }
    .b { outline: 0; }
    .c { outline-style: none; }
  }`;
  const answers = {
    ".a:focus-visible": {
      markup: '<div class="a" data-under-test></div>',
    },
    ".b": { markup: '<div class="b" data-under-test></div>' },
    ".c": { markup: '<div class="c" data-under-test></div>' },
  };
  expect(focusIndicatorUnreplaced(taken, answers)).toEqual([
    ".a:focus-visible",
    ".b",
    ".c",
  ]);
  expect(
    focusIndicatorUnreplaced(
      `${taken} .a:focus-visible { outline: var(--focus-width) solid var(--focus); }`,
      answers,
    ),
  ).toEqual([".b", ".c"]);
  expect(
    focusIndicatorUnreplaced(
      `${taken} .d:focus-visible { outline: var(--focus-width) solid var(--focus); }`,
      answers,
    ),
  ).toEqual([".a:focus-visible", ".b", ".c"]);
  expect(
    focusIndicatorUnreplaced(
      `${taken} .a:focus-visible::before, .b:focus-visible > i, .x:has(.c:focus-visible) { outline: var(--focus-width) solid var(--focus); }`,
      {
        ...answers,
        ".b": { markup: '<div class="b" data-under-test><i></i></div>' },
        ".c": {
          markup: '<div class="x"><div class="c" data-under-test></div></div>',
        },
      },
    ),
  ).toEqual([]);
  expect(
    focusIndicatorUnreplaced(
      `${taken} .a:has(:focus-visible) { outline: var(--focus-width) solid var(--focus); }`,
      {},
    ),
  ).toEqual([".a:focus-visible", ".b", ".c"]);
});

test("a second outline taken away in a sheet that answers one is named", () => {
  const shell = focusIndicatorSheet("browser/shell/shell.css");
  const taken = focusIndicatorTakenAway["browser/shell/shell.css"] ?? {};
  expect(
    focusIndicatorUnreplaced(
      `${shell} @layer page { .chat-separator:focus-visible { outline: none; } }`,
      {
        ...taken,
        ".chat-separator:focus-visible": {
          markup: '<div class="chat-separator" data-under-test></div>',
        },
      },
    ),
  ).toEqual([".chat-separator:focus-visible"]);
});

test("where a scroller clips past its row, the focus outline is drawn inside", () => {
  for (const [path, selector] of [
    ["browser/ui/TabNav.css", ".tab-nav-tab:focus-visible"],
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
  for (const token of ["--forced-current", "--forced-ink", "--forced-quiet"]) {
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
      '.topbar-inbox[aria-current="page"]:not(:focus-visible)',
      "outline",
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

test("under forced colours an underline that marks a state is drawn, not only recoloured", () => {
  for (const [path, selector] of [
    ["browser/ui/Menu.css", ".menu-item[data-highlighted]"],
    [
      "browser/conversation/conversation.css",
      ".conversation-trigger-item[data-highlighted]",
    ],
    [
      "browser/catalog/catalog.css",
      '.catalog-groups .record-row-title a[aria-current="page"]',
    ],
  ] as const) {
    const line =
      focusIndicatorForcedValue(path, selector, "text-decoration-line") ||
      focusIndicatorForcedValue(path, selector, "text-decoration");
    expect(line, selector).toContain("underline");
  }
});

type FocusIndicatorWeight = readonly [number, number, number];

function focusIndicatorAdd(
  [a, b, c]: FocusIndicatorWeight,
  [x, y, z]: FocusIndicatorWeight,
): FocusIndicatorWeight {
  return [a + x, b + y, c + z];
}

function focusIndicatorHeavier(
  [a, b, c]: FocusIndicatorWeight,
  [x, y, z]: FocusIndicatorWeight,
): boolean {
  return a !== x ? a > x : b !== y ? b > y : c > z;
}

/** A selector's specificity as ids, then classes, attributes and
 * pseudo-classes, then types and pseudo-elements: `:is`, `:not` and `:has`
 * count their weightiest argument and `:where` counts nothing. */
function focusIndicatorSpecificity(selector: string): FocusIndicatorWeight {
  let weight: FocusIndicatorWeight = [0, 0, 0];
  let rest = selector;
  for (
    let open = /:(is|not|has|where)\(/u.exec(rest);
    open !== null;
    open = /:(is|not|has|where)\(/u.exec(rest)
  ) {
    let depth = 1;
    let end = open.index + open[0].length;
    for (; depth > 0; end += 1) {
      if (rest[end] === "(") depth += 1;
      if (rest[end] === ")") depth -= 1;
    }
    if (open[1] !== "where")
      weight = focusIndicatorAdd(
        weight,
        rest
          .slice(open.index + open[0].length, end - 1)
          .split(",")
          .map(focusIndicatorSpecificity)
          .reduce((x, y) => (focusIndicatorHeavier(y, x) ? y : x)),
      );
    rest = `${rest.slice(0, open.index)} ${rest.slice(end)}`;
  }
  const attributes = rest.match(/\[[^\]]*\]/gu)?.length ?? 0;
  weight = focusIndicatorAdd(weight, [0, attributes, 0]);
  for (const token of rest
    .replace(/\[[^\]]*\]/gu, " ")
    .match(/::?[\w-]+|[#.]?[\w-]+/gu) ?? [])
    weight = focusIndicatorAdd(
      weight,
      token.startsWith("#")
        ? [1, 0, 0]
        : token.startsWith("::")
          ? [0, 0, 1]
          : /^[.:]/u.test(token)
            ? [0, 1, 0]
            : [0, 0, 1],
    );
  return weight;
}

/**
 * What a sheet's own cascade gives one element, or its pseudo-element, for one
 * property and its colour longhand under forced colours and every other
 * condition at once: the heaviest matching declaration, the later on a tie.
 * The sheet is taken as one layer, as each sheet asked of here is.
 */
function focusIndicatorForcedWinner(
  text: string,
  markup: string,
  pseudo: string,
  property: string,
): string {
  const host = document.createElement("div");
  host.innerHTML = markup;
  const element = host.querySelector("[data-under-test]");
  if (element === null) throw new Error(`nothing under test in ${markup}`);
  let winner: { weight: FocusIndicatorWeight; value: string } = {
    weight: [-1, 0, 0],
    value: "",
  };
  for (const rule of focusIndicatorRules(text)) {
    const value =
      rule.style.getPropertyValue(property) ||
      rule.style.getPropertyValue(`${property}-color`);
    if (value === "") continue;
    for (const selector of focusIndicatorSelectors(rule)) {
      const own = /::[\w-]+$/u.exec(selector)?.[0] ?? "";
      if (own !== pseudo) continue;
      if (!element.matches(selector.slice(0, selector.length - own.length)))
        continue;
      const weight = focusIndicatorSpecificity(selector);
      if (!focusIndicatorHeavier(winner.weight, weight))
        winner = { weight, value };
    }
  }
  return winner.value;
}

test("specificity counts what the selectors level counts, and a later tie wins", () => {
  expect(focusIndicatorSpecificity(".a")).toEqual([0, 1, 0]);
  expect(focusIndicatorSpecificity('.a[data-tone="live"]')).toEqual([0, 2, 0]);
  expect(focusIndicatorSpecificity(".a:disabled .b")).toEqual([0, 3, 0]);
  expect(focusIndicatorSpecificity(".a:not(.b, #c) span::after")).toEqual([
    1, 1, 2,
  ]);
  expect(focusIndicatorSpecificity(":where(.a) .b")).toEqual([0, 1, 0]);
  expect(
    focusIndicatorSpecificity('.a:is([x="(,)"], .b) .c:has(.d .e)'),
  ).toEqual([0, 5, 0]);
});

test("a forced rule outweighed by a rule outside forced colours is not what the cascade gives", () => {
  const outweighed = `@layer ui {
    .dot[data-tone="live"] { background: var(--tone-live); }
    @media (forced-colors: active) { .dot { background: var(--forced-ink); } }
  }`;
  const dot = '<i class="dot" data-tone="live" data-under-test></i>';
  expect(focusIndicatorForcedWinner(outweighed, dot, "", "background")).toBe(
    "var(--tone-live)",
  );
  expect(
    focusIndicatorForcedWinner(
      outweighed.replace("{ .dot {", '{ .dot[data-tone="live"] {'),
      dot,
      "",
      "background",
    ),
  ).toBe("var(--forced-ink)");
});

/** Each mark drawn as a ground, in each state it is drawn in: its sheet, the
 * markup with the element under test, the pseudo-element, the property, and
 * the forced token that has to win. */
const focusIndicatorForcedMarks = [
  [
    "browser/ui/TabNav.css",
    '<nav class="tab-nav"><a class="tab-nav-tab" aria-current="page" data-under-test></a></nav>',
    "::after",
    "background",
    "forced-current",
  ],
  [
    "browser/shell/shell.css",
    '<a class="topbar-entry" aria-current="page" data-under-test></a>',
    "::after",
    "background",
    "forced-current",
  ],
  [
    "browser/shell/shell.css",
    '<a class="topbar-phone-item" aria-current="page" data-under-test></a>',
    "::before",
    "background",
    "forced-current",
  ],
  [
    "browser/shell/shell.css",
    '<a class="topbar-phone-item" data-current data-under-test></a>',
    "::before",
    "background",
    "forced-current",
  ],
  [
    "browser/ui/RadioGroup.css",
    '<button class="radio-item"><span class="radio-mark" data-under-test></span></button>',
    "",
    "background",
    "forced-ink",
  ],
  [
    "browser/ui/RadioGroup.css",
    '<button class="radio-item" disabled><span class="radio-mark" data-under-test></span></button>',
    "",
    "background",
    "forced-quiet",
  ],
  [
    "browser/ui/Picker.css",
    '<span class="picker-mark" data-under-test></span>',
    "",
    "background",
    "forced-ink",
  ],
  [
    "browser/epic/epicGraph.css",
    '<div class="epic-card"><i class="epic-card-port" data-met data-under-test></i></div>',
    "",
    "background",
    "forced-ink",
  ],
  ...["", " run-report"].map(
    (also) =>
      [
        "browser/conversation/conversation.css",
        `<div class="conversation-writing"><p class="run-report-mark${also}" data-under-test></p></div>`,
        "::after",
        "background",
        "forced-ink",
      ] as const,
  ),
] as const;

test("under forced colours a mark drawn as a ground wins its sheet's cascade in a system colour, in every state it is drawn in", () => {
  for (const [
    path,
    markup,
    pseudo,
    property,
    token,
  ] of focusIndicatorForcedMarks) {
    expect(
      focusIndicatorForcedWinner(
        focusIndicatorSheet(path),
        markup,
        pseudo,
        property,
      ),
      markup,
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
