// gameRulesDialog.ts — the "active rules" reading dialog (Ctrl+Shift+F1, or a family's own
// button). Generic: it renders whatever lines the active family hands it (a family with no
// summary simply doesn't open it). Content-only reading dialog, browseable with the screen
// reader's virtual cursor from the moment it opens (no role="application" inside).

import { dialogManager } from './dialogManager.js';
import { tSync } from './i18nBinder.js';

/** Open the active-rules dialog listing `lines` (already localized). */
export function showGameRulesDialog(lines: string[]): void {
	const list = document.createElement('ul');
	list.className = 'game-rules-list';
	for (const line of lines) {
		const li = document.createElement('li');
		li.textContent = line;
		list.appendChild(li);
	}
	dialogManager.show({
		title: tSync('game.game_rules_title'),
		contentElement: list,
		className: 'dialog-game-rules',
		documentMode: true,
		buttons: [{
			label: tSync('game.help_close'),
			variant: 'primary',
			action: () => dialogManager.close(),
		}],
	});
}
