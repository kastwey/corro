import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { chatPanel } from '../src/chatPanel.js';
import type { ChatMessageDto, Player } from '../src/models.js';

/**
 * The in-game chat panel, as specified by its screen-reader-first design: Enter sends and
 * Shift+Enter breaks the line; the history is a roving <ul> glued to the end ONLY while
 * you are at the end; voicing goes through a persistent role="log" region in <body> (so
 * closed panels still speak); and the @mention autocomplete moves REAL focus into the
 * suggestion list, hands it back for ←/→ review, and completes with Enter or Tab.
 */

before(() => setupDom());

const sent: string[] = [];
let boardFocused = 0;

function players(): Player[] {
	return [
		{ id: 'me', name: 'Ana' },
		{ id: 'p2', name: 'Amaterasu' },
		{ id: 'p3', name: 'Berto' },
	] as unknown as Player[];
}

function msg(over: Partial<ChatMessageDto>): ChatMessageDto {
	return { id: 'x', playerId: 'p3', playerName: 'Berto', text: 'hola', sentAt: '', ...over };
}

function key(target: EventTarget, keyName: string, opts: Record<string, unknown> = {}): void {
	const w = (globalThis as any).window;
	target.dispatchEvent(new w.KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true, ...opts }));
}

beforeEach(() => {
	try { (globalThis as any).window.localStorage.removeItem('corro.chatDisclaimerDismissed'); } catch {}
	sent.length = 0;
	boardFocused = 0;
	document.getElementById('chat-panel')?.remove();
	document.getElementById('chat-log')?.remove();
	(chatPanel as any).dialog = null; // fresh element per test (the singleton caches it)
	chatPanel.init({
		t: (k: string) => k,
		getPlayers: players,
		getMyPlayerId: () => 'me',
		send: async text => { sent.push(text); },
		focusBoard: () => { boardFocused++; },
	});
	chatPanel.openPanel();
	// Most tests start AT the compose box: acknowledge the first-contact notice (session
	// only — the persistence key was cleared above). Banner-focused tests rebuild fresh.
	(document.getElementById('chat-disclaimer-dismiss') as HTMLButtonElement).click();
});

/** Rebuilds a pristine panel (as a fresh page would) WITHOUT acknowledging the banner. */
function rebuildFresh(): void {
	document.getElementById('chat-panel')?.remove();
	document.getElementById('chat-log')?.remove();
	(chatPanel as any).dialog = null;
	chatPanel.init({
		t: (k: string) => k,
		getPlayers: players,
		getMyPlayerId: () => 'me',
		send: async text => { sent.push(text); },
		focusBoard: () => { boardFocused++; },
	});
	chatPanel.openPanel();
}

const input = () => document.getElementById('chat-input') as HTMLTextAreaElement;
const list = () => document.getElementById('chat-messages') as HTMLUListElement;
const mentions = () => document.getElementById('chat-mention-list') as HTMLUListElement;
const log = () => document.getElementById('chat-log') as HTMLElement;

function typeMention(text: string): void {
	const el = input();
	el.value = text;
	el.setSelectionRange(text.length, text.length);
	el.dispatchEvent(new (globalThis as any).window.Event('input', { bubbles: true }));
}

test('opening focuses the compose box; Enter sends and clears; Shift+Enter does not send', () => {
	assert.equal(document.activeElement, input(), 'the panel opens ready to type');
	input().value = 'hola a todos';
	key(input(), 'Enter');
	assert.deepEqual(sent, ['hola a todos']);
	assert.equal(input().value, '');

	input().value = 'línea';
	key(input(), 'Enter', { shiftKey: true });
	assert.deepEqual(sent, ['hola a todos'], 'Shift+Enter is a line break, not a send');
});

test('focusInput with the panel CLOSED opens it (Ctrl+Shift+R needs no Ctrl+Shift+H first)', () => {
	chatPanel.closePanel();
	assert.equal(chatPanel.isOpen(), false);
	assert.equal(chatPanel.focusInput(), true, 'the shortcut is consumed');
	assert.equal(chatPanel.isOpen(), true, 'the panel opened itself');
	assert.equal(document.activeElement, input(), 'ready to type in one keystroke');
});

test('messages land in the list AND the persistent role="log" region', () => {
	chatPanel.addMessage(msg({ playerName: 'Berto', text: 'buenas' }));
	assert.equal(list().children.length, 1);
	assert.equal(list().querySelector('li')!.textContent, 'Berto: buenas');
	assert.equal(log().getAttribute('role'), 'log');
	assert.match(log().textContent!, /Berto: buenas/);
});

