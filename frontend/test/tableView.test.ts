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
function mount(): { table: HTMLElement; game: HTMLElement } {
	document.body.innerHTML = `
		<section id="table-view" hidden>
			<h2 id="table-heading" tabindex="-1">At the table</h2>
			<p><strong id="table-code"></strong>
			<button type="button" id="table-copy-code" hidden>Copy code</button></p>
			<ul id="table-players"></ul>
			<button type="button" id="table-start-btn" hidden>Start</button>
		</section>
		<p id="game-surface-intro">Focus will move to your hand.</p>
		<div id="game-layout"></div>`;
	return {
		table: document.getElementById('table-view') as HTMLElement,
		game: document.getElementById('game-layout') as HTMLElement,
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
	const { table, game } = { table: document.getElementById('table-view')!, game: document.getElementById('game-layout')! };
	const view = newView();

	const intro = document.getElementById('game-surface-intro') as HTMLElement;

	view.show();
	assert.equal(table.hidden, false);
	assert.equal(game.hidden, true, 'the board must not sit behind the table');
	assert.equal(intro.hidden, true, 'no telling people where focus goes in a game that is not running');

	view.hide();
	assert.equal(table.hidden, true);
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

	view.setPlayers([
		{ id: 'a', name: 'Ana', token: 'disc', isHost: true } as any,
		{ id: 'b', name: 'Berto', token: 'star', isBot: true } as any,
	]);

	const items = document.querySelectorAll('#table-players .player-item');
	assert.equal(items.length, 2);
	const first = items[0].textContent ?? '';
	assert.match(first, /Ana/);
	assert.match(first, /lobby\.playerHost/, 'the host is named as such');
	assert.match(items[1].textContent ?? '', /lobby\.playerBot/);
});

test('a rebuilt roster replaces the previous one instead of piling up', () => {
	const view = newView();

	view.setPlayers([{ id: 'a', name: 'Ana', token: 'disc' } as any]);
	view.setPlayers([
		{ id: 'a', name: 'Ana', token: 'disc' } as any,
		{ id: 'b', name: 'Berto', token: 'star' } as any,
	]);

	assert.equal(document.querySelectorAll('#table-players .player-item').length, 2);
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

test('the invite code shows only when there is one to pass on', () => {
	const view = newView();
	const copy = document.getElementById('table-copy-code') as HTMLButtonElement;

	view.setInviteCode('ABCD');
	assert.equal(document.getElementById('table-code')!.textContent, 'ABCD');
	assert.equal(copy.hidden, false);

	view.setInviteCode(null);
	assert.equal(document.getElementById('table-code')!.textContent, '');
	assert.equal(copy.hidden, true);
});
