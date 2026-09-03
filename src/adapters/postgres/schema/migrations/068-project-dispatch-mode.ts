/**
 * A delivery row is stamped from the dispatch mode the PROJECT resolves to, and
 * that resolution has one home on the durable side.
 *
 * THE TRIGGER READ THE INSTALLATION WHILE THE WRITER READ THE PROJECT. 010's
 * `enforce_selector_proposal_initial_state` predates per-project settings: it
 * takes `dispatch_mode` off `selector_runtime_settings` alone, and it runs
 * BEFORE INSERT, so the state the adapter computed from the resolved settings
 * is replaced by the installation's answer every time. 053 gave a project its
 * own `dispatch_mode` and left the trigger where it was; 064 rekeyed the
 * relation and did not touch it either. On the rig that stamped every delivery
 * of a project reading `Automatic` as `AwaitingApproval`, which nothing claims
 * (kasofsk/chuggy#549). The reverse pairing is the one that costs: a project
 * asking for `ApprovalRequired` under an installation default of `Automatic`
 * was stamped `Pending` and delivered without the approval it asked for.
 *
 * THE RESOLUTION IS A FUNCTION AND NOT A CLAUSE IN THE TRIGGER. Written into
 * the trigger body the precedence would be a rule with no name, reachable only
 * by offering a row and readable only through the stamping it feeds; as a
 * function it is a thing a case can drive on its own and a later reader can
 * call. Its precedence is the project's override over the installation default,
 * which is the precedence `resolvedSelectorSettings` states on the interpreter
 * side.
 *
 * THE TRIGGER STILL EXISTS AND STILL OVERRULES. The adapter goes on writing the
 * state it resolved, and the trigger goes on writing it again from the rows
 * themselves, because the relation answers for the mode a delivery was admitted
 * under and a writer naming the wrong one is exactly what it must not be able
 * to do. What changes is that the two sides now state one rule instead of two,
 * and a case drives both over every pairing and requires them equal.
 *
 * THE KILL SWITCH KEEPS ITS LOCK AND THE RESOLUTION ADDS NONE. 010's `FOR
 * SHARE` still guards the read of the installation's `mode`. It is not extended
 * over the project's row: a share lock there would order a settings write
 * against this insert without changing the mode either of them reads.
 *
 * THE PAUSE ARM STAYS THE INSTALLATION'S. An installation pause is the kill
 * switch, which is why the interpreter's resolution treats it as a ceiling
 * rather than an override; a project's own pause is not one, and it stops that
 * project deciding before any row is offered. This migration changes what a row
 * is stamped with, never whether one is written.
 *
 * NO ROW ALREADY STANDING MOVES. A delivery holds the state it was admitted
 * under, and restamping one would put work an operator was never shown back
 * into the claim, or take a row out from under a reviewer looking at it.
 */

import {
  boundaryOwnerRole,
  selectorProjectDispatchModeFunction,
  selectorProposalInitialStateFunction,
  type Migration,
} from "../shared.ts";

/** The one durable statement of the precedence: a project's override, then the installation's default. */
const projectDispatchModeResolution = [
  `CREATE FUNCTION ${selectorProjectDispatchModeFunction}(
     in_tenant text,in_project text)
     RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
       SELECT coalesce(overrides.dispatch_mode,installation.dispatch_mode)
         FROM selector_runtime_settings installation
         LEFT JOIN selector_project_settings overrides
           ON overrides.tenant=in_tenant AND overrides.project=in_project
        WHERE installation.singleton=1
     $$`,
  `ALTER FUNCTION ${selectorProjectDispatchModeFunction}(text,text)
     OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${selectorProjectDispatchModeFunction}(text,text) FROM PUBLIC`,
];

/**
 * 010's trigger with its dispatch-mode arm asking the resolution instead of the
 * installation. It is replaced at the signature it holds, which keeps the
 * owner, the revoke and the trigger bound to it while taking everything else
 * from this command — the `search_path` pin included, so the pin is restated
 * here rather than inherited.
 */
const initialStateAsksTheResolution = [
  `CREATE OR REPLACE FUNCTION ${selectorProposalInitialStateFunction}() RETURNS trigger
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE running_mode text;
     BEGIN
       SELECT mode INTO STRICT running_mode
         FROM selector_runtime_settings WHERE singleton=1 FOR SHARE;
       IF running_mode='Paused' THEN RETURN NULL; END IF;
       NEW.state=CASE ${selectorProjectDispatchModeFunction}(NEW.tenant,NEW.project)
         WHEN 'Automatic' THEN 'Pending' ELSE 'AwaitingApproval' END;
       NEW.outcome=NULL;
       NEW.attempts=0;
       NEW.retry_at=now();
       NEW.reconcile_at=NULL;
       NEW.reconciliation_attempts=0;
       RETURN NEW;
     END $$`,
];

/** A delivery is stamped from the mode its own project resolves to. */
export const migration068: Migration = {
  version: 68,
  name: "a delivery is stamped from its project's dispatch mode",
  statements: [
    ...projectDispatchModeResolution,
    ...initialStateAsksTheResolution,
  ],
};
