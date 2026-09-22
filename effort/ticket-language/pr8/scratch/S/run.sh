#!/bin/sh
run() { cat > /tmp/claude-1000/m.py <<PY
import sys; sys.argv=['x','$1']
exec(open('/home/geoff/claude/chuggy-effort/ticket-language/pr8/scratch/S/mutate.py').read())
PY
  /home/geoff/claude/chuggy-effort/ticket-language/pr8/scratch/S/redproof.sh "$1" /tmp/claude-1000/m.py "$2"
}
EVENTS='released as the definition it runs at'
ROWS='relations a release fills hold'
run unregistered 'records the ticket released'
run guard_deleted 'definition arriving and names the wipe'
run guard_remedy 'definition arriving and names the wipe'
run old_spelling_admitted "$EVENTS"
run content_unweighed "$EVENTS"
run work_definition_unweighed "$EVENTS"
run evaluator_definition_unweighed "$EVENTS"
run stage_not_positional "$EVENTS"
run evaluators_not_distinct "$EVENTS"
run dispatch_unweighed "$EVENTS"
run dispatch_source_unfloored "$EVENTS"
run obligation_any_task "$EVENTS"
run obligation_context_unweighed "$EVENTS"
run accepted_source_unweighed "$EVENTS"
run produced_not_an_object "$EVENTS"
run result_reference_unweighed "$EVENTS"
