import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';

// Module under test is imported dynamically AFTER the jsdom globals are installed,
// because ui.ts references `document`/`window` at call time.
let showView: typeof import('../src/lobby/ui.js').showView;
let LOBBY_VIEWS: typeof import('../src/lobby/ui.js').LOBBY_VIEWS;
let lobbyViewFromState: typeof import('../src/lobby/ui.js').lobbyViewFromState;

/** Build the four-view skeleton the real index.html ships, minimally. */
function renderViews(): void {
	document.body.innerHTML = `
		<section id="view-home" class="lobby-view">
			<h2 id="home-heading" data-view-heading tabindex="-1">Your games</h2>
		</section>
		<section id="view-create" class="lobby-view hidden" hidden>
			<h2 id="create-heading" data-view-heading tabindex="-1">Create</h2>
		</section>
		<section id="view-join" class="lobby-view hidden" hidden>
			<h2 id="join-heading" data-view-heading tabindex="-1">Join</h2>
		</section>
		<section id="view-waiting" class="lobby-view hidden" hidden>
			<div id="game-created-message" tabindex="-1">Created</div>
		</section>`;
}

const isShown = (id: string) => {
	const el = document.getElementById(id)!;
	return !el.classList.contains('hidden') && !(el as HTMLElement).hidden;
};

before(async () => {
	setupDom();
	({ showView, LOBBY_VIEWS, lobbyViewFromState } = await import('../src/lobby/ui.js'));
});

beforeEach(() => renderViews());

test('showView reveals exactly one view and hides the rest (class + attribute)', () => {
	showView('view-create');
	assert.ok(isShown('view-create'));
	for (const id of LOBBY_VIEWS) {
		if (id === 'view-create') continue;
		const el = document.getElementById(id)!;
		assert.ok(el.classList.contains('hidden'), `${id} keeps .hidden`);
		assert.ok((el as HTMLElement).hidden, `${id} keeps the hidden attribute`);
	}
});

test('switching views toggles visibility back and forth', () => {
	showView('view-join');
	assert.ok(isShown('view-join'));
	assert.ok(!isShown('view-home'));

	showView('view-home');
	assert.ok(isShown('view-home'));
	assert.ok(!isShown('view-join'));
});

test('showView focuses the view heading for screen-reader context', () => {
	showView('view-create');
	assert.equal(document.activeElement?.id, 'create-heading');
});

test('showView focuses an explicit target when given (waiting room success message)', () => {
	showView('view-waiting', 'game-created-message');
	assert.equal(document.activeElement?.id, 'game-created-message');
});

test('a missing view id does not throw and still hides the others', () => {
	assert.doesNotThrow(() => showView('view-waiting'));
	assert.ok(isShown('view-waiting'));
	assert.ok(!isShown('view-home'));
});

// Regression: the lobby is a single page, so a browser Back from the create/join form used to
// walk off the site. Each forward step now pushes a tagged history entry; on popstate this maps
// the entry back to a view. Untagged entries (initial load, the {gameId} entry) must fall to home
// so Back from create/join lands on the games list.
test('lobbyViewFromState maps a tagged entry back to its view', () => {
	assert.equal(lobbyViewFromState({ lobbyView: 'view-create' }), 'view-create');
	assert.equal(lobbyViewFromState({ lobbyView: 'view-join' }), 'view-join');
	assert.equal(lobbyViewFromState({ lobbyView: 'view-home' }), 'view-home');
});

test('lobbyViewFromState falls back to home for untagged or foreign entries', () => {
	assert.equal(lobbyViewFromState(null), 'view-home', 'the initial history entry has null state');
	assert.equal(lobbyViewFromState({ gameId: 'abc' }), 'view-home', 'the game-URL entry is not a lobby view');
	assert.equal(lobbyViewFromState({ lobbyView: 'view-nonsense' }), 'view-home', 'an unknown view id is ignored');
	assert.equal(lobbyViewFromState(undefined), 'view-home');
});
