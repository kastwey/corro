#!/bin/bash
# Session start for Claude Code on the web.
#
# A remote session gets a fresh container with the repository and Node, and nothing else this
# project needs: no .NET SDK, no PowerShell, no npm packages, no Playwright browser. Without them
# an agent can run exactly ONE of the four gates in AGENTS.md (the frontend suite) and has to
# write "could not run" in its summary instead of proving the change — which is the same as not
# having a gate at all.
#
# So this installs what the gates need, in the order verifying-changes runs them:
#   1. PowerShell            -> tools/tests/repository-language.tests.ps1 (and tools/*.ps1)
#   2. frontend npm packages -> npm run build && npm test
#   3. the .NET SDK          -> dotnet build / dotnet test
#   4. e2e npm packages
#   5. the matching browser  -> …without which the Playwright suite cannot start
#   6. a warm server build   -> so the first dotnet test is a test run, not a first build
#
# The container is snapshotted once this finishes, so a later session starts with all of it
# already in place: the cost is paid per snapshot, not per session. Every step is idempotent — a
# second run finds the SDK installed, npm up to date and the browser present, and does nothing.
#
# Output is deliberately a handful of short lines. A session-start hook's stdout becomes context
# the agent carries for the rest of the conversation, and a full npm log is a poor use of it. The
# detail goes to $LOG, and the tail of it is printed if a step actually fails.
set -euo pipefail

# Local machines have their own .NET, their own PowerShell, their own node_modules and their own
# browsers, and this script has no business touching any of them. tools/dev.ps1 is the local path
# (see the README).
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
	exit 0
fi

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
TMP="${TMPDIR:-/tmp}"
LOG="$TMP/corro-session-start.log"
DOTNET_DIR="${DOTNET_ROOT:-$HOME/.dotnet}"
PWSH_DIR="$HOME/.pwsh"
# The channel the server targets (server/CorroServer.csproj: net10.0). Moving the target
# framework means moving this line with it.
DOTNET_CHANNEL="10.0"
PWSH_VERSION="7.5.0"

: > "$LOG"

# Run a step quietly; on failure say which one it was, show the end of its log, and stop.
step() {
	local what="$1"; shift
	echo "[session-start] $what"
	if ! "$@" >> "$LOG" 2>&1; then
		echo "[session-start] FAILED: $what"
		tail -n 30 "$LOG"
		return 1
	fi
}

# ── 1. PowerShell, for the repository-conventions gate and the tools/ scripts ───────────────
install_pwsh() {
	mkdir -p "$PWSH_DIR"
	curl -sSL --retry 3 --max-time 180 -o "$TMP/pwsh.tar.gz" \
		"https://github.com/PowerShell/PowerShell/releases/download/v$PWSH_VERSION/powershell-$PWSH_VERSION-linux-x64.tar.gz"
	tar -xzf "$TMP/pwsh.tar.gz" -C "$PWSH_DIR"
	chmod +x "$PWSH_DIR/pwsh"
	rm -f "$TMP/pwsh.tar.gz"
}
[ -x "$PWSH_DIR/pwsh" ] || step "PowerShell $PWSH_VERSION" install_pwsh
export PATH="$PWSH_DIR:$PATH"

# ── 2. Frontend packages ────────────────────────────────────────────────────────────────────
# install, not ci: the container state is cached after this hook, and install is the one that
# takes advantage of what is already there.
step "frontend packages" npm install --prefix "$ROOT/frontend" --no-audit --no-fund

# ── 3. The .NET SDK ─────────────────────────────────────────────────────────────────────────
# Under $HOME rather than system-wide: no root needed, and it lands in the part of the container
# that is snapshotted.
install_dotnet() {
	curl -sSL --retry 3 --max-time 180 https://dot.net/v1/dotnet-install.sh -o "$TMP/dotnet-install.sh"
	bash "$TMP/dotnet-install.sh" --channel "$DOTNET_CHANNEL" --install-dir "$DOTNET_DIR" --no-path
	rm -f "$TMP/dotnet-install.sh"
}
[ -x "$DOTNET_DIR/dotnet" ] || step ".NET SDK $DOTNET_CHANNEL" install_dotnet

export DOTNET_ROOT="$DOTNET_DIR"
export PATH="$DOTNET_DIR:$PATH"
export DOTNET_CLI_TELEMETRY_OPTOUT=1
export DOTNET_NOLOGO=1

# The session's own shells need all of this, or `dotnet` and `pwsh` are simply not commands there.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
	{
		echo "export DOTNET_ROOT=\"$DOTNET_DIR\""
		echo "export PATH=\"$DOTNET_DIR:$PWSH_DIR:\$PATH\""
		echo "export DOTNET_CLI_TELEMETRY_OPTOUT=1"
		echo "export DOTNET_NOLOGO=1"
	} >> "$CLAUDE_ENV_FILE"
fi

# ── 4-5. The E2E suite: its packages, and the browser it drives ─────────────────────────────
step "e2e packages" npm install --prefix "$ROOT/e2e" --no-audit --no-fund

# The image ships a Chromium build, but @playwright/test pins the revision it will launch and a
# newer package wants a newer one. Asking for it costs nothing when the pinned revision is already
# there, and the alternative — a suite that cannot start at all — is not one.
install_browser() { ( cd "$ROOT/e2e" && npx --yes playwright install chromium ); }
step "Playwright browser" install_browser

# ── 6. Warm the .NET build ──────────────────────────────────────────────────────────────────
# Restores the NuGet packages and compiles the server once. Never fatal: a warm-up is a
# convenience, and failing the whole start-up over one would throw away everything above.
echo "[session-start] warming the server build"
dotnet build "$ROOT/server/CorroServer.csproj" -p:SkipFrontendBuild=true --nologo >> "$LOG" 2>&1 \
	|| echo "[session-start] server warm-up skipped; it will build on first use (see $LOG)"

echo "[session-start] ready — dotnet $(dotnet --version), pwsh $PWSH_VERSION, node $(node --version)."
echo "[session-start] All four gates in AGENTS.md can be run; E2E from e2e/, never the repo root."
