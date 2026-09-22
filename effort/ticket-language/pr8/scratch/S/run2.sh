#!/bin/sh
run() { cat > /tmp/claude-1000/m.py <<PY
import sys; sys.argv=['x','$1']
exec(open('/home/geoff/claude/chuggy-effort/ticket-language/pr8/scratch/S/mutate.py').read())
PY
  /home/geoff/claude/chuggy-effort/ticket-language/pr8/scratch/S/redproof.sh "$1" /tmp/claude-1000/m.py "$2"
}
EVENTS='released as the definition it runs at'
ROWS='relations a release fills hold'
run obligation_not_an_object "$EVENTS"
run definition_unbounded "$ROWS"
run definition_digest_unnamed "$ROWS"
run definition_ticket_unfloored "$ROWS"
run source_not_whole "$ROWS"
run source_unfloored "$ROWS"
run commit_not_hex "$ROWS"
run work_definition_misread 'work obligation the release wrote down'
run evaluator_key_ignored "definction|definition the evaluator"
run context_is_not_the_cycle 'work obligation the release wrote down'
run source_folded_from_the_result 'work obligation the release wrote down'
run source_row_unwritten 'work obligation the release wrote down'
run unsourced_pass_admitted 'refused on a ticket bound to a repository'
run index_at_the_old_key 'release index answers a read at either tag'
run authority_keeps_the_tag 'authority a completion is admitted under'
run entry_unreadable_by_the_door 'relations a release fills are open'
run scheduler_reads_no_source 'relations a release fills are open'
run api_reads_no_source 'relations a release fills are open'
run predicate_unowned 'reference predicates are'
