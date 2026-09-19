/** One dispatched work obligation asking for exactly the capabilities it is given. */
import * as task from "../../src/domain/chuggernaut/task.js";
import * as ticket from "../../src/domain/chuggernaut/ticket.js";
import {
  Driver,
  PLAN,
  released,
  dispatch,
  work_obligation,
} from "../chuggernaut/domain/testing.js";

export function obligationNeeding(
  capabilities: readonly string[],
): task.TaskObligation {
  const driver = new Driver();
  const base = released(1);
  driver.submit(
    new ticket.CreateTicket(
      new ticket.ReleasedTicket(
        base.id,
        base.content,
        base.input_bindings,
        base.dependencies,
        new task.TaskDefinition(
          base.work_configuration.workload,
          base.work_configuration.inputs,
          new task.ExecutionRequirements(capabilities),
          base.work_configuration.result_contract,
        ),
        PLAN,
        base.finalization_configuration,
      ),
    ),
  );
  driver.submit(dispatch(1));
  return work_obligation(driver.graph, 1);
}
