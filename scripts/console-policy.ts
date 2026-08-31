/**
 * What a built console's document may carry, and the cascade order the
 * stylesheet it loads must be emitted in.
 *
 * The policy `images/web/nginx.conf` serves a console under is
 * `default-src 'none'` with `script-src 'self'` and `style-src 'self'` — no
 * `'unsafe-inline'`, no nonce — so an inline script or style is a page that
 * loads in a dev server and is blank in production, and a subresource from
 * another origin is a page missing a piece of itself.
 *
 * THE CASCADE IS THE SECOND DECISION AND IT IS READ FROM THE SAME BUILD. The
 * design system orders its layers `tokens, base, ui, page`, and the production
 * minifier drops a bare `@layer` statement whenever the order it emits the
 * blocks in already satisfies it — so the order the browser gets comes from
 * the order the entry imports the sheets in, and nothing about that order is
 * visible in a source file. A layer out of place is silent: the element
 * defaults win over the primitives, every button-shaped link gains an
 * underline, and no source file has changed. So the emitted sheet is read and
 * the layers it declares must appear in the system's own order, with a
 * statement — where a build keeps one — naming exactly that order ahead of
 * every block.
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
export const consoleCascadeLayers = ["tokens", "base", "ui", "page"] as const;

export type ConsoleCascadeLayer = (typeof consoleCascadeLayers)[number];

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

export function consoleCascadeFindings(stylesheet: string): readonly string[] {
  const findings: string[] = [];
  const blocks = consoleCascadeBlocks(stylesheet);
  for (const name of blocks)
    if (!consoleCascadeOrders(name))
      findings.push(`a layer named ${name}, which the system does not order`);
  const stated = layerStatement.exec(stylesheet);
  if (stated !== null) {
    const named = (stated[1] ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name !== "");
    if (named.join(", ") !== consoleCascadeLayers.join(", "))
      findings.push(
        `a layer statement of ${named.join(", ")}, not ${consoleCascadeLayers.join(", ")}`,
      );
    const opened = stylesheet.search(layerBlock);
    if (opened !== -1 && opened < stated.index)
      findings.push("a layer opened above the statement that orders them");
    return findings;
  }
  const wanted = consoleCascadeLayers.filter((name) => blocks.includes(name));
  const drawn = blocks.filter(consoleCascadeOrders);
  if (drawn.join(", ") !== wanted.join(", "))
    findings.push(
      `layers emitted as ${drawn.join(", ")}, not ${wanted.join(", ")}`,
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
