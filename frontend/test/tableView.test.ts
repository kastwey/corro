import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';
import { TableView } from '../src/tableView.js';

/**
 * The table between matches (docs/tables.md). It shares the game page with the board and takes
 * turns with it — never a navigation, because chat and voice are mounted there and a page load
 * would drop the LiveKit connection and cut the conversation in half.
 */

before(() => {
	setupDom();
	installFakeI18next('en');
});

/** The game page's two surfaces: the table, and everything the board lives in. */
function mount(): void {
	document.body.innerHTML = `
		<section id="table-view" hidden>
			<h2 id="table-heading" tabindex="-1">At the table</h2>
			<p id="table-intro" data-i18n="table.introGuest">No game is running.</p>
			<p><strong id="table-code"></strong>
			<button type="button" id="table-copy-code" hidden>Copy code</button></p>
			<p><span id="table-invite-url"></span>
			<button type="button" id="table-copy-link" hidden>Copy link</button></p>
			<div id="table-rejoin-mount"></div>
			<div id="table-content-language-group" hidden>
				<select id="table-content-language"></select>
			</div>
			<p id="table-content-language-current" hidden></p>
			<p id="table-last-match" hidden>
				<span id="table-last-match-line"></span>
				<button type="button" id="table-standings">See the standings</button>
			</p>
			<h3 id="table-players-heading">Who is here</h3>
			<div class="table-view__players-surface" role="application" aria-labelledby="table-players-heading">
				<ul id="table-players" role="list"></ul>
			</div>
			<button type="button" id="table-add-bot" hidden>Add a bot</button>
			<details id="table-rules" hidden>
				<summary>Rules</summary>
				<div id="table-rules-fields"></div>
			</details>
			<p id="table-waiting-host" hidden>Waiting for the host</p>
			<p class="table-view__invite" id="table-invite-someone" hidden>
				<label for="table-invite-handle">Public name</label>
				<input type="text" id="table-invite-handle" maxlength="20" autocomplete="off">
				<button type="button" id="table-invite-send">Invite</button>
			</p>
			<div id="table-invite-people-block" hidden>
				<p class="form-hint" id="table-invite-people-hint">Or pick somebody.</p>
				<ul id="table-invite-people" role="listbox" aria-label="People you can invite"></ul>
			</div>
			<p id="table-invite-status" role="status" aria-live="polite"></p>
			<div id="table-actions"></div>
		</section>
		<p id="game-surface-intro">Focus will move to your hand.</p>
		<div id="game-layout"></div>`;
}

/** A table document as the server sanitizes it. */
function table(overrides: Partial<import('../src/models.js').GameInfo> = {}): any {
	return {
		gameId: 'g1', hostId: 'a', inviteCode: 'ABCD', status: 'WaitingForPlayers',
		maxPlayers: 4, players: [], ...overrides,
	};
}

function newView(overrides: Partial<Parameters<TableView['init']>[0]> = {}): TableView {
	const view = new TableView();
	view.init({
		t: (key: string) => key,
		isHost: () => false,
		start: async () => {},
		announce: () => {},
		...overrides,
	});
	return view;
}

beforeEach(() => {
	installFakeI18next('en');
	mount();
});

test('showing the table puts the board away, and hiding it gives the page back', () => {
	const root = document.getElementById('table-view')!;
	const game = document.getElementById('game-layout')!;
	const view = newView();

	const intro = document.getElementById('game-surface-intro') as HTMLElement;

	view.show();
	assert.equal(root.hidden, false);
	assert.equal(game.hidden, true, 'the board must not sit behind the table');
	assert.equal(intro.hidden, true, 'no telling people where focus goes in a game that is not running');

	view.hide();
	assert.equal(root.hidden, true);
	assert.equal(game.hidden, false);
	assert.equal(intro.hidden, false);
});

test('arriving at the table does not steal the reading position; coming back to it does', () => {
	// Focus is only moved when the player ARRIVES here from a finished match: the dialog that
	// held focus is gone, so it must land somewhere that is read out loud.
	const view = newView();
	const heading = document.getElementById('table-heading') as HTMLElement;

	view.show();
	assert.notEqual(document.activeElement, heading);

	view.show({ focus: true });
	assert.equal(document.activeElement, heading);
});

