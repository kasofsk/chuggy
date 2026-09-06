/**
 * What a built console's document may carry, the cascade order the stylesheet
 * it loads must be emitted in, and the values its utilities layer may state.
 *
 * The policy `images/web/nginx.conf` serves a console under is
 * `default-src 'none'` with `script-src 'self'` and `style-src 'self'` — no
 * `'unsafe-inline'`, no nonce — so an inline script or style is a page that
 * loads in a dev server and is blank in production, and a subresource from
 * another origin is a page missing a piece of itself.
 *
 * THE CASCADE IS THE SECOND DECISION AND IT IS READ FROM THE SAME BUILD.
 * `consoleCascadeLayers` below is the order, and the production
 * minifier drops a bare `@layer` statement whenever the order it emits the
 * blocks in already satisfies it — so the order the browser gets comes from
 * the order the entry imports the sheets in, and nothing about that order is
 * visible in a source file. A layer out of place is silent: the element
 * defaults win over the primitives, every button-shaped link gains an
 * underline, and no source file has changed.
 *
 * SO THE DECISION IS OVER WHAT THE DOCUMENT LOADS, IN THE ORDER IT LOADS IT.
 * Layers are the document's and not a file's, so the sheets are read as one
 * text in href order — which is the order a browser applies them in — and
 * decided once. With no statement the blocks must be EVERY LAYER IN THE
 * SYSTEM'S ORDER: a missing one is a sheet that did not reach the bundle, and
 * a layer the appearance order never establishes is one nothing can say a
 * place for. With a statement, that statement must name exactly the order and
 * lead every block; block order is then the statement's business, and a layer
 * with no rules in it is nothing to report.
 *
 * WHAT IT CANNOT SEE, said plainly so nobody trusts it further than it goes: a
 * URL a script builds at run time is invisible here, and the policy itself is
 * what refuses that one. What this covers is the document a bundler emitted,
 * which is where an added inline script or a rewritten asset host shows up.
 * Attribute values are read in all three forms the markup allows — double
 * quoted, single quoted and bare — because which one a bundler writes is the
 * bundler's business and not a property this may depend on. A rule outside
 * every layer is invisible to the cascade half — the console still serves one
 * unlayered sheet by design — and `.chug/tasks/check-console-sheets.sh` is
 * what reads the sheets a rule may not leave.
 */

/** Every attribute that makes a browser fetch something, and no others. */
export const consolePolicyFetchingAttributes = [
  "src",
  "href",
  "srcset",
  "imagesrcset",
  "poster",
  "data",
  "action",
  "formaction",
] as const;

const inlineScript = /<script(?![^>]*\ssrc\s*=)[^>]*>/iu;
const inlineStyleElement = /<style[\s>]/iu;
const inlineStyleAttribute = /\sstyle\s*=/iu;

const attribute = new RegExp(
  `\\s(${consolePolicyFetchingAttributes.join("|")})\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`,
  "giu",
);

/** A `srcset` is a comma-separated list, each entry a URL and a descriptor. */
function consolePolicyUrls(name: string, value: string): readonly string[] {
  if (name !== "srcset" && name !== "imagesrcset") return [value];
  return value
    .split(",")
    .map((entry) => entry.trim().split(/\s+/u)[0] ?? "")
    .filter((url) => url !== "");
}

function consolePolicyIsSameOrigin(url: string): boolean {
  return url.startsWith("/") || url.startsWith("./") || url.startsWith("data:");
}

export function consolePolicyFindings(markup: string): readonly string[] {
  const findings: string[] = [];
  if (inlineScript.test(markup))
    findings.push("an inline <script>, which script-src 'self' refuses");
  if (inlineStyleElement.test(markup))
    findings.push("an inline <style>, which style-src 'self' refuses");
  if (inlineStyleAttribute.test(markup))
    findings.push("a style attribute, which style-src 'self' refuses");
  for (const found of markup.matchAll(attribute)) {
    const name = (found[1] ?? "").toLowerCase();
    const value = found[2] ?? found[3] ?? found[4] ?? "";
    for (const url of consolePolicyUrls(name, value))
      if (!consolePolicyIsSameOrigin(url))
        findings.push(`a ${name} of ${url}, which default-src 'none' refuses`);
  }
  return findings;
}

/** The order the design system's layers take, weakest first. */
export const consoleCascadeLayers = [
  "tokens",
  "base",
  "ui",
  "page",
  "utilities",
] as const;

export type ConsoleCascadeLayer = (typeof consoleCascadeLayers)[number];

/**
 * The layer Tailwind writes beside its utilities: `@supports`-guarded initial
 * values for its own `--tw-*` properties, on `*`. Nothing else declares those,
 * so where it lands decides nothing and the system gives it no place.
 */
