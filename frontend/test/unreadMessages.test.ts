// unreadMessages.test.ts — the mark a message leaves when it lands somewhere you are not looking.
//
// Messages moved off the home page onto a screen of their own, so the ONLY thing telling somebody
// that one arrived while they were reading their tables is the name of the button. These are the
// two rules that name carries.

import test from 'node:test';
import assert from 'node:assert/strict';
import { messagesButtonLabel, unreadAfterArrival } from '../src/lobby/unreadMessages.js';

/** A stand-in for i18next: reports the key it was asked for and what it was given. */
const t = (key: string, vars?: Record<string, unknown>) =>
	vars ? `${key}:${JSON.stringify(vars)}` : key;

test('with nothing waiting the button is just its name', () => {
	assert.equal(messagesButtonLabel(0, t), 'lobby.home.messagesButton');
});

test('what is waiting is in the NAME, with the count, not in a badge', () => {
	assert.equal(messagesButtonLabel(1, t), 'lobby.home.messagesButtonUnread:{"count":1}');
	assert.equal(messagesButtonLabel(7, t), 'lobby.home.messagesButtonUnread:{"count":7}');
});

// Guards the sign rather than the number: a negative count is not a thing, and if one ever were
// it must read as "nothing waiting" rather than as "-1 unread".
test('a count that is not positive reads as nothing waiting', () => {
	assert.equal(messagesButtonLabel(-1, t), 'lobby.home.messagesButton');
});

test('a message arriving while you are elsewhere is added to what is waiting', () => {
	assert.equal(unreadAfterArrival(0, false), 1);
	assert.equal(unreadAfterArrival(4, false), 5);
});

// Reading the messages screen IS reading the message: one that lands while it is open leaves
// nothing behind, and clears anything the count had been holding.
test('a message arriving on the messages screen leaves nothing waiting', () => {
	assert.equal(unreadAfterArrival(0, true), 0);
	assert.equal(unreadAfterArrival(3, true), 0);
});