test('the roster names everyone, their piece, and who is the host', () => {
	const view = newView();

	view.setTable(table({
		players: [
			{ id: 'a', name: 'Ana', token: 'disc', isHost: true },
			{ id: 'b', name: 'Berto', token: 'star', isBot: true },
		],
	}));

	const items = document.querySelectorAll('#table-players .player-item');
	assert.equal(items.length, 2);
	const first = items[0].textContent ?? '';
	assert.match(first, /Ana/);
	assert.match(first, /lobby\.playerHost/, 'the host is named as such');
	assert.match(items[1].textContent ?? '', /lobby\.playerBot/);
});

// Reported from a real session: the roster read "Kastwey, game.token_stout_pint, (anfitrión)".
// A package's piece names live in ITS translation bundle, which a table loads a moment after it
// paints — and getTokenName's fallback was being dropped, so the key itself reached the screen.
test('the roster names each piece, and never prints a raw translation key', () => {
	const named = newView({ t: key => (key === 'game.token_disc' ? 'Disco' : key) });
	named.setTable(table({ players: [{ id: 'a', name: 'Ana', token: 'disc' }] }));
	assert.match(document.querySelector('#table-players .player-item')!.textContent ?? '', /Disco/);

	// A package piece whose bundle has not arrived yet: a readable fallback, never the key.
	const unresolved = newView();
	unresolved.setTable(table({ players: [{ id: 'a', name: 'Ana', token: 'stout_pint' }] }));
	const text = document.querySelector('#table-players .player-item')!.textContent ?? '';
	assert.match(text, /Ana/);
	assert.doesNotMatch(text, /game\.token_/, 'a translation key must never reach the screen');
});

test('the table speaks to whoever is reading it, and a first game is not "another" one', () => {
	const intro = () => document.getElementById('table-intro')!;
	const start = () => document.getElementById('table-start-btn') as HTMLButtonElement;

	const host = newView({ isHost: () => true });
	host.setTable(table());
	host.show();
	// Telling the host to wait for the host is the copy that gave this away.
	assert.equal(intro().getAttribute('data-i18n'), 'table.introHost');
	assert.equal(start().textContent, 'table.start');

	// …and once this table has played, the next one is another one.
	host.setTable(table({ matchesPlayed: 2 }));
	assert.equal(start().textContent, 'table.startAnother');

	const guest = newView({ isHost: () => false });
	guest.setTable(table());
	guest.show();
	assert.equal(intro().getAttribute('data-i18n'), 'table.introGuest');
});

test('a rebuilt roster replaces the previous one instead of piling up', () => {
	const view = newView();

	view.setTable(table({ players: [{ id: 'a', name: 'Ana', token: 'disc' }] }));
	view.setTable(table({
		players: [
			{ id: 'a', name: 'Ana', token: 'disc' },
			{ id: 'b', name: 'Berto', token: 'star' },
		],
	}));

	assert.equal(document.querySelectorAll('#table-players .player-item').length, 2);
});

test('the host may send a bot away from the roster; nobody may send a person away', () => {
	const removed: string[] = [];
	const view = newView({ isHost: () => true, removeBot: async id => { removed.push(id); } });

	view.setTable(table({
		players: [
			{ id: 'a', name: 'Ana', token: 'disc', isHost: true },
			{ id: 'bot', name: 'Crupier', token: 'star', isBot: true },
		],
	}));

	const buttons = document.querySelectorAll('#table-players .player-item__remove-bot');
	assert.equal(buttons.length, 1, 'only the bot row carries the control');
	(buttons[0] as HTMLButtonElement).click();
	assert.deepEqual(removed, ['bot']);
});

