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
			<p><strong id="table-code"></strong>
			<button type="button" id="table-copy-code" hidden>Copy code</button></p>
			<p><span id="table-invite-url"></span>
			<button type="button" id="table-copy-link" hidden>Copy link</button></p>
			<div id="table-rejoin-mount"></div>
			<div id="table-content-language-group" hidden>
				<select id="table-content-language"></select>
			</div>
			<p id="table-content-language-current" hidden></p>
			<ul id="table-players"></ul>
			<button type="button" id="table-add-bot" hidden>Add a bot</button>
			<button type="button" id="table-start-btn" hidden>Start</button>
			<span id="table-waiting-host" hidden>Waiting for the host</span>
			<button type="button" id="table-leave">Leave</button>
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
	assert.equal((document.getElementById('table-start-btn') as HTMLButtonElement).hidden, true);

	const host = newView({ isHost: () => true });
	host.show();
	assert.equal((document.getElementById('table-start-btn') as HTMLButtonElement).hidden, false);
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
