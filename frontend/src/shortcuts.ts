// shortcuts.ts — the one shape a keyboard shortcut takes when it travels to the help
// dialog. Pure types, no DOM and no i18n, so both the pure family layer and the DOM
// components (hand panel, card board shell, help dialog) can share it without a cycle.

/** One keyboard shortcut for the shortcuts help: a keymap-style spec ("shift+s",
 *  "ctrl+space") and the i18n key describing what it does in this game. */
export interface HelpShortcut {
	readonly keys: string;
	readonly descKey: string;
}

/**
 * How a shortcut is reached from inside a text box, where a bare letter types itself instead
 * of acting: press this FIRST, and the next keystroke is a command.
 *
 * One prefix rather than an alias per shortcut, deliberately. An alias per shortcut means a
 * second vocabulary to learn, a second chord to find for every key added from now on, and a
 * help table that has to claim something per row — which is how it came to claim things that
 * were not true. A prefix is one thing to learn, it covers every key in every family for free,
 * and the help has nothing to assert per row.
 *
 * Ctrl+Shift+Space specifically: the thumb is already on the bar, so it does not break typing
 * posture; Space is the one key that means the same on every keyboard layout, unlike any
 * letter; Chrome and Firefox both leave it alone; and neither NVDA (NVDA+Space) nor JAWS
 * (Insert+Space, its layered keystrokes) claims it.
 */
export const TYPING_COMMAND_PREFIX = 'ctrl+shift+space';

/**
 * Key combinations the BROWSER answers before the page ever sees them, or that mean something
 * inside a text box. None of them can be a shortcut here, however tempting the mnemonic:
 *
 *  - window and tab management (Chrome and Firefox both): new incognito/private window, reopen
 *    the closed tab, close the window, quit;
 *  - the developer tools (inspect, console, network monitor) and the bookmark manager;
 *  - Ctrl+Shift+U, which starts Unicode entry under IBus on Linux — inside a text field;
 *  - Ctrl+Shift+V and Ctrl+Shift+Z, which are paste-as-plain-text and redo, i.e. exactly the
 *    two things a player might really mean while writing an answer.
 *
 * Kept as a list with a test rather than as folklore in a comment, because the next person to
 * want a mnemonic letter will not remember any of this.
 */
export const BROWSER_RESERVED_CHORDS: readonly string[] = [
	'ctrl+shift+n', 'ctrl+shift+t', 'ctrl+shift+w', 'ctrl+shift+q',
	'ctrl+shift+c', 'ctrl+shift+i', 'ctrl+shift+j', 'ctrl+shift+k', 'ctrl+shift+e',
	'ctrl+shift+o', 'ctrl+shift+p', 'ctrl+shift+u', 'ctrl+shift+v', 'ctrl+shift+z',
	'ctrl+n', 'ctrl+t', 'ctrl+w', 'ctrl+q',
];
