/**
 * Resolves an authored ticket document and its catalog fragments into a
 * `ReleasedTicket` the machine can hold.
 *
 * TWO THINGS THE DOMAIN STOPPED CARRYING LAND HERE. `ExecutionRequirements`
 * lost its repository and its access mode, so a work task's
 * `publishes_repository_result` stays in this tree's own resolved workload
 * document, where the execution view reads it back and where a reader would
 * look for it. And a release carries one content reference rather than a title
 * beside instructions, so the two authored fields are written as the markdown
 * every prompt already rendered them as, the title as the heading it was.
 */
import * as task from "../../domain/chuggernaut/task.js";
import * as evaluation from "../../domain/chuggernaut/evaluation.js";
import * as ticket from "../../domain/chuggernaut/ticket.js";
import {
  canonical_json,
  copy_json_metadata,
  parse_json,
} from "../../interpreter/json.ts";
import type {
  TicketCatalog,
  TicketCatalogSource,
  TicketContentStore,
  TicketCatalogRelease,
} from "../../interpreter/ticketCatalog.ts";
import type { TicketFinalizerConfiguration } from "../../interpreter/ticketFinalizer.ts";
import { schema_validator } from "./jsonSchema.ts";
import {
  catalogCheck,
  catalogDocument,
  catalogDocumentBytesMax,
  catalogReference,
  documentMapping,
  type CatalogDocument,
} from "./document.ts";

type Fragment = string | CatalogDocument;
interface TicketDocument {
  readonly title?: string;
  readonly instructions?: string;
  readonly dependencies?: readonly number[];
  readonly inputs?: CatalogDocument;
  readonly rework_limit?: number;
  readonly work: Fragment;
  readonly evaluation: Fragment;
  readonly finalization: Fragment;
}
interface WorkloadDocument extends CatalogDocument {
  readonly result_contract: Fragment;
  readonly execution_profile?: string;
  readonly publishes_repository_result?: boolean;
  readonly prompt?: string;
  readonly cloud_identity?: {
    readonly workload: string;
    readonly identity: string;
  };
}
interface EvaluatorDocument {
  readonly name: string;
  readonly workload: Fragment;
}
interface PlanDocument {
  readonly stages: readonly {
    readonly name: string;
    readonly evaluators: readonly Fragment[];
  }[];
}
interface CatalogContext {
  readonly source: TicketCatalogSource;
  readonly content: TicketContentStore;
  readonly files: Map<string, string>;
}

async function catalogRead(
  context: CatalogContext,
  path: string,
): Promise<string> {
  const cached = context.files.get(path);
  if (cached !== undefined) return cached;
  if (context.files.size >= 1000)
    throw new RangeError("catalog reference limit exceeded");
  const content = await context.source.read(path);
  if (Buffer.byteLength(content) > catalogDocumentBytesMax)
    throw new RangeError("catalog file exceeds size limit");
  context.files.set(path, content);
  return content;
}

async function catalogFragment<T extends object>(
  context: CatalogContext,
  authored: Fragment,
  directory: string,
  kind: string,
): Promise<T> {
  const document =
    typeof authored === "string"
      ? catalogDocument(
          await catalogRead(
            context,
            catalogReference(authored, directory, ".yaml"),
          ),
        )
      : authored;
  return catalogCheck<T>(kind, document);
}

async function catalogResultContract(
  context: CatalogContext,
  authored: Fragment,
): Promise<task.ContentRef> {
  const schema: unknown =
    typeof authored === "string"
      ? parse_json(
          await catalogRead(
            context,
            catalogReference(authored, "result-contracts", ".schema.json"),
          ),
        )
      : authored;
  if (!documentMapping(schema))
    throw new TypeError("result contract must be a JSON Schema object");
  const validator = schema_validator(schema);
  if (!validator.validateSchema(schema))
    throw new TypeError(
      `invalid result contract: ${JSON.stringify(validator.errors)}`,
    );
  return context.content.put("application/schema+json", canonical_json(schema));
}

function catalogCloudIdentity(
  context: CatalogContext,
  workload: WorkloadDocument,
  resolved: CatalogDocument,
  container: string,
): void {
  if (workload.cloud_identity === undefined) return;
  const project = context.source.cloudProject;
  if (
    project === undefined ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,62}\/[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/u.test(
      project,
    )
  )
    throw new TypeError("cloud_identity requires a valid cloud_project");
  if (
    Buffer.byteLength(
      `${project}:${workload.cloud_identity.workload}:${container}`,
    ) > 127
  )
    throw new TypeError("cloud identity composite exceeds size limit");
  resolved["cloud_identity"] = { ...workload.cloud_identity, project };
}