export const consoleCascadeGeneratedLayers = ["properties"] as const;

const layerStatement = /@layer\s+([^;{]+);/u;
const layerBlock = /@layer\s+([A-Za-z][\w-]*)\s*\{/gu;

function consoleCascadeOrders(name: string): name is ConsoleCascadeLayer {
  return (consoleCascadeLayers as readonly string[]).includes(name);
}

/** First appearance only: a layer reopened later takes no new place. */
function consoleCascadeBlocks(stylesheet: string): readonly string[] {
  const seen: string[] = [];
  for (const found of stylesheet.matchAll(layerBlock)) {
    const name = found[1] ?? "";
    if (!seen.includes(name)) seen.push(name);
  }
  return seen;
}

function consoleCascadeStatement(stylesheet: string): readonly string[] {
  const stated = layerStatement.exec(stylesheet);
  if (stated === null) return [];
  return (stated[1] ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
}

/** Every layer the sheets declare, so a build that declares none says so. */
export function consoleCascadeNames(stylesheet: string): readonly string[] {
  const stated = consoleCascadeStatement(stylesheet);
  const blocks = consoleCascadeBlocks(stylesheet);
  return [...stated, ...blocks.filter((name) => !stated.includes(name))];
}

export function consoleCascadeFindings(stylesheet: string): readonly string[] {
  const findings: string[] = [];
  const blocks = consoleCascadeBlocks(stylesheet);
  for (const name of blocks)
    if (
      !consoleCascadeOrders(name) &&
      !(consoleCascadeGeneratedLayers as readonly string[]).includes(name)
    )
      findings.push(`a layer named ${name}, which the system does not order`);
  const stated = consoleCascadeStatement(stylesheet);
  if (stated.length > 0) {
    if (stated.join(", ") !== consoleCascadeLayers.join(", "))
      findings.push(
        `a layer statement of ${stated.join(", ")}, not ${consoleCascadeLayers.join(", ")}`,
      );
    const opened = stylesheet.search(layerBlock);
    const at = layerStatement.exec(stylesheet)?.index ?? 0;
    if (opened !== -1 && opened < at)
      findings.push("a layer opened above the statement that orders them");
    return findings;
  }
  const drawn = blocks.filter(consoleCascadeOrders);
  if (drawn.join(", ") !== consoleCascadeLayers.join(", "))
    findings.push(
      `layers emitted as ${drawn.join(", ")}, not ${consoleCascadeLayers.join(", ")}`,
    );
  return findings;
}

/** What the document tells a browser to fetch as a stylesheet, in order. */
export function consolePolicyStylesheetHrefs(
  markup: string,
): readonly string[] {
  const hrefs: string[] = [];
  for (const found of markup.matchAll(/<link\b[^>]*>/giu)) {
    const tag = found[0];
    if (!/\srel\s*=\s*(?:"stylesheet"|'stylesheet'|stylesheet)/iu.test(tag))
      continue;
    const href = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/iu.exec(tag);
    const value = href?.[1] ?? href?.[2] ?? href?.[3] ?? "";
    if (value !== "") hrefs.push(value);
  }
  return hrefs;
}

/**
 * CSS Color Level 4's named colours, the roster
 * `.chug/tasks/check-console-sheets.sh` states over the sources.
 * `consolePolicyRosterMatchesTheSheetGate` in the suite is what holds the two
 * copies to each other.
 */
export const consoleRawColourNames = [
  "aliceblue",
  "antiquewhite",
  "aqua",
  "aquamarine",
  "azure",
  "beige",
  "bisque",
  "black",
  "blanchedalmond",
  "blue",
  "blueviolet",
  "brown",
  "burlywood",
  "cadetblue",
  "chartreuse",
  "chocolate",
  "coral",
  "cornflowerblue",
  "cornsilk",
  "crimson",
  "cyan",
  "darkblue",
  "darkcyan",
  "darkgoldenrod",
  "darkgray",
  "darkgreen",
  "darkgrey",
  "darkkhaki",
  "darkmagenta",
  "darkolivegreen",
  "darkorange",
  "darkorchid",
  "darkred",
  "darksalmon",
  "darkseagreen",
  "darkslateblue",
  "darkslategray",
  "darkslategrey",
  "darkturquoise",
  "darkviolet",
  "deeppink",
  "deepskyblue",
  "dimgray",
  "dimgrey",
  "dodgerblue",
  "firebrick",
  "floralwhite",
  "forestgreen",
  "fuchsia",
  "gainsboro",
  "ghostwhite",
  "gold",
  "goldenrod",
  "gray",
  "green",
  "greenyellow",
  "grey",
  "honeydew",
  "hotpink",
  "indianred",
  "indigo",
  "ivory",
  "khaki",
  "lavender",
  "lavenderblush",
  "lawngreen",
  "lemonchiffon",
  "lightblue",
  "lightcoral",
  "lightcyan",
  "lightgoldenrodyellow",
  "lightgray",
  "lightgreen",
  "lightgrey",
  "lightpink",
  "lightsalmon",
  "lightseagreen",
  "lightskyblue",
  "lightslategray",
  "lightslategrey",
  "lightsteelblue",
  "lightyellow",
  "lime",
  "limegreen",
  "linen",
  "magenta",
  "maroon",
  "mediumaquamarine",
  "mediumblue",
  "mediumorchid",
  "mediumpurple",
  "mediumseagreen",
  "mediumslateblue",
  "mediumspringgreen",
  "mediumturquoise",
  "mediumvioletred",
  "midnightblue",
  "mintcream",
  "mistyrose",
  "moccasin",
  "navajowhite",
  "navy",
  "oldlace",
  "olive",
  "olivedrab",
  "orange",
  "orangered",
  "orchid",
  "palegoldenrod",
  "palegreen",
  "paleturquoise",
  "palevioletred",
  "papayawhip",
  "peachpuff",
  "peru",
  "pink",
  "plum",
  "powderblue",
  "purple",
  "rebeccapurple",
  "red",
  "rosybrown",
  "royalblue",
  "saddlebrown",
  "salmon",
  "sandybrown",
  "seagreen",
  "seashell",
  "sienna",
  "silver",
  "skyblue",
  "slateblue",
  "slategray",
  "slategrey",
  "snow",
  "springgreen",
  "steelblue",
  "tan",
  "teal",
  "thistle",
  "tomato",
  "turquoise",
  "violet",
  "wheat",
  "white",
  "whitesmoke",
  "yellow",
  "yellowgreen",
] as const;

const utilitiesOpens = /@layer\s+utilities\s*\{/giu;
const hex = /#[0-9a-f]+/giu;
const colourFunction =
  /(?<![\w-])(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/giu;
const length = /(?<![\d.\w])-?[0-9]+(?:\.[0-9]+)?(px|rem)(?![\w-])/giu;
const word = /[a-z-]+/giu;

/** The text of every `@layer utilities` block, matched brace for brace. */
function consoleUtilitiesBlocks(stylesheet: string): readonly string[] {
  const blocks: string[] = [];
  utilitiesOpens.lastIndex = 0;
  for (let at = utilitiesOpens.exec(stylesheet); at !== null;) {
    let depth = 1;
    let read = at.index + at[0].length;
    const from = read;
    while (read < stylesheet.length && depth > 0) {
      const here = stylesheet[read];
      if (here === "{") depth += 1;
      else if (here === "}") depth -= 1;
      read += 1;
    }
    blocks.push(stylesheet.slice(from, depth === 0 ? read - 1 : read));
    utilitiesOpens.lastIndex = read;
    at = utilitiesOpens.exec(stylesheet);
  }
  return blocks;
}

/** A zero names no step of any scale, and a hairline is rounded for you. */
function consoleUtilitiesStatesLength(written: string): boolean {
  if (written === "1px") return false;
  return Number(written.replace(/(px|rem)$/u, "")) !== 0;
}

function consoleUtilitiesBlockFindings(block: string): readonly string[] {
  const findings: string[] = [];
  const said = (raw: string, what: string): void => {
    findings.push(
      `${raw} in the utilities layer, a raw ${what} the tokens state`,
    );
  };
  for (const [found] of block.matchAll(hex))
    if ([4, 5, 7, 9].includes(found.length)) said(found, "colour");
  for (const [, name] of block.matchAll(colourFunction))
    said(`${(name ?? "").toLowerCase()}()`, "colour");
  for (const found of block.matchAll(word)) {
    const name = found[0].toLowerCase();
    if (block[found.index + name.length] === "(") continue;
    if ((consoleRawColourNames as readonly string[]).includes(name))
      said(name, "colour");
  }
  for (const [found] of block.matchAll(length))
    if (consoleUtilitiesStatesLength(found)) said(found, "length");
  return findings;
}

/**
 * The built utilities layer, held to the clause
 * `.chug/tasks/check-console-sheets.sh` holds the sources to: a utility class
 * is the tokens under another name, never a second way to state a value.
 *
 * It is read from the build because the two ways a raw value reaches this
 * layer are both invisible in a source sheet — a default theme imported by a
 * later change, and an arbitrary value written into a class in TSX.
 */
export function consoleUtilitiesFindings(
  stylesheet: string,
): readonly string[] {
  return consoleUtilitiesBlocks(stylesheet).flatMap(
    consoleUtilitiesBlockFindings,
  );
}
