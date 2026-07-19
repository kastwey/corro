import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { HandPanel, type HandCard } from '../src/handPanel.js';

/**
 * The hand's MULTI-SELECT mode (agreed design): one shared state with two projections —
 * keyboard (Ctrl+Space toggles, Space marks, Enter sends) and mouse (a tools toggle,
 * row clicks, Ctrl+click entering the mode with that card marked). The player's manual
 * choice sticks for the whole game; a rules-forced episode overrides it with its own
 * sound and announcement and hands the previous mode back when it clears. Marked cards
 * travel in MARKING ORDER (families may care: draft resolves the first card first).
 */

before(() => setupDom());

let panel: HandPanel;
let cards: HandCard[];
let played: string[];
let drawn: number;
let submitted: string[][];
let validateResult: { ok: true } | { ok: false; reason: string };
let requiredCount: number | null;
let announced: string[];
let sounds: string[];

function card(id: string): HandCard {
	return { id, label: id.toUpperCase(), typeKey: 't', value: 0, playable: true };
}

function key(target: EventTarget, keyName: string, opts: Record<string, unknown> = {}): void {
	const w = (globalThis as any).window;
	target.dispatchEvent(new w.KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true, ...opts }));
}

function click(target: HTMLElement, opts: Record<string, unknown> = {}): void {
	const w = (globalThis as any).window;
	target.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, ...opts }));
}

function rows(): HTMLElement[] {
	return Array.from(document.querySelectorAll<HTMLElement>('.hand-card'));
}

function tool(action: string): HTMLElement | null {
	return document.querySelector<HTMLElement>(`.hand-panel__list-actions [data-focus-id="${action}"]`);
}

beforeEach(() => {
	try { (globalThis as any).window.localStorage.removeItem('corro.handPreferences'); } catch {}
	document.body.innerHTML = '<div id="mount"></div>';
	cards = [card('a'), card('b'), card('c')];
	played = []; submitted = []; announced = []; sounds = []; drawn = 0;
	validateResult = { ok: true };
	requiredCount = null;
	panel = new HandPanel();
	panel.init(document.getElementById('mount')!, {
		getCards: () => cards,
		canDraw: () => ({ ok: true }),
		onDraw: () => { drawn++; },
		onPlay: c => { played.push(c.id); },
		multiSelect: {
			validate: () => validateResult,
			submit: set => { submitted.push(set.map(c => c.id)); },
			requiredCount: () => requiredCount,
		},
		playSound: event => { sounds.push(event); },
		announce: text => { announced.push(text); },
		t: (k, vars) => vars ? `${k}:${JSON.stringify(vars)}` : k,
	});
});

test('Ctrl+Space enters multi-select: sound, announcement, checkboxes and the Send tool appear', () => {
	assert.equal(tool('multi-toggle')!.getAttribute('aria-pressed'), 'false');
	assert.equal(tool('multi-send'), null); // no Send while single
	assert.equal(rows()[0].querySelector('.hand-card__check')!.textContent, '');

	rows()[0].focus();
	key(rows()[0], ' ', { ctrlKey: true });

	assert.deepEqual(sounds, ['hand.mode.multi']);
	assert.ok(announced.includes('game.hand_multi_on'));
	assert.equal(tool('multi-toggle')!.getAttribute('aria-pressed'), 'true');
	assert.ok(tool('multi-send'));
	assert.equal(rows()[0].querySelector('.hand-card__check')!.textContent, '☐');

	// And back: the single-mode sound, the off announcement, the checkboxes gone.
	key(rows()[0], ' ', { ctrlKey: true });
	assert.deepEqual(sounds, ['hand.mode.multi', 'hand.mode.single']);
	assert.ok(announced.includes('game.hand_multi_off'));
	assert.equal(rows()[0].querySelector('.hand-card__check')!.textContent, '');
});

test('in multi mode Space MARKS (never draws) and speaks the running count', () => {
	key(rows()[0], ' ', { ctrlKey: true });
	rows()[0].focus();

	key(rows()[0], ' ');
	assert.equal(drawn, 0); // Space stopped drawing the moment the mode flipped
	assert.ok(announced.includes('game.hand_multi_marked:{"card":"A","count":1}'));
	assert.equal(rows()[0].querySelector('.hand-card__check')!.textContent, '☑');
	assert.ok(rows()[0].classList.contains('hand-card--marked'));
	assert.ok(rows()[0].getAttribute('aria-label')!.includes('game.hand_multi_marked_tag'));

	key(rows()[0], ' ');
	assert.ok(announced.includes('game.hand_multi_unmarked:{"card":"A","count":0}'));
	assert.equal(rows()[0].querySelector('.hand-card__check')!.textContent, '☐');
});

