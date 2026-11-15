/**
 * The page the listener answers with: the program's name, what happened as its
 * heading, and what to do next under it, drawn in the console's own tokens.
 *
 * It is one document with nothing to fetch: its sheet is inline and it runs no
 * script, and its policy refuses every request it could make. The program is
 * one bundled file with nothing beside it, so it cannot read
 * `app/styles/tokens.css`; the tokens it draws with are copied here, each
 * written as that file writes it, and `test/terminal/listener.test.ts` holds
 * every copy equal to its original.
 */

import { copyLocale } from "../app/copy/catalog.ts";

export const listenerPageTokens: Readonly<Record<string, string>> = {
  "--surface-0": "light-dark(#edf0ea, #0e1210)",
  "--surface-1": "light-dark(#f7f8f5, #151a17)",
  "--ink-1": "light-dark(#151a17, #eef2ee)",
  "--ink-2": "light-dark(#2b332e, #c9d1cb)",
  "--ink-3": "light-dark(#5b665f, #8a948c)",
  "--edge": "light-dark(#cdd4ca, #262d28)",
  "--font-prose":
    'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  "--text-sm": "0.75rem",
  "--text-md": "0.875rem",
  "--text-xl": "1.25rem",
  "--weight-medium": "500",
  "--weight-strong": "600",
  "--leading-tight": "1.25",
  "--leading-prose": "1.55",
  "--tracking-label": "0.06em",
  "--measure": "66ch",
  "--space-2": "0.5rem",
  "--space-4": "1rem",
  "--space-5": "1.5rem",
  "--space-7": "3rem",
  "--radius-2": "4px",
  "--hairline": "1px",
};

/** What the page may load, which is nothing but its own inline sheet. */
export const listenerPagePolicy =
  "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const listenerPageSheet = `
:root {
  color-scheme: light dark;
${Object.entries(listenerPageTokens)
  .map(([name, value]) => `  ${name}: ${value};`)
  .join("\n")}
}
body {
  margin: 0;
  min-height: 100vh;
  background: var(--surface-0);
  color: var(--ink-2);
  font-family: var(--font-prose);
  font-size: var(--text-md);
  line-height: var(--leading-prose);
}
main {
  box-sizing: border-box;
  max-width: var(--measure);
  margin: var(--space-7) auto;
  padding: var(--space-5);
  background: var(--surface-1);
  border: var(--hairline) solid var(--edge);
  border-radius: var(--radius-2);
}
.brand {
  margin: 0 0 var(--space-4);
  color: var(--ink-3);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
}
h1 {
  margin: 0 0 var(--space-2);
  color: var(--ink-1);
  font-size: var(--text-xl);
  font-weight: var(--weight-strong);
  line-height: var(--leading-tight);
}
p {
  margin: 0;
}
`;

/** Text as HTML reads it back unchanged, whatever the catalog writes. */
function listenerPageEscaped(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** The page saying `heading` under `brand`, and `next` under that. */
export function listenerPage(
  brand: string,
  heading: string,
  next: string,
): string {
  const named = listenerPageEscaped(brand);
  const said = listenerPageEscaped(heading);
  const told = listenerPageEscaped(next);
  return `<!doctype html>
<html lang="${copyLocale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${said} · ${named}</title>
<style>${listenerPageSheet}</style>
</head>
<body>
<main>
<p class="brand">${named}</p>
<h1>${said}</h1>
<p>${told}</p>
</main>
</body>
</html>
`;
}
