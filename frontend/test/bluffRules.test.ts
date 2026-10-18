import test from 'node:test';
import assert from 'node:assert/strict';
import {
	bluffBallotComplete,
	bluffCanWrite,
	bluffDutyText,
	bluffFunnyOptions,
	bluffMyBallot,
	bluffNowPlayingText,
	bluffOptionLabel,
	bluffPlace,
	bluffProgressText,
	bluffRevealLines,
	bluffRivalStatus,
	bluffStandings,
	bluffStatusText,
} from '../src/bluffRules.js';
import type { BluffBallotState, BluffPhase, GameState } from '../src/models.js';
import { installFakeI18next, setupDom } from './helpers/dom.js';

setupDom();
installFakeI18next('en');

const translate = (key: string, vars?: Record<string, unknown>) =>
	(globalThis as any).window.i18next.t(key, vars);

function player(id: string, name: string) {
	return { id, name, token: 'seat', position: 0, money: 0, properties: [], releasePasses: 0 };
}

function ballot(playerId: string, extra: Partial<BluffBallotState> = {}): BluffBallotState {
	return {
		playerId,
		options: [
			{ index: 0, text: 'The Moon', key: '' },
			{ index: 1, text: 'A tortoise', key: '' },
			{ index: 2, text: 'Mars', key: '' },
		],
		asksFunny: true,
		truthKnown: false,
		truthPick: null,
		funnyPick: null,
		...extra,
	};
}

function gameState(phase: BluffPhase = 'writing', overrides: Record<string, unknown> = {}): GameState {
	return {
		gameType: 'bluff',
		players: [player('p0', 'Ada'), player('p1', 'Berto'), player('p2', 'Cora')],
		bank: { money: 0 },
		currentTurn: null,
		ownership: [],
		squares: [],
		bluffRules: { writeSeconds: 45, voteSeconds: 30, rounds: 3, truthPoints: 1000, foolPoints: 500, ballotSize: 7, finalists: 6 },
		bluff: {
			players: [
				{ playerId: 'p0', score: 0 },
				{ playerId: 'p1', score: 1500 },
				{ playerId: 'p2', score: 500 },
			],
			masterId: 'p0',
			questionCursor: 1,
			roundsToPlay: 3,
			round: {
				roundNumber: 2,
				questionId: 'q1',
				question: 'An octopus has ___ hearts.',
				truth: '',
				phase,
				startedAt: phase === 'writing' ? new Date().toISOString() : null,
				durationSeconds: 45,
				entries: [
					{ playerId: 'p0', text: '', finished: false },
					{ playerId: 'p1', text: 'two', finished: true },
					{ playerId: 'p2', text: '', finished: false },
				],
				lies: [],
				ballots: [],
				hasFinal: false,
				finalBallots: [],
				truthFinderIds: [],
				finalTruthFinderIds: [],
				reveal: null,
				pendingCount: 2,
				...overrides,
			},
		},
	} as unknown as GameState;
}

test('the headline names the round, the total and whoever runs the table', () => {
	assert.equal(bluffNowPlayingText(gameState('preparing'), 'p1', translate), 'Round 2 of 3. Ada opens it when everyone is in.');
	assert.equal(bluffNowPlayingText(gameState('preparing'), 'p0', translate), 'Round 2 of 3. You open it when everyone is in.');
	assert.equal(bluffNowPlayingText(gameState('writing'), 'p0', translate), 'Round 2 of 3: everybody is writing a tall tale.');
	assert.equal(bluffNowPlayingText(gameState('final_voting'), 'p1', translate), 'Round 2 of 3: the final vote is open.');
	assert.match(bluffNowPlayingText(gameState('reveal'), 'p0', translate)!, /You move on/);
});

test('the duty follows the phase, the job and the state of my own ballot', () => {
	assert.match(bluffDutyText(gameState('preparing'), 'p0', translate)!, /^Start the round/);
	assert.match(bluffDutyText(gameState('preparing'), 'p1', translate)!, /Ada starts the round/);
	assert.match(bluffDutyText(gameState('writing'), 'p0', translate)!, /^Write one tall tale/);
	assert.match(bluffDutyText(gameState('writing'), 'p1', translate)!, /is in\. Wait/);

	const voting = gameState('voting', { ballots: [ballot('p0')] });
	assert.match(bluffDutyText(voting, 'p0', translate)!, /take for the truth/);
	assert.match(bluffDutyText(voting, 'p1', translate)!, /no ballot/);
	const halfway = gameState('voting', { ballots: [ballot('p0', { truthPick: 1 })] });
	assert.match(bluffDutyText(halfway, 'p0', translate)!, /funniest/);
	const done = gameState('voting', { ballots: [ballot('p0', { truthPick: 1, funnyPick: 2 })] });
	assert.match(bluffDutyText(done, 'p0', translate)!, /ballot is in/);
	const known = gameState('final_voting', { finalBallots: [ballot('p0', { truthKnown: true, asksFunny: false })] });
	assert.match(bluffDutyText(known, 'p0', translate)!, /already found the truth/);
	assert.match(bluffDutyText(gameState('reveal'), 'p1', translate)!, /Ada moves on/);
});

