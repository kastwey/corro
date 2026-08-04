import test from 'node:test';
import assert from 'node:assert/strict';
import {
	addressMessage,
	completeMention,
	findMentions,
	mentionAtCaret,
	resolveRecipients,
	HANDLE_SHAPE,
	TABLE_NAME_SHAPE,
} from '../src/mentions.js';

/**
 * Who a message is addressed to, read out of the message itself.
 *
 * These are the rules somebody would try without being told: an "@" in the middle of a sentence,
 * two names at once, and a bare "@" meaning "you again". Each of them is here because the
 * alternative — a recipient field beside the text — makes saying one sentence a trip between two
 * controls, which is exactly the cost this design refuses to charge a keyboard user.
 */

test('a mention is found anywhere in the line, not only at the start', () => {
	assert.deepEqual(addressMessage('@ana hola').recipients, ['ana']);
	assert.deepEqual(addressMessage('buenas @ana, ¿jugamos?').recipients, ['ana']);
	assert.deepEqual(addressMessage('¿te apuntas @ana?').recipients, ['ana']);
});

test('several people at once, in the order they were named, without repeats', () => {
	const addressed = addressMessage('@ana y @berto, y otra vez @ANA');
	assert.deepEqual(addressed.recipients, ['ana', 'berto']);
});

// An address is not a mention. Somebody writing out an email should not silently send a message.
test('an @ inside a word is part of that word', () => {
	assert.deepEqual(addressMessage('escríbeme a ana@example.com').recipients, []);
	assert.deepEqual(findMentions('ana@example.com'), []);
});

test('an @ that names nothing is just text', () => {
	assert.deepEqual(addressMessage('vale @, luego').recipients, []);
	// Public names start with a letter, exactly as the server requires.
	assert.deepEqual(addressMessage('@1ana hola').recipients, []);
});

// The names come out of the text: the panel already says who a message went to, and leaving them
// in would have a screen reader read every recipient twice.
test('what is said is what is left once the names are taken out', () => {
	assert.equal(addressMessage('@ana hola, ¿jugamos?').text, 'hola, ¿jugamos?');
	assert.equal(addressMessage('buenas @ana y @berto').text, 'buenas y');
	assert.equal(addressMessage('@ana').text, '');
});

// The reply that needs no name at all, and the one somebody will reach for most.
test('a bare @ followed by a space means whoever last wrote', () => {
	const addressed = addressMessage('@ claro que sí');
	assert.equal(addressed.repliesToLast, true);
	assert.deepEqual(addressed.recipients, []);
	assert.equal(addressed.text, 'claro que sí');

	assert.deepEqual(
		resolveRecipients(addressed, ['Ana', 'BERTO', 'ana']),
		['ana', 'berto']);
});

test('a bare @ only replies from the start, so a stray one mid-sentence is text', () => {
	const addressed = addressMessage('mira esto @ y ya');
	assert.equal(addressed.repliesToLast, false);
	assert.deepEqual(resolveRecipients(addressed, ['ana']), []);
});

test('an explicit name wins over the last conversation', () => {
	const addressed = addressMessage('@cora una cosa');
	assert.deepEqual(resolveRecipients(addressed, ['ana', 'berto']), ['cora']);
});

// In the lobby there is nowhere for an unaddressed message to go, so it must resolve to nobody and
// be refused with a reason rather than sent somewhere surprising.
test('a message that names nobody reaches nobody', () => {
	const addressed = addressMessage('hola a todos');
	assert.deepEqual(addressed.recipients, []);
	assert.equal(addressed.repliesToLast, false);
	assert.deepEqual(resolveRecipients(addressed, []), []);
	assert.deepEqual(resolveRecipients(addressed, ['ana']), []);
});

// ── what the autocomplete needs ───────────────────────────────────────────────────────────────

test('the name being typed at the caret is what the list offers against', () => {
	assert.equal(mentionAtCaret('hola @an', 8), 'an');
	// Empty right after the @: the list opens on the character itself.
	assert.equal(mentionAtCaret('hola @', 6), '');
	// Not in a mention at all.
	assert.equal(mentionAtCaret('hola', 4), null);
	// The mention ended before the caret.
	assert.equal(mentionAtCaret('@ana hola', 9), null);
	// Part of an address, not a mention.
	assert.equal(mentionAtCaret('ana@exa', 7), null);
});

test('the caret is read where it actually is, not at the end of the line', () => {
	// Caret inside "@an", with more text after it.
	assert.equal(mentionAtCaret('@an y luego', 3), 'an');
});

test('choosing a name replaces what was typed and leaves the caret ready for the next word', () => {
	const { text, caret } = completeMention('hola @an', 8, 'ana');
	assert.equal(text, 'hola @ana ');
	assert.equal(caret, text.length);

	// With text after the caret, only the mention is replaced.
	const mid = completeMention('@an y luego', 3, 'ana');
	assert.equal(mid.text, '@ana  y luego');
	assert.equal(mid.caret, '@ana '.length);
});

// ── one reader, two shapes of name ────────────────────────────────────────────────────────────
//
// The lobby and the in-game chat both read an "@" under the caret, and both used to do it with
// their own regex. The MECHANICS are the same job; what a name may look like is not, and that is
// the only part that should ever have differed:
//
//  * a public name is ASCII and starts with a letter, so no two can be made to look alike;
//  * a table name is whatever somebody typed to sit down, so "@José" has to work or the feature is
//    useless to half the people using it.

test('a table name may carry accents and other scripts; a public name may not', () => {
	assert.equal(mentionAtCaret('hola @Jos', 9, TABLE_NAME_SHAPE), 'Jos');
	assert.equal(mentionAtCaret('hola @José', 10, TABLE_NAME_SHAPE), 'José');
	assert.equal(mentionAtCaret('hola @Ана', 9, TABLE_NAME_SHAPE), 'Ана');
	// The same text read as a public name stops at the character that cannot be one.
	assert.equal(mentionAtCaret('hola @José', 10, HANDLE_SHAPE), null);
});

test('a table name may start with a digit or a dash; a public name starts with a letter', () => {
	assert.deepEqual(
		findMentions('@2fast y @-x', TABLE_NAME_SHAPE).map(m => m.handle),
		['2fast', '-x']);
	assert.deepEqual(findMentions('@2fast y @-x', HANDLE_SHAPE).map(m => m.handle), []);
});

test('an address is not a mention under either shape', () => {
	assert.equal(mentionAtCaret('jose@exa', 8, TABLE_NAME_SHAPE), null);
	assert.equal(mentionAtCaret('jose@exa', 8, HANDLE_SHAPE), null);
});

test('public names are what the lobby reads unless told otherwise', () => {
	// The default shape is the strict one, so a caller that forgets cannot accidentally accept a
	// name the server would refuse.
	assert.equal(mentionAtCaret('@José', 5), null);
	assert.equal(mentionAtCaret('@jose', 5), 'jose');
});

// Replacing the typed name is shape-independent: it is a text edit, not a judgement about names.
test('completing works the same whatever the name looks like', () => {
	assert.deepEqual(completeMention('hola @Jos', 9, 'José'), { text: 'hola @José ', caret: 11 });
});