/** Resolves one workload into a task definition and says whether it publishes. */
async function catalogTask(
  context: CatalogContext,
  authored: Fragment,
  inputs: task.ContentRef,
  container: string,
): Promise<{
  readonly definition: task.TaskDefinition;
  readonly publishes: boolean;
}> {
  const workload = await catalogFragment<WorkloadDocument>(
    context,
    authored,
    "workloads",
    "workload",
  );
  const contract = await catalogResultContract(
    context,
    workload.result_contract,
  );
  if (container !== "work" && "publishes_repository_result" in workload)
    throw new TypeError(
      "evaluator workloads must not declare publishes_repository_result",
    );
  const resolved = copy_json_metadata<CatalogDocument>(workload, {
    ...workload,
  });
  delete resolved["result_contract"];
  const publishes =
    container === "work" && workload.publishes_repository_result !== false;
  resolved["publishes_repository_result"] = publishes;
  let capabilities: readonly string[] = [];
  if (workload.execution_profile !== undefined) {
    const profile = context.source.executionProfiles.get(
      workload.execution_profile,
    );
    if (profile === undefined)
      throw new TypeError(
        `unknown execution profile: ${workload.execution_profile}`,
      );
    resolved["execution_profile"] = {
      name: workload.execution_profile,
      ...profile,
    };
    capabilities = profile.required_capabilities;
  }
  if (workload.prompt?.startsWith("agents/"))
    resolved["prompt"] = await catalogRead(
      context,
      catalogReference(workload.prompt, "agents", ".md"),
    );
  catalogCloudIdentity(context, workload, resolved, container);
  return {
    definition: new task.TaskDefinition(
      await context.content.put("application/json", canonical_json(resolved)),
      inputs,
      new task.ExecutionRequirements(capabilities),
      contract,
    ),
    publishes,
  };
}

interface CatalogPlan {
  readonly plan: evaluation.EvaluationPlan;
  readonly stageNames: ReadonlyMap<task.StageKey, string>;
  readonly evaluatorNames: ReadonlyMap<task.EvaluatorKey, string>;
}

async function catalogPlan(
  context: CatalogContext,
  authored: Fragment,
  inputs: task.ContentRef,
): Promise<CatalogPlan> {
  const document = await catalogFragment<PlanDocument>(
    context,
    authored,
    "evaluation-plans",
    "evaluation-plan",
  );
  const stages: evaluation.StageDefinition[] = [];
  const stageNames = new Map<task.StageKey, string>();
  const evaluatorNames = new Map<task.EvaluatorKey, string>();
  const keys = new Map<string, task.EvaluatorKey>();
  const seen = new Set<string>();
  for (const [index, stage] of document.stages.entries()) {
    if (seen.has(stage.name))
      throw new TypeError(`duplicate stage name: ${stage.name}`);
    seen.add(stage.name);
    const key = task.StageKey(index + 1);
    stageNames.set(key, stage.name);
    const evaluators: evaluation.EvaluatorDefinition[] = [];
    const names = new Set<string>();
    for (const authoredEvaluator of stage.evaluators) {
      const evaluator = await catalogFragment<EvaluatorDocument>(
        context,
        authoredEvaluator,
        "evaluators",
        "evaluator",
      );
      if (names.has(evaluator.name))
        throw new TypeError(`duplicate evaluator in stage: ${evaluator.name}`);
      names.add(evaluator.name);
      const evaluatorKey =
        keys.get(evaluator.name) ?? task.EvaluatorKey(keys.size + 1);
      keys.set(evaluator.name, evaluatorKey);
      evaluatorNames.set(evaluatorKey, evaluator.name);
      evaluators.push(
        new evaluation.EvaluatorDefinition(
          evaluatorKey,
          (
            await catalogTask(
              context,
              evaluator.workload,
              inputs,
              `eval:${String(key)}:${String(evaluatorKey)}`,
            )
          ).definition,
        ),
      );
    }
    stages.push(new evaluation.StageDefinition(key, evaluators));
  }
  return {
    plan: new evaluation.EvaluationPlan(stages),
    stageNames,
    evaluatorNames,
  };
}

/** The one markdown document a release carries as its content. */
function catalogReleasedContent(document: TicketDocument): string {
  const title = document.title ?? "";
  const instructions = document.instructions ?? "";
  return title === "" ? instructions : `# ${title}\n\n${instructions}`;
}

async function catalogRelease(
  context: CatalogContext,
  identity: task.TicketId,
  source: string,
): Promise<TicketCatalogRelease> {
  const document = catalogCheck<TicketDocument>(
    "ticket",
    catalogDocument(source),
  );
  const inputs = await context.content.put(
    "application/json",
    canonical_json(document.inputs ?? {}),
  );
  const work = await catalogTask(context, document.work, inputs, "work");
  const plan = await catalogPlan(context, document.evaluation, inputs);
  const finalizer = await catalogFragment<TicketFinalizerConfiguration>(
    context,
    document.finalization,
    "finalizers",
    "finalizer",
  );
  if (finalizer.operation !== "no-op" && !work.publishes)
    throw new TypeError(
      `${finalizer.operation} finalization requires work that publishes a repository result`,
    );
  const definition = new ticket.ReleasedTicket(
    identity,
    await context.content.put(
      "text/markdown",
      catalogReleasedContent(document),
    ),
    inputs,
    new Set((document.dependencies ?? []).map(task.TicketId)),
    work.definition,
    plan.plan,
    await context.content.put("application/json", canonical_json(finalizer)),
  );
  ticket.validate_release(definition);
  return {
    definition,
    stageNames: plan.stageNames,
    evaluatorNames: plan.evaluatorNames,
    reworkLimit: document.rework_limit ?? context.source.reworkLimit,
    reworkLimitDeclared: document.rework_limit !== undefined,
  };
}

export function ticketCatalog(
  source: TicketCatalogSource,
  content: TicketContentStore,
): TicketCatalog {
  return {
    release: (identity, document) =>
      catalogRelease({ source, content, files: new Map() }, identity, document),
  };
}
