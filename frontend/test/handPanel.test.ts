import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { HandPanel, type HandCard } from '../src/handPanel.js';
import { dialogManager } from '../src/dialogManager.js';

/**
 * The accessible hand — the central surface of card families (approved spec): a roving
 * role=list where Enter plays, Space draws, Delete discards behind a modal yes/no,
 * and the Shift+F10 / Applications menu mirrors the per-card toolbar (play, discard, sort
 * by value asc/desc, type, original, only-playable filter). The panel speaks only UI
 * mechanics; game outcomes are the server's voice.
 */

before(() => setupDom());

let panel: HandPanel;
let cards: HandCard[];
let played: string[];
let discarded: string[];
let drawn: number;
let canDraw: { ok: true } | { ok: false; reason: string };
let announced: string[];

function card(over: Partial<HandCard> & { id: string }): HandCard {
	return { label: over.id, typeKey: 'distance', value: 0, playable: true, ...over };
}

function key(target: EventTarget, keyName: string, opts: Record<string, unknown> = {}): void {
	const w = (globalThis as any).window;
	target.dispatchEvent(new w.KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true, ...opts }));
}

function rows(): HTMLElement[] {
	return Array.from(document.querySelectorAll<HTMLElement>('.hand-card'));
}

/** The open discard confirmation modal (dialogManager's yes/no). */
function confirmDialog(): HTMLElement | null {
	return document.querySelector<HTMLElement>('.game-dialog.dialog-confirm[open]');
}

function dialogButton(label: string): HTMLButtonElement {
	const btn = Array.from(confirmDialog()!.querySelectorAll<HTMLButtonElement>('button'))
		.find(b => b.textContent === label);
	assert.ok(btn, `dialog button '${label}' exists`);
	return btn!;
}

/** Confirming is async (the dialog awaits the action before closing): let it settle. */
const settled = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function rowLabels(): string[] {
	return rows().map(r => r.getAttribute('aria-label') ?? '');
}

/** The toolbar button with the given data-focus-id on the FOCUSED row. */
function actionOn(row: HTMLElement, action: string): HTMLElement {
	const btn = row.querySelector<HTMLElement>(`[data-focus-id="${action}"]`);
	assert.ok(btn, `toolbar button '${action}' exists`);
	return btn!;
}

/** A list-level tool (sort/filter): painted ONCE in the tools toolbar, never on rows. */
function listAction(action: string): HTMLElement {
	const btn = document.querySelector<HTMLElement>(
		`.hand-panel__list-actions [data-focus-id="${action}"]`);
	assert.ok(btn, `list tool '${action}' exists`);
	return btn!;
}

beforeEach(() => {
	// The panel persists sort/filter preferences: start every test from the defaults.
	try { (globalThis as any).window.localStorage.removeItem('corro.handPreferences'); } catch {}
	document.body.innerHTML = '<div id="mount"></div>';
	// The body reset detached the dialog singleton's cached elements: drop the cache so
	// the discard confirmation rebuilds fresh (same convention as the chat panel tests).
	(dialogManager as any).dialog = null;
	(dialogManager as any).nonModalDialog = null;
	cards = [
		card({ id: 'c1', label: '25 km', typeKey: 'distance', value: 25 }),
		card({ id: 'c2', label: 'Stop', typeKey: 'attack', value: 0, playable: false, unplayableReason: 'No hay rival en marcha' }),
		card({ id: 'c3', label: '100 km', typeKey: 'distance', value: 100 }),
	];
	played = []; discarded = []; drawn = 0; announced = [];
	canDraw = { ok: true };
	panel = new HandPanel();
	panel.init(document.getElementById('mount')!, {
		getCards: () => cards,
		canDraw: () => canDraw,
		onDraw: () => { drawn++; },
		onPlay: c => { played.push(c.id); },
		onDiscard: c => { discarded.push(c.id); },
		announce: text => { announced.push(text); },
		t: (k, vars) => vars ? `${k}:${JSON.stringify(vars)}` : k,
		shortcutText: { play: 'game.help_cmd_play_card', draw: 'game.help_cmd_draw_card', discard: 'game.help_cmd_discard_card' },
	});
});

