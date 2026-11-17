#!/bin/sh
# What an image a chat container starts from holds for its sessions, made and
# proved in the image being built: the `worker-base` and `chat` stages of
# `Dockerfile` each run this as root, once the runtime is at `/opt/chuggy` and
# the image's PATH is set.
#
# THE USERS A CHAT SESSION RUNS AS ARE NAMED. A member's chat container runs
# the core's supervisor as root, and it starts each session through `setpriv`
# and `prlimit` as a user of its own range, whose group is the same number and
# whose home is under the core's sessions directory. Git, ssh and node's
# `os.userInfo()` look up the user they run as, and refuse one the image does
# not name. The range, the directory the homes are under and each user's home
# are read off the core, as the `chatSessionUidFirst`, `chatSessionUidCount`,
# `chatSessionsDirectory` and `chatSessionHome` of its `chatSession.mjs`, since
# its supervisor refuses to start where a session user's home is not the one
# `chatSessionHome` names. The groups a session reads its mirror through are
# left unnamed: git, ssh and node look up none of them by name, and git holds a
# tree to its owner's user and not its group. `id` and `groups` print such a
# group by its number, and say they could not find its name.
#
# A SESSION'S SHELL FINDS `chuggy` ON PATH AND RUNS IT. Run as the last session
# user with none of its shell credential's variables set, the command answers
# that they are unset and exits 2, which it does only once its modules load.
#
# Exits 0 done, 1 where a user could not be made or a probe did not hold.
set -eu
export LC_ALL=C

refuse() {
	echo "chat sessions: $*" >&2
	exit 1
}

scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT

/opt/chuggy/bin/node --input-type=module --eval '
  import { chatSessionHome, chatSessionUidCount, chatSessionUidFirst, chatSessionsDirectory }
    from "/opt/chuggy/lib/chuggy/chatSession.mjs";
  console.log(`${chatSessionUidFirst} ${chatSessionUidCount} ${chatSessionsDirectory}`);
  for (let uid = chatSessionUidFirst; uid < chatSessionUidFirst + chatSessionUidCount; uid++)
    console.log(`${uid} ${chatSessionHome(chatSessionsDirectory, uid)}`);
' >"$scratch/sessions.txt" || refuse "the core did not name its session users"
read -r first count sessions <"$scratch/sessions.txt"
last="$((first + count - 1))"
echo "chat sessions: users $first to $last, homes under $sessions"
tail -n +2 "$scratch/sessions.txt" >"$scratch/homes.txt"
while read -r uid home; do
	groupadd --gid "$uid" "chat-$uid" ||
		refuse "could not make the group chat-$uid"
	useradd --uid "$uid" --gid "$uid" --no-create-home --no-log-init \
		--home-dir "$home" --shell /bin/bash "chat-$uid" ||
		refuse "could not make the user chat-$uid"
done <"$scratch/homes.txt"
name="$(setpriv --reuid "$last" --regid "$last" --clear-groups id -un)" ||
	refuse "setpriv could not run as the last session user"
[ "$name" = "chat-$last" ] ||
	refuse "the last session user is named $name, not chat-$last"
prlimit --version || refuse "prlimit did not run"

[ "$(command -v chuggy)" = /opt/chuggy/path/chuggy ] ||
	refuse "chuggy on PATH is $(command -v chuggy || echo nothing)"
[ "$(ls -A /opt/chuggy/path)" = chuggy ] ||
	refuse "/opt/chuggy/path holds more than chuggy"
status=0
setpriv --reuid "$last" --regid "$last" --clear-groups \
	env -i PATH="$PATH" chuggy read_ticket >"$scratch/chuggy.out" 2>&1 || status=$?
if [ "$status" != 2 ] || ! grep -q ' unset' "$scratch/chuggy.out"; then
	cat "$scratch/chuggy.out" >&2
	refuse "chuggy on PATH exited $status"
fi
