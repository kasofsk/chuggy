/**
 * The graph's layout as its own lazily loaded chunk, which the Overview's
 * small graph draws from.
 */

import { lazy } from "react";

export const EpicGraphLaidLazy = lazy(() => import("./EpicGraphLaid.tsx"));