test('progress is the server count and never a guess', () => {
	assert.equal(bluffProgressText(gameState('writing'), translate), 'Players still writing: 2.');
	assert.equal(bluffProgressText(gameState('writing', { pendingCount: 0 }), translate), 'Everyone has finished writing.');
	assert.equal(bluffProgressText(gameState('voting', { pendingCount: 5 }), translate), 'Players still voting: 5.');
	assert.equal(bluffProgressText(gameState('reveal'), translate), null);
});

test('standings rank by score and status sentences carry the place', () => {
	const gs = gameState();
	assert.deepEqual(bluffStandings(gs.bluff!).map(p => p.playerId), ['p1', 'p2', 'p0']);
	assert.equal(bluffPlace(gs.bluff!, 'p0'), 3);
	assert.equal(bluffStatusText(gs, 'p2', translate), '500 points, in place 2 of 3.');
	assert.equal(bluffRivalStatus(gs, 'p1', translate), 'Cora: 500 points. Ada: 0 points.');
});

test('a ballot line is its number and its text, and the funniest question drops the truth pick', () => {
	assert.equal(bluffOptionLabel({ index: 2, text: 'Mars' }, translate), '3: Mars');
	const marked = ballot('p0', { truthPick: 1 });
	assert.deepEqual(bluffFunnyOptions(marked).map(o => o.index), [0, 2]);
	assert.equal(bluffBallotComplete(marked), false);
	assert.equal(bluffBallotComplete({ ...marked, funnyPick: 0 }), true);
	assert.equal(bluffBallotComplete(ballot('p0', { asksFunny: false, truthPick: 0 })), true);
	assert.equal(bluffMyBallot(gameState('voting', { ballots: [ballot('p0')] }).bluff!.round, 'p0')?.playerId, 'p0');
	assert.equal(bluffMyBallot(gameState('voting', { ballots: [ballot('p0')] }).bluff!.round, 'p1'), null);
});

test('only an unfinished entry during the writing clock can still write', () => {
	assert.equal(bluffCanWrite(gameState('writing').bluff!.round, 'p0'), true);
	assert.equal(bluffCanWrite(gameState('writing').bluff!.round, 'p1'), false);
	assert.equal(bluffCanWrite(gameState('voting').bluff!.round, 'p0'), false);
});

test('the reveal reads as sentences: the truth, the best tale with its authors, and my own result', () => {
	const gs = gameState('reveal', {
		truth: 'three',
		lies: [
			{ id: 'l1', text: 'two', authorIds: ['p1', 'p2'], shownCount: 1, believerIds: ['p0'], funnyVoterIds: [], finalist: false, finalBelieverIds: [] },
			{ id: 'l2', text: 'none, it runs on vibes', authorIds: ['p0'], shownCount: 2, believerIds: [], funnyVoterIds: ['p1', 'p2'], finalist: false, finalBelieverIds: [] },
		],
		reveal: {
			truthFinderCount: 2,
			bestLieId: 'l1',
			funniestLieId: 'l2',
			results: [
				{ playerId: 'p0', foundTruth: false, truthPoints: 0, fooledCount: 0, foolPoints: 0, shownCount: 2, total: 0 },
				{ playerId: 'p1', foundTruth: true, truthPoints: 1000, fooledCount: 1, foolPoints: 250, shownCount: 1, total: 1750 },
			],
		},
	});

	assert.deepEqual(bluffRevealLines(gs, 'p1', translate), [
		'The truth was three. Players who found it: 2.',
		'The most believed tall tale was two, by Berto and 1 more: it fooled 1.',
		'The funniest was none, it runs on vibes, by Ada, with 2 votes.',
		'You found the truth for 1000 points, and your tall tale fooled 1 of the 1 who saw it, for 250 more. Total: 1750.',
	]);
	assert.match(bluffRevealLines(gs, 'p0', translate)[3], /^You missed the truth, and your tall tale fooled nobody/);
	assert.deepEqual(bluffRevealLines(gameState('writing'), 'p0', translate), []);
});