// The roster is the SAME widget the match uses (playerPanel.ts). It used to be a plain list with
// the host's buttons in the tab order: eight people meant sixteen presses to walk past the table.
test('the roster is one tab stop, and a person\'s actions live behind the arrow key', () => {
	const view = newView({ isHost: () => true, makeHost: async () => {}, removeBot: async () => {} });

	view.setTable(table({
		players: [
			{ id: 'a', name: 'Ana', token: 'disc', isHost: true },
			{ id: 'b', name: 'Berto', token: 'star' },
			{ id: 'bot', name: 'Crupier', token: 'moon', isBot: true },
		],
	}));

	const list = document.getElementById('table-players') as HTMLElement;
	const rows = Array.from(list.querySelectorAll<HTMLElement>('.player-item'));
	assert.deepEqual(rows.map(row => row.tabIndex), [0, -1, -1], 'exactly one tab stop for the list');
	// Every action is off the tab order: the row is the way in.
	assert.deepEqual(
		Array.from(list.querySelectorAll<HTMLElement>('.player-item__actions button')).map(b => b.tabIndex),
		[-1, -1]);
	// A row reads as one line rather than as its parts glued together.
	assert.match(rows[0].getAttribute('aria-label') ?? '', /^Ana, .*lobby\.playerHost\.$/);

	const press = (from: HTMLElement, key: string, shiftKey = false) => from.dispatchEvent(
		new (globalThis as any).window.KeyboardEvent('keydown', { key, shiftKey, bubbles: true }));

	rows[0].focus();
	press(rows[0], 'ArrowDown');
	assert.equal(document.activeElement, rows[1]);
	press(rows[1], 'ArrowRight');
	assert.equal(document.activeElement, rows[1].querySelector('.player-item__make-host'));
	// …and Escape backs out to the person, without leaving the list.
	press(document.activeElement as HTMLElement, 'Escape');
	assert.equal(document.activeElement, rows[1]);

	// Shift+F10 mirrors the row's actions in a menu, for anyone who never learns the arrow.
	press(rows[1], 'F10', true);
	const menu = document.querySelector('.player-context-menu');
	assert.ok(menu, 'the actions are also reachable as a menu');
	assert.deepEqual(
		Array.from(menu!.querySelectorAll('[role="menuitem"]')).map(item => item.textContent),
		['table.makeHostOf']);
});

test('a guest is never offered the bot controls', () => {
	const view = newView({ isHost: () => false, removeBot: async () => {} });

	view.setTable(table({
		players: [{ id: 'bot', name: 'Crupier', token: 'star', isBot: true }],
		gameType: 'property',
	}));

	assert.equal(document.querySelectorAll('#table-players .player-item__remove-bot').length, 0);
	assert.equal((document.getElementById('table-add-bot') as HTMLButtonElement).hidden, true);
});

test('the empty chair is offered only where a bot can actually sit', () => {
	const chair = () => (document.getElementById('table-add-bot') as HTMLButtonElement).hidden;
	const view = newView({ isHost: () => true, addBot: () => {} });

	// A family with a bot brain, with room left.
	view.setTable(table({ gameType: 'property', maxPlayers: 4, players: [{ id: 'a', name: 'Ana', token: 'disc' }] }));
	assert.equal(chair(), false);

	// The same family, full.
	view.setTable(table({
		gameType: 'property', maxPlayers: 2,
		players: [{ id: 'a', name: 'Ana', token: 'disc' }, { id: 'b', name: 'Berto', token: 'star' }],
	}));
	assert.equal(chair(), true);

	// A family with no bots at all.
	view.setTable(table({ gameType: 'trivia', maxPlayers: 4, players: [{ id: 'a', name: 'Ana', token: 'disc' }] }));
	assert.equal(chair(), true);
});

test('the shared deck is the host\'s to change and everyone else\'s to read', () => {
	const group = () => document.getElementById('table-content-language-group') as HTMLElement;
	const summary = () => document.getElementById('table-content-language-current') as HTMLElement;
	const chosen: string[] = [];

	const host = newView({ isHost: () => true, setContentLanguage: async l => { chosen.push(l); } });
	host.setTable(table({ contentLanguages: ['en', 'es'], language: 'es' }));
	assert.equal(group().hidden, false);
	assert.equal(summary().hidden, true);
	const select = document.getElementById('table-content-language') as HTMLSelectElement;
	assert.equal(select.value, 'es');
	select.value = 'en';
	select.dispatchEvent(new (globalThis as any).window.Event('change'));
	assert.deepEqual(chosen, ['en']);

	const guest = newView({ isHost: () => false, setContentLanguage: async () => {} });
	guest.setTable(table({ contentLanguages: ['en', 'es'], language: 'es' }));
	assert.equal(group().hidden, true);
	assert.equal(summary().hidden, false, 'a guest still learns which deck the table plays with');
});

test('a board whose content is not language-split offers no deck at all', () => {
	const view = newView({ isHost: () => true, setContentLanguage: async () => {} });

	view.setTable(table({ contentLanguages: [] }));

	assert.equal((document.getElementById('table-content-language-group') as HTMLElement).hidden, true);
	assert.equal((document.getElementById('table-content-language-current') as HTMLElement).hidden, true);
});