test('Enter sends the marked set in MARKING order; empty and invalid sets refuse out loud', () => {
	key(rows()[0], ' ', { ctrlKey: true });

	key(rows()[0], 'Enter');
	assert.ok(announced.includes('game.hand_multi_none'));
	assert.deepEqual(submitted, []);

	// Mark c THEN a: the set must travel [c, a], not hand order.
	rows()[2].focus();
	key(rows()[2], ' ');
	rows()[0].focus();
	key(rows()[0], ' ');

	validateResult = { ok: false, reason: 'not-like-this' };
	key(rows()[0], 'Enter');
	assert.ok(announced.includes('not-like-this'));
	assert.deepEqual(submitted, []); // refused sets stay marked for a retry
	assert.equal(rows()[2].querySelector('.hand-card__check')!.textContent, '☑');

	validateResult = { ok: true };
	key(rows()[0], 'Enter');
	assert.deepEqual(submitted, [['c', 'a']]);
	assert.deepEqual(played, []); // multi mode never routes through onPlay
	// Sent: the marks clear.
	assert.equal(rows()[0].querySelector('.hand-card__check')!.textContent, '☐');
});

test('the mouse projection: row clicks toggle, Ctrl+click enters multi with that card marked', () => {
	// Ctrl+click from single mode: a deliberate switch — mode on AND the card marked.
	click(rows()[1], { ctrlKey: true });
	assert.deepEqual(sounds, ['hand.mode.multi']);
	assert.ok(announced.includes('game.hand_multi_on'));
	assert.equal(rows()[1].querySelector('.hand-card__check')!.textContent, '☑');

	// A plain click now toggles; the Send tool carries the live count.
	click(rows()[0]);
	assert.ok(tool('multi-send')!.textContent!.includes('"count":2'));
	click(rows()[0]);
	assert.ok(tool('multi-send')!.textContent!.includes('"count":1'));

	// The Send tool submits.
	click(tool('multi-send')!);
	assert.deepEqual(submitted, [['b']]);
});

test('a forced episode switches in with its own sound and hands the mode back when it clears', () => {
	requiredCount = 2;
	panel.update();
	assert.deepEqual(sounds, ['hand.mode.multi_forced']);
	assert.ok(announced.includes('game.hand_multi_forced:{"count":2}'));
	assert.ok(tool('multi-send'));

	// The player cannot leave while the rules hold the mode.
	key(rows()[0], ' ', { ctrlKey: true });
	assert.ok(announced.includes('game.hand_multi_locked'));
	assert.ok(tool('multi-send'));

	requiredCount = null;
	panel.update();
	assert.deepEqual(sounds, ['hand.mode.multi_forced', 'hand.mode.single']);
	assert.ok(announced.includes('game.hand_multi_off'));
	assert.equal(tool('multi-send'), null);
});

test('the player\'s own choice STICKS across a forced episode', () => {
	key(rows()[0], ' ', { ctrlKey: true }); // deliberately multi
	sounds.length = 0; announced.length = 0;

	requiredCount = 2;
	panel.update();
	// Already in multi by choice: the forced episode changes nothing audible.
	assert.deepEqual(sounds, []);

	requiredCount = null;
	panel.update();
	// The episode ends but the PREFERENCE holds: still multi, still silent.
	assert.deepEqual(sounds, []);
	assert.equal(tool('multi-toggle')!.getAttribute('aria-pressed'), 'true');
	assert.ok(tool('multi-send'));
});

test('marks of cards that left the hand vanish; the rest survive a refresh', () => {
	key(rows()[0], ' ', { ctrlKey: true });
	rows()[0].focus();
	key(rows()[0], ' '); // mark a
	rows()[1].focus();
	key(rows()[1], ' '); // mark b

	cards = [card('b'), card('c')]; // a left with the reveal
	panel.update();

	key(rows()[0], 'Enter');
	assert.deepEqual(submitted, [['b']]); // only the survivor travelled
});

test('a panel without multiSelect keeps the plain hand: Ctrl+Space inert, no toggle tool', () => {
	document.body.innerHTML = '<div id="mount2"></div>';
	const plain = new HandPanel();
	const spoken: string[] = [];
	plain.init(document.getElementById('mount2')!, {
		getCards: () => [card('x')],
		onPlay: () => {},
		onDiscard: () => {},
		announce: t => { spoken.push(t); },
		t: k => k,
	});
	assert.equal(tool('multi-toggle'), null);
	rows()[0].focus();
	key(rows()[0], ' ', { ctrlKey: true });
	assert.deepEqual(spoken, []);
	assert.equal(rows()[0].querySelector('.hand-card__check')!.textContent, '');
});
