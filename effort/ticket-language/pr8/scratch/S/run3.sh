#!/bin/sh
run() { cat > /tmp/claude-1000/m.py <<PY
import sys; sys.argv=['x','$1']
exec(open('/home/geoff/claude/chuggy-effort/ticket-language/pr8/scratch/S/mutate.py').read())
PY
  /home/geoff/claude/chuggy-effort/ticket-language/pr8/scratch/S/redproof.sh "$1" /tmp/claude-1000/m.py "$2"
}
run index_at_the_old_key 'index answers a read at the key'
run obligation_any_task 'released as the definition it runs at'
run accepted_source_unweighed 'released as the definition it runs at'
