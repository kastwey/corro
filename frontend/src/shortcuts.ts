// shortcuts.ts — the one shape a keyboard shortcut takes when it travels to the help
// dialog. Pure types, no DOM and no i18n, so both the pure family layer and the DOM
// components (hand panel, card board shell, help dialog) can share it without a cycle.

/** One keyboard shortcut for the shortcuts help: a keymap-style spec ("shift+s",
 *  "ctrl+space") and the i18n key describing what it does in this game. */
export interface HelpShortcut {
	readonly keys: string;
	readonly descKey: string;
}
