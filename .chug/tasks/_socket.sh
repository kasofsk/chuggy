# A fixture PATH with no docker on it, and a TCP socket that answers like a
# server, for suites driving a gate that acquires PostgreSQL through
# `_postgres.sh`.
#
# Contract for a sourcing suite (source after `_suite.sh`, whose $WORK this
# uses and whose EXIT trap this replaces to also kill the socket):
#   provides  $BIN      a directory holding node and the shell's own tools and
#                       no docker, for a case that runs the gate with PATH=$BIN
#             $ANSWERS  a postgres:// URL naming a socket that accepts and
#                       says nothing — enough for the reachability probe, and
#                       not a database
#             $SILENT   a loopback address nothing listens on
#   exits     2 through the sourcing suite when the socket never opens

NODE_DIR="$(dirname "$(command -v node)")"
BIN="$WORK/bin"
mkdir -p "$BIN"
ln -sf "$NODE_DIR/node" "$BIN/node"
for tool in git find grep sort dirname mktemp sed; do
	if command -v "$tool" >/dev/null 2>&1; then
		ln -sf "$(command -v "$tool")" "$BIN/$tool"
	fi
done

PORT_FILE="$WORK/.port"
node -e '
const fs = require("node:fs");
const net = require("node:net");
const server = net.createServer((socket) => socket.destroy());
server.listen(0, "127.0.0.1", () => {
  fs.writeFileSync(process.argv[1], String(server.address().port));
});
' "$PORT_FILE" &
SOCKET=$!
# The harness removes $WORK on exit; this adds the socket to what goes with it.
trap 'kill "$SOCKET" 2>/dev/null || true; rm -rf "$WORK"' EXIT

SOCKET_WAIT_SECS=10
waited=0
until [ -s "$PORT_FILE" ]; do
	if [ "$waited" -ge "$SOCKET_WAIT_SECS" ]; then
		echo "${0##*/}: LINTER ERROR — the fixture socket never opened"
		exit 2
	fi
	sleep 1
	waited=$((waited + 1))
done
ANSWERS="postgres://fixture@127.0.0.1:$(cat "$PORT_FILE")/ignored"

# An address on the loopback that nothing is listening on, which is the shape
# of a URL naming a server that is not running.
SILENT="127.0.0.1:1"