test('end-glue: the roving item follows new messages only while parked at the end', () => {
	for (let i = 0; i < 3; i++) chatPanel.addMessage(msg({ text: `m${i}` }));
	const items = () => list().querySelectorAll<HTMLElement>('li');
	assert.equal(items()[2].tabIndex, 0, 'starts glued to the last message');

	// Walk back to the middle: a reader reviewing history must not be yanked away.
	items()[2].focus();
	key(items()[2], 'ArrowUp');
	assert.equal(document.activeElement, items()[1]);
	chatPanel.addMessage(msg({ text: 'm3' }));
	assert.equal(document.activeElement, items()[1], 'focus stays parked mid-history');
	assert.equal(items()[1].tabIndex, 0, 'the roving stop stays where the reader is');

	// Back to the end: the glue re-engages.
	key(items()[1], 'End');
	assert.equal(document.activeElement, items()[3]);
	chatPanel.addMessage(msg({ text: 'm4' }));
	assert.equal(document.activeElement, items()[4], 'at the end, new messages keep you at the end');
});

test('@ opens the mention list with REAL focus; typing keeps filtering from the list', () => {
	typeMention('@a');
	const options = () => mentions().querySelectorAll<HTMLElement>('li');
	// Players offered: everyone but me → Amaterasu + Berto; "@a" filters to Amaterasu.
	assert.equal(options().length, 1);
	assert.equal(options()[0].textContent, 'Amaterasu');
	assert.equal(document.activeElement, options()[0], 'focus moves INTO the list');

	// Typing while focus is on the list inserts into the textarea and refilters.
	key(options()[0], 'm');
	assert.equal(input().value, '@am');
	assert.equal(document.activeElement, mentions().querySelector('li'), 'focus stays on the list');
});

test('←/→ hand focus back to the textarea; ↑/↓ from it return to the list; Enter completes', () => {
	typeMention('@ama');
	const option = mentions().querySelector<HTMLElement>('li')!;
	assert.equal(document.activeElement, option);

	key(option, 'ArrowLeft');
	assert.equal(document.activeElement, input(), '← goes back to review the text letter by letter');
	assert.ok(!mentions().classList.contains('hidden'), 'the list stays open');

	key(input(), 'ArrowDown');
	assert.equal(document.activeElement, mentions().querySelector('li'), '↓ re-enters the list');

	key(mentions().querySelector('li')!, 'Enter');
	assert.equal(input().value, '@Amaterasu ');
	assert.equal(document.activeElement, input(), 'completion returns to the compose box');
	assert.ok(mentions().classList.contains('hidden'));
});

test('Tab also completes the mention; Escape closes the list without completing', () => {
	typeMention('@be');
	key(mentions().querySelector('li')!, 'Tab');
	assert.equal(input().value, '@Berto ');

	typeMention('@Berto @a');
	key(mentions().querySelector('li')!, 'Escape');
	assert.equal(input().value, '@Berto @a', 'Escape keeps the raw text');
	assert.ok(mentions().classList.contains('hidden'));
	assert.equal(document.activeElement, input());
});

test('Escape from the compose box (no mention list) parks the player on the board', () => {
	key(input(), 'Escape');
	assert.equal(boardFocused, 1);
});


test('first contact: opening focuses the NOTICE; dismissing hands focus to the compose box', () => {
	rebuildFresh();
	const dialog = document.getElementById('chat-panel')!;
	assert.equal(dialog.getAttribute('aria-describedby'), null, 'a description would be announced on EVERY entry');
	const banner = document.getElementById('chat-panel-disclaimer') as HTMLElement;
	assert.equal(banner.hidden, false, 'first visit: the banner shows');
	assert.equal(document.activeElement, document.getElementById('chat-disclaimer-text'),
		'the player LANDS on the warning, so they cannot miss it');

	(document.getElementById('chat-disclaimer-dismiss') as HTMLButtonElement).click();
	assert.equal(banner.hidden, true, 'dismiss hides it for the session');
	assert.equal(document.activeElement, input(), 'and returns focus to the compose box');

	chatPanel.closePanel();
	chatPanel.openPanel();
	assert.equal(document.activeElement, input(), 'acknowledged: reopening goes straight to typing');
});

test(`"don't show again" persists: the next panel never shows the banner`, () => {
	(document.getElementById('chat-disclaimer-dontshow') as HTMLInputElement).checked = true;
	(document.getElementById('chat-disclaimer-dismiss') as HTMLButtonElement).click();

	// Simulate a fresh page: rebuild the panel from scratch.
	rebuildFresh();
	const banner = document.getElementById('chat-panel-disclaimer') as HTMLElement;
	assert.equal(banner.hidden, true, 'the persisted choice survives a reload');
});


test('application-mode semantics live on a named inner surface, not the native dialog', () => {
	const dialog = document.getElementById('chat-panel')!;
	assert.equal(dialog.getAttribute('role'), null, 'the native dialog keeps valid implicit semantics');
	const application = dialog.querySelector('.chat-application')!;
	assert.equal(application.getAttribute('role'), 'application', 'NVDA focus mode / JAWS PC cursor inside');
	assert.equal(application.getAttribute('aria-labelledby'), 'chat-panel-title');
	assert.equal(list().getAttribute('role'), 'list');
	chatPanel.addMessage(msg({ text: 'hola' }));
	assert.equal(list().querySelector('li')!.getAttribute('role'), 'listitem');
	// In application mode non-focusable text is unreachable: the notice is a tab stop.
	assert.equal((document.getElementById('chat-disclaimer-text') as HTMLElement).tabIndex, 0);
});