test('the re-entry code is shown with a way to copy it, and nothing when there is none', () => {
	const withCode = newView({ rejoinCode: () => 'ZZZ9', copy: async () => true });
	withCode.setTable(table());
	const mountEl = document.getElementById('table-rejoin-mount') as HTMLElement;
	assert.match(mountEl.textContent ?? '', /ZZZ9/);
	assert.ok(mountEl.querySelector('#table-copy-rejoin'));

	const without = newView({ rejoinCode: () => null });
	without.setTable(table());
	assert.equal((document.getElementById('table-rejoin-mount') as HTMLElement).textContent, '');
});

// The end screen is raised once, live, for whoever was there when the match finished. This is
// how everyone else finds out — someone who reconnected a minute later, or who dismissed it and
// wants another look. Without it, a dropped connection at the wrong moment meant never learning
// who won.
test('the table remembers who won the last match, and offers the full standings', () => {
	const opened: string[] = [];
	const view = newView({
		// A real template, so the winner's name is proven to be interpolated into it.
		t: key => key === 'table.lastMatchWinner' ? 'Last match: {{winner}} won.' : key,
		showStandings: match => opened.push(match.winnerId ?? ''),
	});

	view.setTable(table({
		lastMatch: { winnerId: 'b', winnerName: 'Berto', isGameOver: true, players: [] } as any,
	}));

	const box = document.getElementById('table-last-match') as HTMLElement;
	assert.equal(box.hidden, false);
	assert.match(document.getElementById('table-last-match-line')!.textContent ?? '', /Berto/);
	(document.getElementById('table-standings') as HTMLButtonElement).click();
	assert.deepEqual(opened, ['b'], 'the standings are the finished match, not the live one');
});

test('a table that has not played yet says nothing about a last match', () => {
	const view = newView({ showStandings: () => {} });

	view.setTable(table());

	assert.equal((document.getElementById('table-last-match') as HTMLElement).hidden, true);
	assert.equal(document.getElementById('table-last-match-line')!.textContent, '');
});

// A table plays again and again, and the game that just ended is exactly when a group decides
// the rules were wrong. The panel opens on what the LAST match was played with, not on the
// board's defaults, so changing one thing does not silently reset the rest.
test('the host edits the board rules for the next match, starting from the current ones', async () => {
	const saved: Record<string, boolean | number | string>[] = [];
	const view = newView({
		isHost: () => true,
		loadRules: async () => ({
			houseRules: [
				{ id: 'auctions', type: 'toggle', default: true },
				{ id: 'startingMoney', type: 'number', default: 1500 },
			],
		}) as any,
		saveRules: async values => { saved.push(values); },
	});

	view.setTable(table({ packageToken: 'pkg', ruleValues: { auctions: false } }));
	await new Promise(resolve => setTimeout(resolve, 0));

	const box = document.getElementById('table-rules') as HTMLElement;
	assert.equal(box.hidden, false);
	const auctions = document.querySelector<HTMLInputElement>('#table-rules-fields [data-rule-id="auctions"]')!;
	assert.equal(auctions.checked, false, 'opens on the value this table already holds');

	auctions.checked = true;
	auctions.dispatchEvent(new (globalThis as any).window.Event('change', { bubbles: true }));
	await new Promise(resolve => setTimeout(resolve, 0));

	assert.equal(saved.length, 1);
	assert.equal(saved[0].auctions, true);
	assert.equal(saved[0].startingMoney, 1500, 'the untouched rules travel with the change');
});

// Reported from a real session: "al expandir las reglas, todas aparecen con sus claves de
// traducción". This panel is built from the package DEFINITION, which arrives before the package's
// WORDS do — and it is built once, so every label froze as the key it was rendered with and
// nothing came back to fix it. The labels now carry their own keys and are re-resolved in place.
test('the rules panel is re-translated when the package words arrive late', async () => {
	const words: Record<string, string> = {};
	const translated: HTMLElement[] = [];
	const view = newView({
		isHost: () => true,
		t: (key: string) => words[key] ?? key,
		loadRules: async () => ({
			ruleGroups: [{ id: 'money', nameKey: 'rules.group.money' }],
			houseRules: [{ id: 'salary', group: 'money', type: 'toggle', default: true, nameKey: 'rules.salary' }],
		}) as any,
		saveRules: async () => {},
		// Stands in for the real translation pass: it resolves data-i18n in place.
		translateDom: element => {
			translated.push(element);
			element.querySelectorAll<HTMLElement>('[data-i18n]').forEach(node => {
				const text = words[node.getAttribute('data-i18n')!];
				if (text) node.textContent = text;
			});
		},
	});

	// The words are not there yet: a readable id reaches the screen, never the key.
	view.setTable(table({ packageToken: 'pkg' }));
	await new Promise(resolve => setTimeout(resolve, 0));
	const fields = document.getElementById('table-rules-fields')!;
	assert.doesNotMatch(fields.textContent ?? '', /rules\./, 'a translation key must never be shown');
	assert.equal(fields.querySelectorAll('[data-i18n]').length, 2, 'label and legend carry their keys');

	// They arrive, and the next authoritative table re-resolves what is already on screen — the
	// panel itself is NOT rebuilt, so nothing else may depend on rebuilding it.
	words['rules.salary'] = 'Salary';
	words['rules.group.money'] = 'Money';
	view.setTable(table({ packageToken: 'pkg' }));
	await new Promise(resolve => setTimeout(resolve, 0));
	assert.match(fields.textContent ?? '', /Salary/);
	assert.match(fields.textContent ?? '', /Money/);
	assert.ok(translated.length >= 2, 'every table re-resolves the panel, not only the first');
});

