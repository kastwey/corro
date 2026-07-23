import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeI18next, setupDom } from './helpers/dom.js';
import {
	joinVisualNarrative, visualMetaForAnnouncement, visualNarrative,
} from '../src/visualNarrative.js';
import { visualNarrativePolicyForAnnouncement } from '../src/visualNarrativePolicy.js';
import type { GameState } from '../src/models.js';

let state: GameState;

before(() => {
	setupDom();
	installFakeI18next('en', {
		'cards.future_one': 'First card',
		'cards.future_two': 'Second card',
		'cards.future_three': 'Third card',
		'game.journey_drew_self': 'You draw:',
	});
});

beforeEach(() => {
	document.body.innerHTML = '<main><div id="board"><div class="exploding-toolbar"></div></div></main>';
	state = {
		gameType: 'exploding',
		players: [
			{ id: 'a', name: 'Ana', token: 'a', position: 0, money: 0, properties: [], releasePasses: 0 },
			{ id: 'b', name: 'Berto', token: 'b', position: 0, money: 0, properties: [], releasePasses: 0 },
		],
		bank: { money: 0 }, currentTurn: 'a', ownership: [], squares: [],
		explodingDeck: [
			{ id: 'one', type: 'skip', count: 1, nameKey: 'cards.future_one' },
			{ id: 'two', type: 'attack', count: 1, nameKey: 'cards.future_two' },
			{ id: 'three', type: 'favor', count: 1, nameKey: 'cards.future_three' },
		],
	};
	visualNarrative.init({ getGameState: () => state, getMyPlayerId: () => 'a' });
});

const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));

test('parses only reserved flat visual metadata, including private peek identities', () => {
	const meta = visualMetaForAnnouncement({
		key: 'game.exploding_future_3',
		vars: {
			visualKind: 'cards-peek', visualSourcePlayerId: 'a', visualCount: 3,
			visualCard1Id: 'one', visualCard2Id: 'two', visualCard3Id: 'three',
		},
	});
	assert.deepEqual(meta, {
		kind: 'cards-peek', tone: null, sourcePlayerId: 'a', targetPlayerId: null,
		cardId: null, cardType: null, count: 3, cardIds: ['one', 'two', 'three'],
		from: null, to: null,
	});
	assert.equal(visualMetaForAnnouncement({ key: 'game.turn_of', vars: {} }), null);
});

test('Property reuses the shared persistent policy instead of the transient toast', async () => {
	document.body.innerHTML = '<main><div class="board-frame"><div id="board"><div class="board-center" aria-hidden="true"></div></div></div></main>';
	state = { ...state, gameType: 'property' };
	visualNarrative.init({ getGameState: () => state, getMyPlayerId: () => 'a' });
	assert.deepEqual(visualNarrativePolicyForAnnouncement('game.rent_paid_self'),
		{ kind: 'outcome', tone: 'loss' });

	visualNarrative.playForAnnouncement({
		key: 'game.rent_paid',
		vars: { player: 'Ana', amount: 50, landlord: 'Berto' },
	});
	await settle();

	const stage = document.querySelector<HTMLElement>('.board-center > .visual-narrative--property')!;
	assert.ok(stage);
	assert.ok(stage.classList.contains('visual-narrative--loss'));
	assert.match(stage.textContent ?? '', /Ana.*50.*Berto/);
	assert.equal(document.querySelector('.board-toast'), null);
});

test('frequent Property chatter does not replace the latest salient action', () => {
	assert.equal(visualNarrativePolicyForAnnouncement('game.dice_rolled'), null);
	assert.equal(visualNarrativePolicyForAnnouncement('game.turn_of'), null);
	assert.equal(visualNarrativePolicyForAnnouncement('game.landed_on_property'), null);
});

test('joins a server batch into one flowing visible sentence', () => {
	assert.equal(joinVisualNarrative(['You play a card!', 'Berto draws 3 cards.']),
		'You play a card! Berto draws 3 cards.');
	assert.equal(joinVisualNarrative([]), '');
});