test('renders a roving list, value-ordered by default; only the unplayable row is tagged', () => {
	const items = rows();
	assert.equal(items.length, 3);
	// One tab stop (roving): the first row. Default order = biggest value first.
	assert.deepEqual(items.map(r => r.tabIndex), [0, -1, -1]);
	assert.equal(items[0].getAttribute('role'), 'listitem');
	assert.deepEqual(rowLabels().map(l => l.split('.')[0]), ['100 km', '25 km', 'Stop']);
	// The exception is spoken; the common case (playable) stays silent.
	assert.equal(items[2].getAttribute('aria-label'), 'Stop. game.hand_unplayable_tag');
	assert.ok(items[2].classList.contains('hand-card--unplayable'));
	// Each row carries ITS OWN actions only; the list-level sort/filter are painted once
	// in the tools toolbar, never duplicated per row.
	assert.deepEqual(
		Array.from(items[0].querySelectorAll<HTMLElement>('button')).map(b => b.dataset.focusId),
		['play', 'discard']);
	const tools = document.querySelector<HTMLElement>('.hand-panel__list-actions')!;
	assert.equal(tools.getAttribute('role'), 'toolbar');
	assert.deepEqual(
		Array.from(tools.querySelectorAll<HTMLElement>('button')).map(b => b.dataset.focusId),
		['sort-value', 'sort-value-asc', 'sort-type', 'sort-hand', 'filter-playable']);
	// One tab stop: the toolbar roves like any other.
	assert.deepEqual(
		Array.from(tools.querySelectorAll<HTMLElement>('button')).map(b => b.tabIndex),
		[0, -1, -1, -1, -1]);
});

test('arrows move between cards; Right enters the toolbar with play first', () => {
	const items = rows();
	items[0].focus();
	key(items[0], 'ArrowDown');
	assert.equal(document.activeElement, items[1]);
	key(items[1], 'ArrowRight');
	assert.equal(document.activeElement, actionOn(items[1], 'play'));
});

test('Enter plays a playable card', () => {
	const items = rows();
	items[0].focus();
	key(items[0], 'Enter');
	assert.deepEqual(played, ['c3']); // 100 km sits first under the default value order
});

test('Enter on an unplayable card offers to discard it (the only action left)', async () => {
	const items = rows();
	items[2].focus();
	key(items[2], 'Enter');
	assert.deepEqual(played, []);
	const dlg = confirmDialog();
	assert.ok(dlg, 'the discard offer opened');
	// One breath: the refusal reason, then the question.
	const msg = dlg!.querySelector('.dialog-content')!.textContent!;
	assert.match(msg, /No hay rival en marcha/);
	assert.match(msg, /hand_discard_question/);
	assert.match(msg, /Stop/);
	dialogButton('game.hand_discard').click();
	assert.deepEqual(discarded, ['c2']);
	await settled();
	assert.equal(confirmDialog(), null, 'the dialog closed itself');
});

test('the play button is aria-disabled (never disabled) on an unplayable card', () => {
	const items = rows();
	const play = actionOn(items[2], 'play');
	assert.equal(play.getAttribute('aria-disabled'), 'true');
	assert.equal(play.hasAttribute('disabled'), false);
	(play as HTMLButtonElement).click();
	assert.deepEqual(played, []);
	assert.ok(confirmDialog(), 'clicking it opens the same discard offer');
	dialogButton('common.cancel').click();
	assert.deepEqual(discarded, []);
});

test('Space draws when the family allows it, and speaks the refusal otherwise', () => {
	const items = rows();
	items[0].focus();
	key(items[0], ' ');
	assert.equal(drawn, 1);

	canDraw = { ok: false, reason: 'No es tu turno' };
	key(items[0], ' ');
	assert.equal(drawn, 1);
	assert.deepEqual(announced, ['No es tu turno']);
});