// The panel is ONE element and the view outlives every table shown in it — a player moves
// between tables without the page ever reloading. Wiring the save beside the render meant each
// new board added another listener to the same element, so one click on a rule sent as many
// identical writes as boards that host had seen.
test('a host who has seen three boards still saves a rule change once', async () => {
	const saved: Record<string, boolean | number | string>[] = [];
	const view = newView({
		isHost: () => true,
		loadRules: async () => ({ houseRules: [{ id: 'auctions', type: 'toggle', default: true }] }) as any,
		saveRules: async values => { saved.push(values); },
	});

	for (const packageToken of ['pkg-a', 'pkg-b', 'pkg-c']) {
		view.setTable(table({ packageToken }));
		await new Promise(resolve => setTimeout(resolve, 0));
	}

	const auctions = document.querySelector<HTMLInputElement>('#table-rules-fields [data-rule-id="auctions"]')!;
	auctions.checked = false;
	auctions.dispatchEvent(new (globalThis as any).window.Event('change', { bubbles: true }));
	await new Promise(resolve => setTimeout(resolve, 0));

	assert.equal(saved.length, 1);
	assert.equal(saved[0].auctions, false);
});

test('a guest is never shown the rule editor, and neither is a board that declares no rules', async () => {
	const guest = newView({ isHost: () => false, loadRules: async () => ({ houseRules: [] }) as any, saveRules: async () => {} });
	guest.setTable(table({ packageToken: 'pkg' }));
	await new Promise(resolve => setTimeout(resolve, 0));
	assert.equal((document.getElementById('table-rules') as HTMLElement).hidden, true);

	const host = newView({ isHost: () => true, loadRules: async () => ({ houseRules: [] }) as any, saveRules: async () => {} });
	host.setTable(table({ packageToken: 'pkg' }));
	await new Promise(resolve => setTimeout(resolve, 0));
	assert.equal((document.getElementById('table-rules') as HTMLElement).hidden, true);
});

// Three different goodbyes, named and offered as three different things: going back to the
// lobby keeps your seat, leaving gives it up for good, and deleting ends the table for everyone.
test('everyone may leave; only the host may end the table for the rest', () => {
	const offered = (id: string) => !!document.getElementById(id);

	const guest = newView({ isHost: () => false, backToLobby: () => {}, abandon: () => {}, deleteTable: () => {} });
	guest.show();
	assert.equal(offered('table-back'), true);
	assert.equal(offered('table-abandon'), true);
	assert.equal(offered('table-delete'), false, 'a guest cannot end the table');

	const host = newView({ isHost: () => true, backToLobby: () => {}, abandon: () => {}, deleteTable: () => {} });
	host.show();
	assert.equal(offered('table-delete'), true);
});

// The actions are DESCRIBED per render, not toggled in the markup: an action nobody is offered
// simply does not exist. Hiding a button that is always in the document leaves something behind to
// keep in sync by hand, and a screen reader counting the toolbar would count what is not there.
test('an action that is not offered is absent, not hidden', () => {
	const ids = () => Array.from(document.querySelectorAll('#table-actions button'))
		.map(button => (button as HTMLElement).dataset.actionId);

	const guest = newView({ isHost: () => false, backToLobby: () => {}, abandon: () => {}, deleteTable: () => {} });
	guest.show();
	assert.deepEqual(ids(), ['back', 'abandon'], 'a guest leaves; a guest does not start or delete');

	const host = newView({ isHost: () => true, backToLobby: () => {}, abandon: () => {}, deleteTable: () => {} });
	host.show();
	assert.deepEqual(ids(), ['start', 'back', 'abandon', 'delete']);
});

