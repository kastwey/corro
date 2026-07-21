// cardBoardShell.ts — the scaffolding EVERY card family's board shares (journey, assembly,
// draft, shedding): resetting #board from the property grid to a card surface, and wiring
// the S / Shift+S status keys (the shared convention — S speaks my own status, Shift+S
// surveys the rivals only). Pure DOM/wiring — no family rules, no i18n of its own. Lives
// once so the convention is fix-once across the families; each board keeps its own visual
// region and its own status text.

import type { GameState } from './models.js';
import type { HelpShortcut } from './shortcuts.js';
import type { HandPanel } from './handPanel.js';

/** S / Shift+S — the card families' shared status keys (registerStatusKeys below). Declared
 *  right beside the routing so the shortcuts help can never drift from it; the wording is
 *  the same for every card family (each family's status LINE differs, the key's job doesn't). */
export const CARD_STATUS_SHORTCUTS: readonly HelpShortcut[] = [
	{ keys: 's', descKey: 'game.help_cmd_status_mine' },
	{ keys: 'shift+s', descKey: 'game.help_cmd_status_rivals' },
];

/** A card board's full shortcut list for the help dialog: its hand keys (in the family's
 *  words) followed by the shared status keys. One place so every family reads the same. */
export function cardBoardHelpShortcuts(hand: HandPanel): HelpShortcut[] {
	return [...hand.activeShortcuts(), ...CARD_STATUS_SHORTCUTS];
}

/**
 * Reset #board from the property grid to a card surface: app.ts sizes #board INLINE for
 * the property grid (display:grid + square columns), and inline beats any stylesheet — so
 * without clearing it the card layout collapses. Also drop the board's aria-label: these
 * families have no board, the hand LIST names itself, and a container label would read
 * twice (and the i18n binding goes too, or a language switch restores the board wording).
 */
export function resetCardBoard(element: HTMLElement, modeClass: string): void {
	element.classList.add(modeClass);
	element.style.removeProperty('display');
	element.style.removeProperty('grid-template-columns');
	element.style.removeProperty('grid-auto-rows');
	element.removeAttribute('aria-label');
	element.removeAttribute('data-i18n-attr:aria-label');
	element.innerHTML = '';
}

export interface StatusKeysDeps {
	getGameState(): GameState | null;
	getMyPlayerId(): string | null;
	announce(text: string): void;
	/** "How am I doing?" (S) — my own status line. */
	mine(gs: GameState, myId: string): string | null;
	/** "How are the OTHERS doing?" (Shift+S) — my own is left out (S already covers it). */
	rivals(gs: GameState, myId: string): string | null;
}

/**
 * Wire the S / Shift+S status keys on a card surface. The convention is shared by every
 * card family (live-play request: "Shift+S reads only the others; S already tells me my status"),
 * so it lives here once — a change to the keys or the gating is fix-once.
 */
export function registerStatusKeys(element: HTMLElement, deps: StatusKeysDeps): void {
	element.addEventListener('keydown', (e) => {
		if (e.key !== 's' && e.key !== 'S') return;
		if (e.ctrlKey || e.altKey || e.metaKey) return;
		const gs = deps.getGameState();
		const myId = deps.getMyPlayerId();
		if (!gs || !myId) return;
		const status = e.shiftKey ? deps.rivals(gs, myId) : deps.mine(gs, myId);
		if (!status) return;
		e.preventDefault();
		e.stopPropagation();
		deps.announce(status);
	});
}

/** A player's display name (falls back to the id). */
export function playerName(gs: GameState, playerId: string): string {
	return gs.players.find(p => p.id === playerId)?.name ?? playerId;
}
