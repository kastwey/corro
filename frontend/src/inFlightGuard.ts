// inFlightGuard.ts — Ignore a repeat activation while the answer to the previous one is still
// on its way to the server.
//
// Why this exists. A confirmation dialog closes BEFORE its answer goes out (see
// dialogManager), because holding a modal open across a round trip makes the rest of the page
// inert and strands the player behind it. The price of closing first is a window: focus is
// back on the control that ASKED while the command is still travelling, and the client's state
// still describes the world before it. A second activation in that window — Enter's key
// auto-repeat is enough — is decided against that stale state, so it asks the very same
// question again and sends the command twice. The player sees a question about something that
// is already gone, and the server sees a command it must reject.
//
// Keyed, not global: two different rows (delete THIS table, leave THAT one) must never block
// each other, or a legitimate second action is silently swallowed — which is its own
// accessibility failure, and the one this project keeps having to fix. Only a repeat of the
// command already in flight is ignored.
//
// The same shape the purchase guard already uses (`buyInFlightSquare` / `decideBuyConfirm`),
// extracted so the confirmations that need it read the same way instead of each growing a
// boolean.

export interface InFlightGuard {
	/** Whether a command for this key is still travelling — ask before ASKING again. */
	busy(key: string): boolean;
	/**
	 * Run `command` unless one for the same key is already in flight, and keep the key busy
	 * until it settles (success or failure alike — a failed command is finished travelling).
	 * Resolves when the command does, so a caller can hand it straight to a dialog's answer.
	 */
	run(key: string, command: () => Promise<void>): Promise<void>;
}

export function makeInFlightGuard(): InFlightGuard {
	const inFlight = new Set<string>();
	return {
		busy: (key) => inFlight.has(key),
		run: async (key, command) => {
			if (inFlight.has(key)) return;
			inFlight.add(key);
			try {
				await command();
			} finally {
				inFlight.delete(key);
			}
		},
	};
}