test('keys the hand consumes never leak to the global keymap layer', () => {
	// Regression: Space is ALSO the global "roll dice" key — without stopPropagation a draw
	// bubbled up and fired a dice roll behind the player's back ("you draw… and roll the die!").
	const leaked: string[] = [];
	const spy = (e: KeyboardEvent) => { leaked.push(e.key); };
	document.addEventListener('keydown', spy);
	const items = rows();
	items[0].focus();
	key(items[0], ' ');      // draw
	key(items[0], 'Enter');  // play
	key(items[1], 'Delete'); // discard (opens the confirm dialog)
	document.removeEventListener('keydown', spy);
	assert.deepEqual(leaked, []);
	assert.equal(drawn, 1); // the keys still did their hand job
	assert.deepEqual(played, ['c3']);
	dialogButton('common.cancel').click(); // leave no dialog behind
});

test('Delete asks in a modal; confirming discards THAT card', async () => {
	const items = rows();
	items[0].focus();
	key(items[0], 'Delete');
	assert.deepEqual(discarded, []);
	const dlg = confirmDialog();
	assert.ok(dlg, 'the yes/no dialog opened');
	const msg = dlg!.querySelector('.dialog-content')!.textContent!;
	assert.match(msg, /hand_discard_question/);
	assert.match(msg, /100 km/);

	// The player ASKED to discard: the initial focus lands on the ANSWER, not on Cancel.
	await new Promise(resolve => setTimeout(resolve, 60));
	assert.equal((document.activeElement as HTMLElement).textContent, 'game.hand_discard',
		'initial focus is the Descartar button');

	dialogButton('game.hand_discard').click();
	assert.deepEqual(discarded, ['c3']);
	await settled();
	assert.equal(confirmDialog(), null, 'the dialog closed itself');
});

test('cancelling the discard keeps the card and returns focus to the hand', () => {
	const items = rows();
	items[0].focus();
	key(items[0], 'Delete');
	dialogButton('common.cancel').click();
	assert.deepEqual(discarded, []);
	assert.equal(confirmDialog(), null);
	assert.equal((document.activeElement as HTMLElement).dataset.focusId, 'c3',
		'focus is back on the card the question was about');
});

test('the only-playable filter is ONE toggle: checked narrows, unchecked restores', () => {
	const filter = listAction('filter-playable');
	assert.equal(filter.getAttribute('aria-pressed'), 'false');

	(filter as HTMLButtonElement).click();
	assert.deepEqual(rowLabels(), ['100 km', '25 km']);
	assert.deepEqual(announced, ['game.hand_filter_applied:{"playable":2,"total":3}']);
	assert.equal(listAction('filter-playable').getAttribute('aria-pressed'), 'true');

	(listAction('filter-playable') as HTMLButtonElement).click(); // same action, unchecked
	assert.equal(rows().length, 3);
	assert.deepEqual(announced.at(-1), 'game.hand_filter_cleared:{"total":3}');
});

test('sort/filter preferences survive a reload (a fresh panel picks them up)', () => {
	// Change both, as a player would…
	(listAction('sort-hand') as HTMLButtonElement).click();
	(listAction('filter-playable') as HTMLButtonElement).click();

	// …then "reload": a brand-new panel over the same mount reads the saved preferences.
	document.body.innerHTML = '<div id="mount"></div>';
	panel = new HandPanel();
	panel.init(document.getElementById('mount')!, {
		getCards: () => cards,
		canDraw: () => canDraw,
		onDraw: () => { drawn++; },
		onPlay: c => { played.push(c.id); },
		onDiscard: c => { discarded.push(c.id); },
		announce: text => { announced.push(text); },
		t: (k, vars) => vars ? `${k}:${JSON.stringify(vars)}` : k,
	});

	// Hand order + only-playable, exactly as left: c1 then c3 (c2 filtered out).
	assert.deepEqual(rowLabels(), ['25 km', '100 km']);
	assert.equal(listAction('filter-playable').getAttribute('aria-pressed'), 'true');
	assert.equal(listAction('sort-hand').getAttribute('aria-pressed'), 'true');
});