// The bargain of a toolbar: it is ONE tab stop, and the reader is told "toolbar" on the way in so
// they know the arrows mean something. That only holds if the arrows really move.
test('the actions are one tab stop, and the arrows move between them', () => {
	const view = newView({ isHost: () => true, backToLobby: () => {}, abandon: () => {}, deleteTable: () => {} });
	view.show();

	const bar = document.querySelector('#table-actions [role="toolbar"]') as HTMLElement;
	assert.ok(bar, 'the actions are exposed as a toolbar');
	assert.ok(bar.getAttribute('aria-label'), 'and it is named');

	const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('#table-actions button'));
	assert.deepEqual(buttons.map(b => b.tabIndex), [0, -1, -1, -1]);

	const press = (key: string) => bar.dispatchEvent(
		new (globalThis as any).window.KeyboardEvent('keydown', { key, bubbles: true }));
	press('ArrowRight');
	assert.deepEqual(buttons.map(b => b.tabIndex), [-1, 0, -1, -1]);
	press('End');
	assert.deepEqual(buttons.map(b => b.tabIndex), [-1, -1, -1, 0]);
	press('Home');
	assert.deepEqual(buttons.map(b => b.tabIndex), [0, -1, -1, -1]);
});

test('the three goodbyes call three different things', () => {
	const called: string[] = [];
	const view = newView({
		isHost: () => true,
		backToLobby: () => called.push('back'),
		abandon: () => called.push('abandon'),
		deleteTable: () => called.push('delete'),
	});
	view.show();

	(document.getElementById('table-back') as HTMLButtonElement).click();
	(document.getElementById('table-abandon') as HTMLButtonElement).click();
	(document.getElementById('table-delete') as HTMLButtonElement).click();

	assert.deepEqual(called, ['back', 'abandon', 'delete']);
});

// Reported live: seating a bot left the keyboard on <body> — "el foco desaparece y se va
// arriba". The chair is the act that can FILL the table, and a full table stops offering it, so
// the control the host had just used ceases to exist under them. Focus has to be handed on.
test('seating a bot hands the keyboard on, never drops it', () => {
	const chair = () => document.getElementById('table-add-bot') as HTMLButtonElement;
	const seatABot = () => chair().click();

	// Room left: another chair, because seating bots is usually done in a run.
	const view = newView({ isHost: () => true, addBot: () => {} });
	view.setTable(table({ gameType: 'property', maxPlayers: 4, players: [{ id: 'a', name: 'Ana', token: 'disc', isHost: true }] }));
	seatABot();
	view.setTable(table({
		gameType: 'property', maxPlayers: 4,
		players: [{ id: 'a', name: 'Ana', token: 'disc', isHost: true }, { id: 'b', name: 'Bot', token: 'star', isBot: true }],
	}));
	assert.equal(document.activeElement, chair(), 'still room, so the next bot is one key away');

	// The bot that fills the table takes the chair away with it: the keyboard goes to the match.
	seatABot();
	view.setTable(table({
		gameType: 'property', maxPlayers: 2,
		players: [{ id: 'a', name: 'Ana', token: 'disc', isHost: true }, { id: 'b', name: 'Bot', token: 'star', isBot: true }],
	}));
	assert.equal(chair().hidden, true, 'a full table offers no chair');
	assert.equal(document.activeElement, document.getElementById('table-start-btn'),
		'and the keyboard lands on what the table was being filled FOR');
});

test('the host can hand the sceptre to another person, and to nobody else', () => {
	const promoted: string[] = [];
	const view = newView({ isHost: () => true, makeHost: async id => { promoted.push(id); } });

	view.setTable(table({
		players: [
			{ id: 'a', name: 'Ana', token: 'disc', isHost: true },
			{ id: 'b', name: 'Berto', token: 'star' },
			{ id: 'bot', name: 'Crupier', token: 'moon', isBot: true },
		],
	}));

	const buttons = document.querySelectorAll<HTMLButtonElement>('#table-players .player-item__make-host');
	// Not on the host's own row (they already hold it), and never on a bot's.
	assert.equal(buttons.length, 1);
	buttons[0].click();
	assert.deepEqual(promoted, ['b']);
});

