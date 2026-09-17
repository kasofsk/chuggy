import assert from "node:assert/strict";
import { test } from "node:test";
import { basename } from "node:path";
import * as ticket from "../../src/domain/chuggernaut/ticket.js";
import { equal } from "../../src/domain/chuggernaut/task.js";
import * as itf from "./conformance/itf.js";
import * as replay from "./conformance/replay.js";

const traces = itf.load_traces();
assert.ok(traces.length > 0, "the upstream trace corpus must be nonempty");
for (const trace of traces) {
  test(basename(trace.path), () => {
    for (const step of itf.steps(trace)) {
      const state = trace.states[step.index];
      assert.ok(state);
      const priorValue = state[itf.PRIOR_GRAPH_VAR];
      const graphValue = state[itf.GRAPH_VAR];
      const decisionValue = state[itf.DECISION_VAR];
      assert.notEqual(priorValue, undefined);
      assert.notEqual(graphValue, undefined);
      assert.notEqual(decisionValue, undefined);
      if (
        priorValue === undefined ||
        graphValue === undefined ||
        decisionValue === undefined
      )
        throw new Error("trace omits ticket state or decision");
      const prior = replay.graph_from_itf(priorValue);
      const graph = replay.graph_from_itf(graphValue);
      const decision = replay.decision_from_itf(decisionValue);
      assert.ok(ticket.graph_invariant(prior));
      assert.ok(ticket.graph_invariant(graph));
      assert.ok(ticket.decision_valid(prior, decision));
      assert.ok(equal(ticket.apply_decision(prior, decision), graph));
      if (decision instanceof ticket.TicketDecided) {
        assert.ok(equal(ticket.evolve_checked(prior, decision.event), graph));
      }
      const rebuilt = replay.command_from_step(step, prior);
      if (rebuilt instanceof replay.Reconstructed) {
        ticket.validate_command(rebuilt.command);
        assert.deepEqual(
          ticket.decide(prior, rebuilt.command, rebuilt.policy),
          decision,
        );
      } else {
        assert.notEqual(
          trace.kind,
          "simulation",
          "every simulated command must be replayed",
        );
      }
    }
  });
}
