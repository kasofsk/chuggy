#!/bin/sh
# op.sh '<mutation json>' — submits an operation and polls it to a settled state; prints the final operation body.
SP=/private/tmp/claude-501/-Users-david-chuggy/9ae6cf56-71f7-449a-9e5f-df4266aa8a85/scratchpad
u=$(uuidgen | tr A-Z a-z)
python3 -c 'import json,sys; print(json.dumps({"operation":sys.argv[1],"mutation":json.loads(sys.argv[2])}))' "$u" "$1" > $SP/op.json
$SP/api.sh POST /operations $SP/op.json >/dev/null 2>&1
for i in $(seq 1 40); do
  b=$($SP/api.sh GET /operations/$u 2>/dev/null)
  case "$b" in *'"state":"Pending"'*|*'"state":"Accepted"'*|"") sleep 3;; *) break;; esac
done
printf '%s\n' "$b"