test('corrupted preferences fall back to the defaults', () => {
	(globalThis as any).window.localStorage.setItem('corro.handPreferences', '{not json');
	document.body.innerHTML = '<div id="mount"></div>';
	panel = new HandPanel();
	panel.init(document.getElementById('mount')!, {
		getCards: () => cards,
		canDraw: () => canDraw,
		onDraw: () => {}, onPlay: () => {}, onDiscard: () => {},
		announce: () => {}, t: k => k,
	});
	assert.deepEqual(rowLabels().map(l => l.split('.')[0]), ['100 km', '25 km', 'Stop']); // value default
});

test('modified arrows are left to other layers (Ctrl+Down walks the history, not the list)', () => {
	const items = rows();
	items[0].focus();
	key(items[0], 'ArrowDown', { ctrlKey: true });
	assert.equal(document.activeElement, items[0]); // the roving cursor did not move
});

test('a filter that leaves nothing keeps the EMPTY list, described — no paragraph swap', () => {
	cards = [card({ id: 'c9', label: 'Stop', playable: false })];
	panel.update();
	(listAction('filter-playable') as HTMLButtonElement).click();

	assert.equal(rows().length, 0);
	const list = document.querySelector<HTMLElement>('.hand-panel__list')!;
	assert.equal(list.hidden, false); // the list stays, visibly empty
	const descId = list.getAttribute('aria-describedby');
	assert.ok(descId, 'the list describes why it is empty');
	assert.equal(document.getElementById(descId!)?.textContent, 'game.hand_filtered_all');
	assert.equal(document.querySelector<HTMLElement>('.hand-panel__empty')!.hidden, true);
	// Focus has somewhere to land: the described list itself.
	panel.focus();
	assert.equal(document.activeElement, list);

	// The context menu must STILL open from the empty list (there is no row toolbar to
	// mirror) — or the filter could never be lifted. Keyboard…
	key(list, 'F10', { shiftKey: true });
	let menu = document.querySelector<HTMLElement>('.hand-context-menu');
	assert.ok(menu, 'list-level menu opened with Shift+F10');
	const entryQuery = '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]';
	const filterEntry = Array.from(menu!.querySelectorAll<HTMLElement>(entryQuery))
		.find(mi => mi.textContent === 'game.hand_filter_playable')!;
	assert.equal(filterEntry.getAttribute('aria-checked'), 'true');
	filterEntry.click(); // unchecking restores the hand
	assert.equal(rows().length, 1);

	// …and right-click on the emptied list too.
	(listAction('filter-playable') as HTMLButtonElement).click();
	assert.equal(rows().length, 0);
	const w = (globalThis as any).window;
	list.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
	menu = document.querySelector<HTMLElement>('.hand-context-menu');
	assert.ok(menu, 'list-level menu opened with right-click');
});

test('the sort radios: value-desc is the default; ascending, original and type all apply', () => {
	// Value (highest first) is checked from the start (the default), the others not.
	assert.equal(listAction('sort-value').getAttribute('aria-pressed'), 'true');
	assert.equal(listAction('sort-hand').getAttribute('aria-pressed'), 'false');

	// The same value order, reversed: smallest first for players building up.
	(listAction('sort-value-asc') as HTMLButtonElement).click();
	assert.deepEqual(rowLabels().map(l => l.split('.')[0]), ['Stop', '25 km', '100 km']);
	assert.deepEqual(announced, ['game.hand_sorted_valueAsc']);
	assert.equal(listAction('sort-value-asc').getAttribute('aria-pressed'), 'true');
	assert.equal(listAction('sort-value').getAttribute('aria-pressed'), 'false');

	(listAction('sort-hand') as HTMLButtonElement).click();
	assert.deepEqual(rowLabels().map(l => l.split('.')[0]), ['25 km', 'Stop', '100 km']);
	assert.deepEqual(announced.at(-1), 'game.hand_sorted_hand');
	assert.equal(listAction('sort-hand').getAttribute('aria-pressed'), 'true');

	(listAction('sort-type') as HTMLButtonElement).click();
	// attack < distance alphabetically; c1 before c3 (hand order preserved within a group).
	assert.deepEqual(rowLabels().map(l => l.split('.')[0]), ['Stop', '25 km', '100 km']);
});

