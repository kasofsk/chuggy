/**
 * The console's web app manifest against the files it names: every icon is in
 * `public/` at the size it declares, and the colours are the page's own.
 *
 * A browser that cannot fetch an icon, or reads a size the file is not, drops
 * the icon without a word, and a console with no usable icon is not offered
 * for install.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const consoleRoot = new URL("../../ui/chuggy-ui/", import.meta.url);
const publicRoot = new URL("public/", consoleRoot);

type ManifestIcon = {
  src: string;
  sizes: string;
  type: string;
  purpose: string;
};

const manifest = JSON.parse(
  readFileSync(new URL("manifest.webmanifest", publicRoot), "utf8"),
) as {
  start_url: string;
  scope: string;
  display: string;
  background_color: string;
  theme_color: string;
  icons: readonly ManifestIcon[];
};

/** Width and height from a PNG's header chunk, which leads every PNG. */
function consoleManifestPngSize(bytes: Buffer): string {
  assert.equal(bytes.subarray(1, 4).toString("latin1"), "PNG");
  assert.equal(bytes.subarray(12, 16).toString("latin1"), "IHDR");
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

/** The document, with its whitespace collapsed so a tag reads the same however it is wrapped. */
const markup = readFileSync(new URL("index.html", consoleRoot), "utf8").replace(
  /\s+/gu,
  " ",
);

/** The page colour, light then dark, as `tokens.css` states it. */
function consoleManifestSurface(): { light: string; dark: string } {
  const tokens = readFileSync(
    new URL("app/styles/tokens.css", consoleRoot),
    "utf8",
  );
  const found =
    /--surface-0:\s*light-dark\((#[0-9a-f]+),\s*(#[0-9a-f]+)\)/u.exec(tokens);
  assert.ok(found?.[1] !== undefined && found[2] !== undefined);
  return { light: found[1], dark: found[2] };
}

test("every icon the manifest names is a PNG in public/ at the size it declares", () => {
  assert.ok(manifest.icons.length > 0);
  for (const icon of manifest.icons) {
    assert.match(icon.src, /^\/[^/]/u);
    assert.equal(icon.type, "image/png");
    const bytes = readFileSync(new URL(icon.src.slice(1), publicRoot));
    assert.equal(consoleManifestPngSize(bytes), icon.sizes, icon.src);
  }
});

test("the manifest offers an icon at 192 and 512 for any use, and a maskable one", () => {
  const offered = manifest.icons.map((icon) => `${icon.purpose} ${icon.sizes}`);
  assert.ok(offered.includes("any 192x192"));
  assert.ok(offered.includes("any 512x512"));
  assert.ok(offered.some((entry) => entry.startsWith("maskable ")));
});

test("the installed console opens standalone over the whole origin", () => {
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
});

test("the manifest's colours and the document's theme colours are the page's", () => {
  const surface = consoleManifestSurface();
  assert.equal(manifest.background_color, surface.dark);
  assert.equal(manifest.theme_color, surface.dark);
  for (const scheme of ["light", "dark"] as const)
    assert.ok(
      markup.includes(
        `<meta name="theme-color" media="(prefers-color-scheme: ${scheme})" content="${surface[scheme]}" />`,
      ),
      scheme,
    );
});

test("the document links the manifest from the root", () => {
  assert.ok(
    markup.includes('<link rel="manifest" href="/manifest.webmanifest" />'),
  );
});
