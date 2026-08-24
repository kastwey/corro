// keyLabels.ts — how a key spec is SAID.
//
// One place, because the same key is now named in two: the shortcuts table writes it, and the
// command prefix speaks it when a keystroke turns out not to be a shortcut. Two spellings of
// "Ctrl + Shift + Space" would be one more thing that can drift.

import { tSync } from './i18nBinder.js';

/** Turns one part of a key spec ("ctrl", "arrowleft", "l") into a readable label. */
function humanizeKeyPart(part: string): string {
	switch (part) {
		case 'ctrl': return tSync('game.key_ctrl');
		case 'shift': return tSync('game.key_shift');
		case 'alt': return tSync('game.key_alt');
		case 'meta': return tSync('game.key_meta');
		case 'enter': return tSync('game.key_enter');
		case 'space': return tSync('game.key_space');
		case 'delete': return tSync('game.key_delete');
		case 'home': return tSync('game.key_home');
		case 'arrowup': return tSync('game.key_arrowup');
		case 'arrowdown': return tSync('game.key_arrowdown');
		case 'arrowleft': return tSync('game.key_arrowleft');
		case 'arrowright': return tSync('game.key_arrowright');
		case 'end': return tSync('game.key_end');
		default:
			if (/^f\d+$/.test(part)) return part.toUpperCase(); // F1, F2...
			return part.length === 1 ? part.toUpperCase() : part;
	}
}

/** Turns a key spec like "ctrl+p" or "ctrl+shift+space" into a readable label. */
export function humanizeKey(spec: string): string {
	return spec.split('+').map(humanizeKeyPart).join(' + ');
}
