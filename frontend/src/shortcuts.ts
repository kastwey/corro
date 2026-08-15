// shortcuts.ts — the one shape a keyboard shortcut takes when it travels to the help
// dialog. Pure types, no DOM and no i18n, so both the pure family layer and the DOM
// components (hand panel, card board shell, help dialog) can share it without a cycle.

/** One keyboard shortcut for the shortcuts help: a keymap-style spec ("shift+s",
 *  "ctrl+space") and the i18n key describing what it does in this game. */
export interface HelpShortcut {
	readonly keys: string;
	readonly descKey: string;
	/**
	 * The chord that does the same thing while the player is typing in a text box, where a bare
	 * letter would type itself instead of acting. Absent when `keys` already survives a text box
	 * (a chord, Escape, Enter, an arrow), which is most of them.
	 */
	readonly typingKeys?: string;
}

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
