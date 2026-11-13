/**
 * The rendered cases, as `npm run render` runs them: the preconditions first,
 * then Playwright's runner over `playwright.config.ts`.
 *
 * A build that is not there and a browser that will not launch are each a
 * could-not-run, exit 2 with its remedy, because neither is a verdict about
 * the console. The browser is the one the lock's `playwright-core` names,
 * which `images/worker/Dockerfile` installs; it is asked by launching it,
 * since an executable that is present can still fail to start. A case that
 * fails is exit 1.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { renderedDist } from "./driver.ts";

const here = dirname(fileURLToPath(import.meta.url));

function runCouldNot(reason: string, remedy: string): never {
  console.error(`render: could not run — ${reason}`);
  console.error(`render: ${remedy}`);
  process.exit(2);
}

if (!existsSync(join(renderedDist, "index.html")))
  runCouldNot(
    `${renderedDist} holds no build`,
    "build it first with: npm run build --prefix ui/chuggy-ui",
  );

try {
  const browser = await chromium.launch();
  await browser.close();
} catch (failure: unknown) {
  runCouldNot(
    `the Chromium the lock's Playwright names did not launch: ${String(failure).split("\n")[0] ?? ""}`,
    "install it with: npx playwright install --only-shell chromium (the worker image ships it under PLAYWRIGHT_BROWSERS_PATH)",
  );
}

const cli = join(
  dirname(
    createRequire(import.meta.url).resolve("@playwright/test/package.json"),
  ),
  "cli.js",
);
const ran = spawnSync(
  process.execPath,
  [cli, "test", "--config", join(here, "playwright.config.ts")],
  { stdio: "inherit" },
);
process.exit(ran.status === 0 ? 0 : 1);
