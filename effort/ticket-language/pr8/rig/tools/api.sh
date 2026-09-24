#!/bin/sh
# api.sh METHOD PATH [local-body-file] — calls the rig API through Geoff's helper; prints the JSON body to stdout, the status to stderr.
body=""
if [ -n "$3" ]; then remote=/tmp/sanity-body-$$.json; scp -q "$3" dev2@10.100.0.1:$remote && ssh dev2@10.100.0.1 "chmod 644 $remote"; body=$remote; fi
out=$(ssh -o BatchMode=yes dev2@10.100.0.1 "sudo -n -u geoff /home/geoff/api-call.sh $1 '/api/v1/tenants/vteng/projects/chuggy$2' $body")
[ -n "$body" ] && ssh dev2@10.100.0.1 "rm -f $body"
printf '%s\n' "$out" | sed '$d'
printf '%s\n' "$out" | tail -n 1 >&2