test('keeps a persistent aria-hidden action stage and names the route', async () => {
	visualNarrative.playForAnnouncement({
		key: 'game.exploding_attacked_self',
		vars: {
			visualKind: 'attack', visualSourcePlayerId: 'a', visualTargetPlayerId: 'b',
			visualCount: 2,
		},
	});
	await settle();

	const stage = document.querySelector<HTMLElement>('.visual-narrative')!;
	assert.ok(stage);
	assert.equal(stage.getAttribute('aria-hidden'), 'true');
	assert.match(stage.querySelector('.visual-narrative__message')!.textContent!, /You attack/);
	assert.equal(stage.querySelector('.visual-narrative__route')!.textContent, 'From Ana to Berto.');
	assert.equal(document.activeElement, document.body);
});

test('renders the peeker\'s three package-neutral card faces as a persistent fan', async () => {
	visualNarrative.playForAnnouncement({
		key: 'game.exploding_future_3',
		vars: {
			card1: 'cards.future_one', card2: 'cards.future_two', card3: 'cards.future_three',
			visualKind: 'cards-peek', visualSourcePlayerId: 'a', visualCount: 3,
			visualCard1Id: 'one', visualCard2Id: 'two', visualCard3Id: 'three',
		},
	});
	await settle();

	const cards = document.querySelectorAll('.visual-narrative__peek-card .xcard');
	assert.equal(cards.length, 3);
	assert.equal(document.querySelectorAll('.visual-narrative__peek-card .xcard--back').length, 0);
});

test('renders a journey private draw as a featured journey card', async () => {
	document.body.innerHTML = '<main><div id="board"><div class="journey-toolbar"></div></div></main>';
	state = {
		...state,
		gameType: 'journey',
		journeyDeck: [
			{ id: 'spare', type: 'immunity', value: 0, count: 1, nameKey: 'cards.future_one' },
		],
	};
	visualNarrative.init({ getGameState: () => state, getMyPlayerId: () => 'a' });
	visualNarrative.playForAnnouncement({
		key: 'game.journey_drew_self',
		vars: {
			visualKind: 'card-draw', visualTargetPlayerId: 'a',
			visualCardId: 'spare', visualCardType: 'immunity',
		},
	});
	visualNarrative.playForAnnouncement({
		key: 'cards.future_one', vars: { visualKind: 'detail' },
	});
	await settle();

	const stage = document.querySelector<HTMLElement>('.visual-narrative--journey')!;
	assert.match(stage.textContent ?? '', /You draw.*First card/);
	assert.equal(stage.querySelectorAll('.visual-narrative__card .jcard').length, 1);
});

test('a restarted target emphasis cannot be cleared by the previous timeout', () => {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const callbacks = new Map<number, () => void>();
	const cleared: number[] = [];
	let nextId = 1;
	const originalSetTimeout = window.setTimeout;
	const originalClearTimeout = window.clearTimeout;
	window.setTimeout = ((callback: TimerHandler) => {
		const id = nextId++;
		callbacks.set(id, callback as () => void);
		return id;
	}) as typeof window.setTimeout;
	window.clearTimeout = ((id?: number) => {
		if (id !== undefined) cleared.push(id);
	}) as typeof window.clearTimeout;
	try {
		(visualNarrative as any).highlight(target);
		const first = nextId - 1;
		(visualNarrative as any).highlight(target);
		const second = nextId - 1;
		assert.deepEqual(cleared, [first]);
		callbacks.get(first)?.();
		assert.ok(target.classList.contains('visual-narrative-target'));
		callbacks.get(second)?.();
		assert.ok(!target.classList.contains('visual-narrative-target'));
	} finally {
		window.setTimeout = originalSetTimeout;
		window.clearTimeout = originalClearTimeout;
	}
});
