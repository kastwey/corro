// mentions.ts — who a message is addressed to, read out of the message itself.
//
// In the lobby there is no room to shout into: a message goes to the people it names. Naming them
// with "@" rather than a recipient field means one place to type, one place to read back, and no
// mode to be in — which matters most to somebody driving this from a keyboard, who would otherwise
// be moving between a list and a field to say one sentence.
//
// Three rules, all of them from what a person would try:
//
//  * "@" anywhere, not only at the start. "Buenas @ana, ¿jugamos?" is how people write.
//  * Several at once. Everybody named gets it, and the reply reaches the same group.
//  * "@" alone, followed by a space, means "whoever last wrote to me" — the reply that needs no
//    name at all, and the one somebody will reach for most.
//
// Pure: no DOM, no network. What the panel does with the result is its own business.

/**
 * What a name may look like, so the two places that read "@" can share the mechanics without
 * sharing the shape of a name.
 *
 * They genuinely differ. In the lobby a mention is a PUBLIC NAME, which the server restricts to
 * ASCII so that no two of them can look alike. At a table it is the name somebody typed when they
 * sat down — free text, accents and all — and "@José" has to work there or the feature is useless
 * to half the people using it.
 */
export interface NameShape {
	/** Characters that may appear inside a name, as a single-character test. */
	readonly char: RegExp;
	/** The whole name, once read. */
	readonly whole: RegExp;
}

/** Public names: ASCII, starting with a letter, exactly as PlayerHandle allows on the server. */
export const HANDLE_SHAPE: NameShape = {
	char: /[A-Za-z0-9_]/,
	whole: /^[a-zA-Z][a-zA-Z0-9_]*$/,
};

/** Table names: whatever somebody typed to sit down, so letters of any script. */
export const TABLE_NAME_SHAPE: NameShape = {
	char: /[\p{L}\p{N}_-]/u,
	whole: /^[\p{L}\p{N}_-]+$/u,
};

/** A mention, and where it sits in the text so a caller can replace it. */
export interface Mention {
	/** As typed, without the "@". */
	readonly handle: string;
	readonly start: number;
	/** One past the last character of the mention. */
	readonly end: number;
}

export interface AddressedMessage {
	/** Public names, in the order they appear, lower-cased and de-duplicated. */
	readonly recipients: string[];
	/** What is left once the mentions are taken out. May be empty. */
	readonly text: string;
	/** True when the message opened with a bare "@ ": address it to whoever last wrote. */
	readonly repliesToLast: boolean;
}

/**
 * Every "@name" in the text. A mention must start at a word boundary so an email address does not
 * become one, and the name itself has to be a name the server could hold.
 */
export function findMentions(text: string, shape: NameShape = HANDLE_SHAPE): Mention[] {
	const found: Mention[] = [];
	for (let i = 0; i < text.length; i++) {
		if (text[i] !== '@') continue;
		// Preceded by a name character means it is part of something else — an address, usually.
		if (i > 0 && shape.char.test(text[i - 1])) continue;

		let end = i + 1;
		while (end < text.length && shape.char.test(text[end])) end++;
		const handle = text.slice(i + 1, end);
		if (handle.length === 0 || !shape.whole.test(handle)) continue;

		found.push({ handle, start: i, end });
		i = end - 1;
	}
	return found;
}

/**
 * Reads a typed line into who it goes to and what it says.
 *
 * A bare "@" followed by whitespace is the reply form: it names nobody, and the caller supplies the
 * people who last wrote. It only counts at the START, so an "@" left dangling mid-sentence is text
 * rather than a silent change of audience.
 */
export function addressMessage(raw: string): AddressedMessage {
	const trimmed = raw.trim();
	const repliesToLast = /^@(\s|$)/.test(trimmed);
	const body = repliesToLast ? trimmed.slice(1) : trimmed;

	const mentions = findMentions(body);
	const seen = new Set<string>();
	const recipients: string[] = [];
	for (const mention of mentions) {
		const handle = mention.handle.toLowerCase();
		if (seen.has(handle)) continue;
		seen.add(handle);
		recipients.push(handle);
	}

	// The names come out of the text: the panel already says who a message went to, and leaving
	// them in would have a screen reader read every recipient twice.
	let text = body;
	for (let i = mentions.length - 1; i >= 0; i--) {
		text = text.slice(0, mentions[i].start) + text.slice(mentions[i].end);
	}

	return { recipients, text: tidy(text), repliesToLast };
}

/**
 * Close the gap a removed mention leaves behind. "buenas @ana y @berto, ¿jugamos?" would otherwise
 * become "buenas y , ¿jugamos?" — which a screen reader reads with a pause in the wrong place, and
 * which looks like a typo the sender made.
 */
function tidy(text: string): string {
	return text
		.replace(/\s+/g, ' ')
		// A space stranded before punctuation by a name that used to be there.
		.replace(/\s+([,.;:!?)\]}»])/g, '$1')
		.replace(/([(\[{«¿¡])\s+/g, '$1')
		.trim();
}

/**
 * The name being typed at the caret, for the autocomplete to offer against — or null when the caret
 * is not inside one. Empty after a bare "@", which is what makes the list open on the character.
 */
export function mentionAtCaret(
	text: string, caret: number, shape: NameShape = HANDLE_SHAPE,
): string | null {
	const before = text.slice(0, caret);
	const at = before.lastIndexOf('@');
	if (at < 0) return null;
	if (at > 0 && shape.char.test(before[at - 1])) return null;

	const typed = before.slice(at + 1);
	// Anything that cannot be part of a name means the mention ended before the caret. An empty
	// one counts: that is what opens the list on the "@" itself.
	return typed.length === 0 || shape.whole.test(typed) ? typed : null;
}

/** Replace the mention the caret sits in with a chosen name, and say where the caret goes next. */
export function completeMention(
	text: string, caret: number, handle: string,
): { text: string; caret: number } {
	const before = text.slice(0, caret);
	const at = before.lastIndexOf('@');
	if (at < 0) return { text, caret };

	// A trailing space so the next word is not glued to the name just chosen.
	const replacement = `@${handle} `;
	const next = text.slice(0, at) + replacement + text.slice(caret);
	return { text: next, caret: at + replacement.length };
}

/**
 * Who a message goes to, once a bare "@" has been resolved against the last conversation. Returns
 * an empty list when there is nobody — which the caller reports rather than sending to the room,
 * because in the lobby there is no room to send to.
 */
export function resolveRecipients(
	addressed: AddressedMessage, lastConversation: readonly string[],
): string[] {
	if (addressed.recipients.length > 0) return addressed.recipients;
	if (!addressed.repliesToLast) return [];
	const seen = new Set<string>();
	return lastConversation
		.map(handle => handle.toLowerCase())
		.filter(handle => handle.length > 0 && !seen.has(handle) && seen.add(handle));
}
