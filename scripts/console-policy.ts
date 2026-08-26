/**
 * What a built console's document may carry, decided over the markup alone.
 *
 * The policy `images/web/nginx.conf` serves a console under is
 * `default-src 'none'` with `script-src 'self'` and `style-src 'self'` — no
 * `'unsafe-inline'`, no nonce — so an inline script or style is a page that
 * loads in a dev server and is blank in production, and a subresource from
 * another origin is a page missing a piece of itself.
 *
 * WHAT IT CANNOT SEE, said plainly so nobody trusts it further than it goes: a
 * URL a script builds at run time is invisible here, and the policy itself is
 * what refuses that one. What this covers is the document a bundler emitted,
 * which is where an added inline script or a rewritten asset host shows up.
 * Attribute values are read in all three forms the markup allows — double
 * quoted, single quoted and bare — because which one a bundler writes is the
 * bundler's business and not a property this may depend on.
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
