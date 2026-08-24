// commandPrefix.ts — reaching a shortcut from inside a text box.
//
// Corro's shortcuts are bare letters, which is what a screen-reader player wants everywhere
// EXCEPT inside a text box: there the letter types itself. The answer is a prefix — press
// Ctrl+Shift+Space, and the next keystroke is a command rather than a character.
//
// It works by REPLAYING that keystroke on the game surface, which is not a text box. So every
// existing handler — the global key layer, the family's own surface keys, the shared card
// status keys — answers it exactly as it would if the player had never been typing. There is
// no second table of what a key means while typing, and therefore nothing that can drift out
// of step with what the keys actually do.
//
// The mode lasts EXACTLY one keystroke. Nothing expires by time: a timer would make the
// mechanism unpredictable for the players who take longest to choose a key, and with a
// one-shot prefix there is nothing left to expire.

import { isTypingTarget } from './typingTarget.js';
import { normalizeKeyName, owningModalDialog } from './keys.js';
import { humanizeKey } from './keyLabels.js';

/** What just happened to the prefix, for the non-speech cue: rising, then falling. */
export type CommandPrefixCue = 'armed' | 'released';

export interface CommandPrefixDeps {
	/** The game surface an armed keystroke is replayed on. Never a text box. */
	surface: () => HTMLElement | null;
	/** Speaks the mode change. The cue is instant but inaudible on mute or a braille display. */
	announce: (text: string) => void;
	t: (key: string, vars?: Record<string, unknown>) => string;
	/** Non-speech confirmation: it lands at once, where speech queues behind the live region. */
	cue: (kind: CommandPrefixCue) => void;
}

/**
 * Keys that are only a modifier being pressed on its own. An armed prefix must survive them:
 * a player heading for Shift+S presses Shift first, and that must not spend the prefix.
 */
const STANDALONE_MODIFIERS = new Set([
	'Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock',
	'Dead', 'Process', 'Unidentified',
]);

export function isStandaloneModifier(key: string): boolean {
	return STANDALONE_MODIFIERS.has(key);
}

/** Whether an event is the prefix itself. Space reports as " "; older engines say "Spacebar". */
export function matchesCommandPrefix(event: Pick<KeyboardEvent,
	'key' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>): boolean {
	return event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey
		&& (event.key === ' ' || event.key === 'Spacebar');
}

/**
 * The spoken name of a key that turned out not to be a shortcut ("S", "Space", "Arrow up").
 * Borrowed from the labels the shortcuts table already uses, so the answer a player hears
 * names the key the same way the help they read does.
 */
export function spokenKeyName(key: string): string {
	return humanizeKey(normalizeKeyName(key));
}

/**
 * Wires the prefix. Returns a detach function.
 *
 * The listener captures, so it sees a keystroke before the global key layer and before the
 * family surfaces, and can take the keystroke away from the text box before anything types it.
 */
export function attachCommandPrefix(deps: CommandPrefixDeps): () => void {
	/** The field the prefix was armed from, or null when it is not armed. */
	let armedIn: HTMLElement | null = null;

	function release(kind: 'used' | 'cancelled'): void {
		if (!armedIn) return;
		armedIn = null;
		deps.cue('released');
		if (kind === 'cancelled') deps.announce(deps.t('game.typing_command_cancelled'));
	}

	/**
	 * Replays the keystroke on the surface. Returns whether anything acted on it: every
	 * handler in the app consumes the events it answers, so `defaultPrevented` IS the answer
	 * to "was that a shortcut?".
	 */
	function replay(event: KeyboardEvent): boolean {
		const surface = deps.surface();
		if (!surface) return false;
		const replayed = new KeyboardEvent('keydown', {
			key: event.key,
			code: event.code,
			ctrlKey: event.ctrlKey,
			shiftKey: event.shiftKey,
			altKey: event.altKey,
			metaKey: event.metaKey,
			bubbles: true,
			cancelable: true,
		});
		surface.dispatchEvent(replayed);
		return replayed.defaultPrevented;
	}

	function onKeydown(event: KeyboardEvent): void {
		// Mid-composition (a dead key on the way to "á", an IME picking a candidate) the
		// keystroke belongs to the text being written, never to us.
		if (event.isComposing) return;

		if (armedIn) {
			// Reaching for a modifier is not the command yet.
			if (isStandaloneModifier(event.key)) return;
			// Whatever this key is, it never reaches the field: the point of the prefix is
			// that it does not type.
			event.preventDefault();
			event.stopPropagation();
			if (event.key === 'Escape' || matchesCommandPrefix(event)) {
				release('cancelled');
				return;
			}
			release('used');
			if (!replay(event)) {
				deps.announce(deps.t('game.typing_command_unknown', {
					key: spokenKeyName(event.key),
				}));
			}
			return;
		}

		if (!matchesCommandPrefix(event)) return;
		// Outside a text box every shortcut already works, so there is nothing to arm — and
		// arming there would let a bare board key act from a panel that deliberately ignores it.
		if (!isTypingTarget(event.target)) return;
		// A modal dialog answers only its own read-only queries (see the global key layer). The
		// prefix must not become a way around that, so it does not arm inside one.
		if (owningModalDialog(event.target)) return;
		event.preventDefault();
		event.stopPropagation();
		armedIn = event.target as HTMLElement;
		deps.cue('armed');
		deps.announce(deps.t('game.typing_command_armed'));
	}

	/** Leaving the field ends the mode: the prefix belongs to the box it was armed from. */
	function onFocusOut(event: FocusEvent): void {
		if (armedIn && event.target === armedIn) release('cancelled');
	}

	document.addEventListener('keydown', onKeydown, true);
	document.addEventListener('focusout', onFocusOut, true);

	return () => {
		document.removeEventListener('keydown', onKeydown, true);
		document.removeEventListener('focusout', onFocusOut, true);
	};
}
