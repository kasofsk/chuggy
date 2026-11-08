/**
 * How a run's series of turns is paged: a contract because a console reads it
 * page by page and must ask for no more than the server answers.
 */

import { nativeHttpPageItemsMax } from "./http.ts";

/** The most turns one page of a run's series carries, which is the page bound every route shares. */
export const runTurnsPageLimitMax = nativeHttpPageItemsMax;