test('sort by colour: only shows with coloured cards; groups by colour, value within, wilds last', () => {
	// The default hand carries no colour, so the colour order never appears.
	assert.throws(() => listAction('sort-colour'));
	// A colour-matching hand: colourOrder is the deck's colour order (0 = red, 1 = green); wilds
	// carry none.
	cards = [
		card({ id: 'g5', label: 'green 5', value: 5, colourOrder: 1 }),
		card({ id: 'r2', label: 'red 2', value: 2, colourOrder: 0 }),
		card({ id: 'r9', label: 'red 9', value: 9, colourOrder: 0 }),
		card({ id: 'wild', label: 'wild', value: 10 }),
	];
	panel.update();
	(listAction('sort-colour') as HTMLButtonElement).click();
	assert.deepEqual(announced.at(-1), 'game.hand_sorted_colour');
	// Red group first (highest value within), then green, then the colourless wild last.
	assert.deepEqual(rowLabels().map(l => l.split('.')[0]), ['red 9', 'red 2', 'green 5', 'wild']);
	assert.equal(listAction('sort-colour').getAttribute('aria-pressed'), 'true');
});

test('update() preserves focus on the same card by id when the hand changes', () => {
	const items = rows();
	items[2].focus(); // c2 ("Stop") sits last under the value order
	assert.equal((document.activeElement as HTMLElement).dataset.focusId, 'c2');

	cards = [cards[1], cards[2], card({ id: 'c4', label: 'Circule' })]; // c1 left, c4 arrived
	panel.update();
	assert.equal((document.activeElement as HTMLElement).dataset.focusId, 'c2');
	assert.equal(rows().length, 3);
});

test('when the focused card leaves the hand, focus lands on the first remaining card', () => {
	const items = rows();
	items[0].focus(); // c3 ("100 km")
	cards = cards.filter(c => c.id !== 'c3'); // …and it gets played
	panel.update();
	assert.equal((document.activeElement as HTMLElement).dataset.focusId, 'c1');
});

test('an empty hand shows the empty message and Space still draws from it', () => {
	cards = [];
	panel.update();
	const empty = document.querySelector<HTMLElement>('.hand-panel__empty')!;
	assert.equal(empty.hidden, false);
	assert.equal(empty.textContent, 'game.hand_empty');

	panel.focus();
	assert.equal(document.activeElement, empty);
	key(empty, ' ');
	assert.equal(drawn, 1);
});

test('Shift+F10 menu: sorts fold into ONE submenu of radios; the filter is a checkbox', () => {
	const items = rows();
	items[0].focus();
	key(items[0], 'F10', { shiftKey: true });
	const menu = document.querySelector<HTMLElement>('.hand-context-menu')!;
	assert.ok(menu, 'context menu opened');
	const entryQuery = '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]';
	const entries = () => Array.from(menu.querySelectorAll<HTMLElement>(entryQuery));

	// Root: play, discard, the ONE sort-group entry, the filter checkbox.
	assert.deepEqual(entries().map(mi => mi.textContent), [
		'game.hand_play', 'game.hand_discard', 'game.hand_sort_group', 'game.hand_filter_playable',
	]);
	const sortGroup = entries().find(mi => mi.textContent === 'game.hand_sort_group')!;
	assert.equal(sortGroup.getAttribute('aria-haspopup'), 'menu');
	const filter = entries().find(mi => mi.textContent === 'game.hand_filter_playable')!;
	assert.equal(filter.getAttribute('role'), 'menuitemcheckbox');
	assert.equal(filter.getAttribute('aria-checked'), 'false');

	// Opening the submenu shows the four orderings as a radio set, value-desc checked (default).
	sortGroup.click();
	const radios = entries();
	assert.deepEqual(radios.map(mi => [mi.textContent, mi.getAttribute('role'), mi.getAttribute('aria-checked')]), [
		['game.hand_sort_by_value', 'menuitemradio', 'true'],
		['game.hand_sort_by_value_asc', 'menuitemradio', 'false'],
		['game.hand_sort_by_type', 'menuitemradio', 'false'],
		['game.hand_sort_hand', 'menuitemradio', 'false'],
	]);

	// Escape backs out to the root (refocusing the group entry), not out of the menu.
	key(document.activeElement!, 'Escape');
	assert.ok(document.querySelector('.hand-context-menu'), 'menu still open');
	assert.equal((document.activeElement as HTMLElement).textContent, 'game.hand_sort_group');

	// Checking the filter filters; reopening shows it checked.
	entries().find(mi => mi.textContent === 'game.hand_filter_playable')!.click();
	assert.deepEqual(rowLabels(), ['100 km', '25 km']);
	key(rows()[0], 'F10', { shiftKey: true });
	const reopened = Array.from(document.querySelectorAll<HTMLElement>('.hand-context-menu [role="menuitemcheckbox"]'));
	assert.equal(reopened[0]?.getAttribute('aria-checked'), 'true');
});

