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
 * Key combinations that are NOT ours to bind — because the browser answers them before the page
 * is ever asked, because they mean something inside a text box, or because the keyboard layout
 * itself gets there first. However tempting the mnemonic:
 *
 *  - window and tab management (Chrome and Firefox both): new incognito/private window, reopen
 *    the closed tab, close the window, quit;
 *  - the developer tools (inspect, console, network monitor) and the bookmark manager;
 *  - the reload: Ctrl+Shift+R is a hard reload in BOTH browsers, which is as far from a page
 *    shortcut as a key can get — it throws the page away;
 *  - what each browser keeps for its own chrome: Ctrl+Shift+A (Firefox's add-ons manager,
 *    Chrome's tab search), Ctrl+Shift+B (the bookmarks toolbar), Ctrl+Shift+D (bookmark every
 *    tab in Chrome, responsive design mode in Firefox), Ctrl+Shift+M (Chrome's profile menu,
 *    Firefox's responsive design mode), Ctrl+Shift+H (Firefox's library);
 *  - Ctrl+Shift+U, which starts Unicode entry under IBus on Linux — inside a text field;
 *  - Ctrl+Shift+V and Ctrl+Shift+Z, which are paste-as-plain-text and redo, i.e. exactly the
 *    two things a player might really mean while writing an answer;
 *  - and every Ctrl+Alt chord. On Windows the layout turns Ctrl+Alt into AltGr, so Ctrl+Alt+Q
 *    is how a Latin American keyboard types "@" and Ctrl+Alt+E is how a Spanish one types "€";
 *    on macOS Ctrl+Option is the VoiceOver modifier, i.e. the whole vocabulary of the screen
 *    reader this game is built for.
 *
 * Kept as a list with a test rather than as folklore in a comment, because the next person to
 * want a mnemonic letter will not remember any of this. Some shipped bindings are already on it
 * and are recorded as such by that test: the guard has to keep meaning what it says, and moving
 * a published shortcut is a decision for the game that published it.
 */
export const BROWSER_RESERVED_CHORDS: readonly string[] = [
	'ctrl+shift+n', 'ctrl+shift+t', 'ctrl+shift+w', 'ctrl+shift+q',
	'ctrl+shift+c', 'ctrl+shift+i', 'ctrl+shift+j', 'ctrl+shift+k', 'ctrl+shift+e',
	'ctrl+shift+o', 'ctrl+shift+p', 'ctrl+shift+u', 'ctrl+shift+v', 'ctrl+shift+z',
	'ctrl+shift+r', 'ctrl+shift+a', 'ctrl+shift+b', 'ctrl+shift+d', 'ctrl+shift+m',
	'ctrl+shift+h',
	'ctrl+n', 'ctrl+t', 'ctrl+w', 'ctrl+q', 'ctrl+r',
	'ctrl+alt+a', 'ctrl+alt+b', 'ctrl+alt+c', 'ctrl+alt+d', 'ctrl+alt+e', 'ctrl+alt+f',
	'ctrl+alt+g', 'ctrl+alt+h', 'ctrl+alt+i', 'ctrl+alt+j', 'ctrl+alt+k', 'ctrl+alt+l',
	'ctrl+alt+m', 'ctrl+alt+n', 'ctrl+alt+o', 'ctrl+alt+p', 'ctrl+alt+q', 'ctrl+alt+r',
	'ctrl+alt+s', 'ctrl+alt+t', 'ctrl+alt+u', 'ctrl+alt+v', 'ctrl+alt+w', 'ctrl+alt+x',
	'ctrl+alt+y', 'ctrl+alt+z',
];