test('a guest is never offered the sceptre to hand out', () => {
	const view = newView({ isHost: () => false, makeHost: async () => {} });

	view.setTable(table({
		players: [
			{ id: 'a', name: 'Ana', token: 'disc', isHost: true },
			{ id: 'b', name: 'Berto', token: 'star' },
		],
	}));

	assert.equal(document.querySelectorAll('#table-players .player-item__make-host').length, 0);
});

test('a guest is told what they are waiting for instead of being given a dead button', () => {
	const hint = () => document.getElementById('table-waiting-host') as HTMLElement;

	newView({ isHost: () => false }).show();
	assert.equal(hint().hidden, false);

	newView({ isHost: () => true }).show();
	assert.equal(hint().hidden, true);
});

test('only the host is offered the next match, and the control is absent for everyone else', () => {
	// Absent, not disabled: a dead button in the tab order is noise, and there is nothing to
	// explain to a player who simply is not the host.
	const guest = newView({ isHost: () => false });
	guest.show();
	assert.equal(document.getElementById('table-start-btn'), null);

	const host = newView({ isHost: () => true });
	host.show();
	assert.ok(document.getElementById('table-start-btn'));
});

test('starting the next match asks the server, and says so out loud when it refuses', async () => {
	let asked = 0;
	const spoken: string[] = [];
	const view = newView({
		isHost: () => true,
		start: async () => { asked++; throw new Error('GAME_ALREADY_STARTED'); },
		announce: key => spoken.push(key),
	});
	view.show();

	(document.getElementById('table-start-btn') as HTMLButtonElement).click();
	await new Promise(resolve => setTimeout(resolve, 0));

	assert.equal(asked, 1);
	// Failing silently would leave the host pressing a button with no idea why nothing happens.
	assert.deepEqual(spoken, ['table.start_failed']);
});

test('a refusal the server explained is spoken as ITS reason, not as a generic failure', async () => {
	// "Somebody still has no team" is the whole point of the message; "it could not be started"
	// tells the host nothing they can act on.
	const spoken: string[] = [];
	const view = newView({
		isHost: () => true,
		start: async () => { throw new Error('TEAMS_INCOMPLETE'); },
		explainError: () => 'Somebody still has no team',
		announce: text => spoken.push(text),
	});
	view.show();

	(document.getElementById('table-start-btn') as HTMLButtonElement).click();
	await new Promise(resolve => setTimeout(resolve, 0));

	assert.deepEqual(spoken, ['Somebody still has no team']);
});

test('the code and the link that bring someone else show only when there is one to pass on', () => {
	const view = newView();
	const copyCode = document.getElementById('table-copy-code') as HTMLButtonElement;
	const copyLink = document.getElementById('table-copy-link') as HTMLButtonElement;

	view.setTable(table({ inviteCode: 'ABCD' }));
	assert.equal(document.getElementById('table-code')!.textContent, 'ABCD');
	assert.match(document.getElementById('table-invite-url')!.textContent ?? '', /\?code=ABCD$/);
	assert.equal(copyCode.hidden, false);
	assert.equal(copyLink.hidden, false);

	view.setTable(table({ inviteCode: '' }));
	assert.equal(document.getElementById('table-code')!.textContent, '');
	assert.equal(document.getElementById('table-invite-url')!.textContent, '');
	assert.equal(copyCode.hidden, true);
	assert.equal(copyLink.hidden, true);
});

/**
 * Asking somebody to the table.
 *
 * Knowing the name and knowing only that somebody is about are the same task from a keyboard, so
 * they are the same control: ONE listbox that opens showing everyone available and narrows as the
 * name is typed. The alternative — a field and a separate list — makes the common case a trip
 * between two controls.
 *
 * Who qualifies is the SERVER's answer (connected, visible to this player, open to invitations).
 * Nothing here re-decides it; this only shows what came back and filters by what was typed.
 */

/** A table with a free seat, which is what makes the invite controls appear at all. */
function invitableTable(): any {
	return table({
		status: 'waiting_for_players',
		players: [{ id: 'a', name: 'Ana', token: 'red_hat', isHost: true, isReady: true }],
		maxPlayers: 4,
	});
}

function withPicker(people: string[], invited: string[] = []) {
	const view = newView({
		invite: async handle => void invited.push(handle),
		invitablePlayers: async () => people,
		inviteMatchCount: count => `${count} found`,
	});
	view.setTable(invitableTable());
	return view;
}

