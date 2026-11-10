/**
 * The graph's layout as its own lazily loaded chunk, which the Graph tab and
 * the Overview's small graph both draw from.
 */

import { lazy } from "react";

export const EpicGraphLaidLazy = lazy(() => import("./EpicGraphLaid.tsx"));