test('a card FACE renders aria-hidden and repaints when the label changes (late i18n)', () => {
	cards = [{ ...card({ id: 'c9', label: 'cards.raw' }), art: '<span class="jcard">RAW</span>' }];
	panel.update();
	const row = rows()[0];
	const art = row.querySelector('.hand-card__art')!;
	assert.equal(art.getAttribute('aria-hidden'), 'true'); // decoration only
	assert.ok(row.classList.contains('hand-card--visual'));
	assert.match(art.innerHTML, /RAW/);

	// The package i18n merge repaints labels: the face must follow (same card id).
	cards = [{ ...card({ id: 'c9', label: 'Reparación' }), art: '<span class="jcard">NICE</span>' }];
	panel.update();
	assert.match(art.innerHTML, /NICE/);
	assert.equal(rows()[0].getAttribute('aria-label'), 'Reparación'); // the ACCESSIBLE card
});

test('info rows pin AFTER the cards: exempt from sort/filter, inert to play and discard', () => {
	document.body.innerHTML = '<div id="mount"></div>';
	panel = new HandPanel();
	panel.init(document.getElementById('mount')!, {
		getCards: () => cards,
		canDraw: () => canDraw,
		onDraw: () => { drawn++; },
		onPlay: c => { played.push(c.id); },
		onDiscard: c => { discarded.push(c.id); },
		announce: text => { announced.push(text); },
		t: (k, vars) => vars ? `${k}:${JSON.stringify(vars)}` : k,
		infoRows: () => [{ id: '__deck', label: 'Cartas en el mazo: 12' }],
	});

	// Last under the default value sort — and it plays no part in the ordering.
	assert.deepEqual(rowLabels().map(l => l.split('.')[0]),
		['100 km', '25 km', 'Stop', 'Cartas en el mazo: 12']);
	const deck = rows()[3];
	assert.ok(deck.classList.contains('hand-card--info'));

	// Enter/Delete do nothing on it: it is not a card.
	deck.focus();
	key(deck, 'Enter');
	key(deck, 'Delete');
	assert.deepEqual(played, []);
	assert.deepEqual(discarded, []);
	assert.equal(confirmDialog(), null);

	// The only-playable filter narrows the CARDS; the info row stays.
	(listAction('filter-playable') as HTMLButtonElement).click();
	assert.deepEqual(rowLabels(), ['100 km', '25 km', 'Cartas en el mazo: 12']);

	// An empty hand keeps the list alive FOR the info row, empty message alongside.
	cards = [];
	panel.update();
	assert.deepEqual(rowLabels(), ['Cartas en el mazo: 12']);
	assert.equal(document.querySelector<HTMLElement>('.hand-panel__list')!.hidden, false);
	assert.equal(document.querySelector<HTMLElement>('.hand-panel__empty')!.hidden, false);
});