/** Lets the picker's fetch settle — it is asked for on wiring, not awaited by setTable. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('the picker opens showing everyone who could come, as a real list', async () => {
	withPicker(['ana', 'anabel', 'berto']);
	await settle();

	const list = document.getElementById('table-invite-people')!;
	assert.equal(document.getElementById('table-invite-people-block')!.hidden, false);
	assert.equal(list.getAttribute('role'), 'listbox');
	const options = Array.from(list.querySelectorAll('[role="option"]'));
	assert.deepEqual(options.map(o => o.textContent), ['ana', 'anabel', 'berto']);
	// One tab stop, and the first is the one a reader is told about.
	assert.deepEqual(options.map(o => (o as HTMLElement).tabIndex), [0, -1, -1]);
	assert.deepEqual(options.map(o => o.getAttribute('aria-selected')), ['true', 'false', 'false']);
});

// It came with the view rather than being asked for; announcing it would talk over whatever
// brought the player here.
test('the list that simply appears says nothing; the one that narrows says how many', async () => {
	withPicker(['ana', 'anabel', 'berto']);
	await settle();
	const status = document.getElementById('table-invite-status')!;
	assert.equal(status.textContent, '');

	const input = document.getElementById('table-invite-handle') as HTMLInputElement;
	input.value = 'an';
	input.dispatchEvent(new window.Event('input'));

	assert.equal(status.textContent, '2 found');
	assert.deepEqual(
		Array.from(document.querySelectorAll('#table-invite-people [role="option"]'))
			.map(o => o.textContent),
		['ana', 'anabel']);
});

test('typing narrows the same list rather than replacing it, and matching is case-blind', async () => {
	withPicker(['ana', 'anabel', 'berto']);
	await settle();
	const input = document.getElementById('table-invite-handle') as HTMLInputElement;

	input.value = 'BER';
	input.dispatchEvent(new window.Event('input'));
	assert.deepEqual(
		Array.from(document.querySelectorAll('#table-invite-people [role="option"]'))
			.map(o => o.textContent),
		['berto']);

	// Clearing it brings everyone back: the browse list is the same list.
	input.value = '';
	input.dispatchEvent(new window.Event('input'));
	assert.equal(document.querySelectorAll('#table-invite-people [role="option"]').length, 3);
});

test('Down walks in from the field, and choosing invites without typing a name', async () => {
	const invited: string[] = [];
	withPicker(['ana', 'berto'], invited);
	await settle();
	const input = document.getElementById('table-invite-handle') as HTMLInputElement;

	input.dispatchEvent(new window.KeyboardEvent(
		'keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
	const options = Array.from(document.querySelectorAll<HTMLElement>('#table-invite-people [role="option"]'));
	assert.equal(document.activeElement, options[0]);

	options[0].dispatchEvent(new window.KeyboardEvent(
		'keydown', { key: 'Enter', bubbles: true, cancelable: true }));
	assert.deepEqual(invited, ['ana']);
});

// Dismissing the list once must not take the browse half away for good.
test('Down reopens a list that Escape closed', async () => {
	withPicker(['ana', 'berto']);
	await settle();
	const input = document.getElementById('table-invite-handle') as HTMLInputElement;
	const list = document.getElementById('table-invite-people')!;

	input.dispatchEvent(new window.KeyboardEvent(
		'keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
	const first = list.querySelector<HTMLElement>('[role="option"]')!;
	first.dispatchEvent(new window.KeyboardEvent(
		'keydown', { key: 'Escape', bubbles: true, cancelable: true }));
	assert.equal(list.hidden, true);

	input.dispatchEvent(new window.KeyboardEvent(
		'keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
	assert.equal(list.hidden, false);
	assert.equal(list.querySelectorAll('[role="option"]').length, 2);
});

// Typing a name the server never offered still works: somebody present but hidden is invitable and
// will never appear here. The two ways answer different questions.
test('the field still sends a name that is not in the list', async () => {
	const invited: string[] = [];
	withPicker(['ana'], invited);
	await settle();
	const input = document.getElementById('table-invite-handle') as HTMLInputElement;

	input.value = 'somebodyHidden';
	input.dispatchEvent(new window.KeyboardEvent(
		'keydown', { key: 'Enter', bubbles: true, cancelable: true }));

	assert.deepEqual(invited, ['somebodyHidden']);
});

// An empty list with a heading is a stop that answers nothing.
test('nobody to offer means no block at all, and the field still works', async () => {
	withPicker([]);
	await settle();

	assert.equal(document.getElementById('table-invite-people-block')!.hidden, true);
	assert.equal(document.getElementById('table-invite-someone')!.hidden, false);
});
