import assert from "node:assert/strict";
import test from "node:test";

import { routeParsed, routePath } from "../../ui/app/routes.js";

test("browser routes are bounded and round trip", () => {
  const routes = [
    { page: "Home" },
    { page: "Operations" },
    { page: "Configurations" },
    { page: "NewTicket" },
    { page: "Ticket", ticket: 42 },
  ];
  for (const route of routes)
    assert.deepEqual(routeParsed(routePath(route)), route);
});

test("unknown and out-of-range ticket routes fall back to home", () => {
  assert.deepEqual(routeParsed("/unknown"), { page: "Home" });
  assert.deepEqual(routeParsed("/tickets/0"), { page: "Home" });
  assert.deepEqual(routeParsed("/tickets/999999999999"), { page: "Home" });
  assert.deepEqual(routeParsed("/tickets/not-a-ticket"), { page: "Home" });
});
