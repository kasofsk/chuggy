/** One seeded walk of the frame; the walk is in `shellWalk.tsx`. */

// jscpd:ignore-start -- the doubles a `vi.mock` cannot hoist out, repeated by each seed's file
import { test, vi } from "vitest";
import type * as BrowserPorts from "../app/browser/ports.ts";
import type * as RouterModule from "@tanstack/react-router";

import { shellFrameEachCase, styleless } from "./shellFrame.tsx";
import { atlas } from "./shellRouter.tsx";
import type { PartitionIdentity } from "../../../src/contract/http.ts";
import {
  walkDrawn,
  walkReplayed,
  walkRouted,
  walkTimeoutMs,
} from "./shellWalk.tsx";

vi.mock("../app/browser/ports.ts", async (importOriginal) =>
  (await import("./shellRouter.tsx")).portsDouble(
    await importOriginal<typeof BrowserPorts>(),
  ),
);

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const { routerDouble } = await import("./shellRouter.tsx");
  return routerDouble(await importOriginal<typeof RouterModule>(), {
    outlet: () => null,
    params: () => routeParams,
  });
});

let routeParams: PartitionIdentity & { readonly session?: string } = atlas;

walkRouted((params) => {
  routeParams = params;
});
shellFrameEachCase(() => {
  routeParams = atlas;
});

test.each([1])(
  "the frame is drawn as the trail says after every move of a walk, seed %i",
  async (seed) => {
    await walkReplayed(walkDrawn(seed), `seed ${String(seed)}`);
    styleless();
  },
  walkTimeoutMs,
);
// jscpd:ignore-end -- the seed is the file's own
