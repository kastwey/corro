// Whether a keyboard event is happening inside something a person is TYPING in. Single-letter
// shortcuts must never steal a keystroke from a text field — the categories sheet is written
// with the same letters the board uses as commands — so every surface that binds bare letters
// asks this one question, in one place, the same way.

/** The element a key event is aimed at, when it is an element at all. */
function elementOf(target: EventTarget | null): HTMLElement | null {
	return target instanceof HTMLElement ? target : null;
}

/**
 * True when the target accepts free text: a text input, a textarea or a contenteditable host.
 *
 * Two kinds of field are deliberately excluded, because in neither of them could the keystroke
 * have become a character anyway:
 *  - a NUMBER or RANGE input, which ignores letters (the same distinction the global key layer
 *    already draws for dialogs);
 *  - a READ-ONLY field. The forbidden family's private card is a real, selectable, screen-reader
 *    navigable textarea that refuses every mutation, and its surface's reading keys have to keep
 *    working from inside it.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
	const element = elementOf(target);
	if (!element) return false;
	if (element.getAttribute('aria-readonly') === 'true') return false;
	if (element.isContentEditable) return true;
	if (element.tagName === 'TEXTAREA') return !(element as HTMLTextAreaElement).readOnly;
	if (element.tagName !== 'INPUT') return false;
	const input = element as HTMLInputElement;
	return !input.readOnly && input.type !== 'number' && input.type !== 'range';
}