test('discarding via the menu goes through the SAME modal confirmation', () => {
	const items = rows();
	items[0].focus();
	key(items[0], 'F10', { shiftKey: true });
	const discardItem = Array.from(document.querySelectorAll<HTMLElement>('.hand-context-menu [role="menuitem"]'))
		.find(mi => mi.textContent === 'game.hand_discard')!;
	discardItem.click();
	assert.deepEqual(discarded, []);
	assert.ok(confirmDialog(), 'the yes/no dialog opened from the menu');
	dialogButton('game.hand_discard').click();
	assert.deepEqual(discarded, ['c3']);
});

// activeShortcuts() is the SINGLE source for the shortcuts help: the hand declares its keys
// once (Enter/Space/Delete/Ctrl+Space, mirroring onKeydown) with the family's own wording,
// and lists exactly the affordances that are wired — never a key the hand can't perform.
test('activeShortcuts lists one row per wired affordance, in the family words', () => {
	// The beforeEach hand wires play + draw + discard (journey-shaped); no card carries help.
	assert.deepEqual(panel.activeShortcuts(), [
		{ keys: 'enter', descKey: 'game.help_cmd_play_card' },
		{ keys: 'space', descKey: 'game.help_cmd_draw_card' },
		{ keys: 'delete', descKey: 'game.help_cmd_discard_card' },
	]);
});

test('activeShortcuts adds Shift+F1 (card help) when a card carries help', () => {
	cards = [card({ id: 'h1', label: 'Skip', help: 'Skips the next player.' })];
	panel.update();
	assert.deepEqual(panel.activeShortcuts().at(-1), { keys: 'shift+f1', descKey: 'game.help_cmd_card_help' });
});

test('Shift+F1 on a card opens its help reading dialog; a helpless card is left alone', () => {
	cards = [
		card({ id: 'h1', label: 'Skip', help: 'Skips the next player.' }),
		card({ id: 'h2', label: 'Plain' }), // no help
	];
	panel.update();
	const items = rows();

	items[0].focus();
	key(items[0], 'F1', { shiftKey: true });
	const dlg = document.querySelector('.game-dialog.dialog-card-help[open]');
	assert.ok(dlg, 'the card help dialog opened');
	assert.ok(dlg!.textContent!.includes('Skips the next player'));
	dialogManager.close();

	// A card without help does nothing (and never crashes).
	items[1].focus();
	assert.doesNotThrow(() => key(items[1], 'F1', { shiftKey: true }));
	assert.equal(document.querySelector('.dialog-card-help[open]'), null);
});

test('activeShortcuts drops the keys whose callback is not wired', () => {
	// A shedding-shaped hand: play + draw, no discard, no multi-select.
	const p = new HandPanel();
	document.body.innerHTML = '<div id="m2"></div>';
	p.init(document.getElementById('m2')!, {
		getCards: () => [],
		canDraw: () => ({ ok: true }),
		onDraw: () => {},
		onPlay: () => {},
		announce: () => {},
		t: k => k,
		shortcutText: { play: 'game.help_cmd_play_card', draw: 'game.help_cmd_shedding_draw', discard: 'game.help_cmd_discard_card' },
	});
	// Delete is dropped (no onDiscard) even though its text was supplied; Ctrl+Space too.
	assert.deepEqual(p.activeShortcuts(), [
		{ keys: 'enter', descKey: 'game.help_cmd_play_card' },
		{ keys: 'space', descKey: 'game.help_cmd_shedding_draw' },
	]);
});

test('activeShortcuts includes Ctrl+Space only when multi-select is opted in', () => {
	// A draft-shaped hand: pick + multi-select, no draw, no discard.
	const p = new HandPanel();
	document.body.innerHTML = '<div id="m3"></div>';
	p.init(document.getElementById('m3')!, {
		getCards: () => [],
		onPlay: () => {},
		multiSelect: { validate: () => ({ ok: true }), submit: () => {} },
		announce: () => {},
		t: k => k,
		shortcutText: { play: 'game.help_cmd_pick_card', multiSelect: 'game.help_cmd_multi_select' },
	});
	assert.deepEqual(p.activeShortcuts(), [
		{ keys: 'enter', descKey: 'game.help_cmd_pick_card' },
		{ keys: 'ctrl+space', descKey: 'game.help_cmd_multi_select' },
	]);
});
