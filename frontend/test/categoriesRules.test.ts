import test from 'node:test';
import assert from 'node:assert/strict';
import {
	categoriesAnswerLabel,
	categoriesCanWrite,
	categoriesDutyText,
	categoriesNowPlayingText,
	categoriesProgressText,
	categoriesRivalStatus,
	categoriesRole,
	categoriesStatusText,
	categoriesSuggestedVerdicts,
	categoriesWriters,
} from '../src/categoriesRules.js';
import type { CategoriesAnswerState, CategoriesRoundPhase, GameState } from '../src/models.js';
import { installFakeI18next, setupDom } from './helpers/dom.js';

setupDom();
installFakeI18next('en');

const translate = (key: string, vars?: Record<string, unknown>) =>
	(globalThis as any).window.i18next.t(key, vars);

function player(id: string, name: string) {
	return { id, name, token: id, position: 0, money: 0, properties: [], releasePasses: 0 };
}

function answer(playerId: string, text: string, extra: Partial<CategoriesAnswerState> = {}): CategoriesAnswerState {
	return {
		playerId,
		text,
		verdict: 'pending',
		duplicateGroup: -1,
		matchesLetter: true,
		...extra,
	};
}

function gameState(phase: CategoriesRoundPhase = 'writing', overrides: Record<string, unknown> = {}): GameState {
	return {
		gameType: 'categories',
		players: [player('p0', 'Ada'), player('p1', 'Berto'), player('p2', 'Cora')],
		bank: { money: 0 },
		currentTurn: 'p0',
		ownership: [],
		squares: [],
		categoriesRules: { roundSeconds: 120, categoriesPerRound: 2, pointsPerAnswer: 1, cycles: 1 },
		categories: {
			players: [
				{ playerId: 'p0', score: 3, roundsJudged: 0 },
				{ playerId: 'p1', score: 5, roundsJudged: 0 },
				{ playerId: 'p2', score: 1, roundsJudged: 0 },
			],
			cycle: 1,
			categoryCursor: 2,
			letterCursor: 1,
			round: {
				roundNumber: 1,
				judgeId: 'p0',
				// As the server projects it: the letter is withheld until the clock starts.
				letter: phase === 'preparing' ? '' : 'R',
				phase,
				startedAt: null,
				durationSeconds: 120,
				finishedWriterIds: [],
				reviewIndex: 0,
				prompts: [
					{
						categoryId: 'animal',
						name: 'An animal',
						answers: [answer('p1', 'rabbit'), answer('p2', 'rat')],
					},
					{
						categoryId: 'city',
						name: 'A city',
						answers: [answer('p1', 'Rome'), answer('p2', '')],
					},
				],
				...overrides,
			},
		},
	} as unknown as GameState;
}

test('the only role is the judge, and everybody else writes', () => {
	const gs = gameState();

	assert.equal(categoriesRole(gs.categories!.round, 'p0'), 'judge');
	assert.equal(categoriesRole(gs.categories!.round, 'p2'), 'writer');
	assert.deepEqual(categoriesWriters(gs.categories!), ['p1', 'p2']);
});

test('the round headline names the round, the letter and the judge, in the first person for them', () => {
	const gs = gameState('writing');

	const forJudge = categoriesNowPlayingText(gs, 'p0', translate)!;
	const forWriter = categoriesNowPlayingText(gs, 'p1', translate)!;

	assert.match(forJudge, /Round 1/);
	assert.match(forJudge, /\bR\b/);
	assert.match(forJudge, /by you/i);
	assert.match(forWriter, /Ada/);
	// One flowing sentence: no visual separators a screen reader would not speak.
	for (const line of [forJudge, forWriter]) {
		assert.equal(/[·|]/.test(line), false, line);
	}
});

test('the headline of a round still being prepared names no letter, because there is none yet', () => {
	const gs = gameState('preparing');

	const forJudge = categoriesNowPlayingText(gs, 'p0', translate)!;
	const forWriter = categoriesNowPlayingText(gs, 'p1', translate)!;

	assert.match(forWriter, /Round 1/);
	assert.match(forWriter, /Ada/);
	// No "with the letter" left dangling with nothing after it, in either voice.
	for (const line of [forJudge, forWriter]) {
		assert.doesNotMatch(line, /letter/i, line);
	}
});

test('a tie-breaking rotation is named as sudden death rather than as a cycle number', () => {
	const gs = gameState();
	gs.categories!.cycle = 2;

	assert.match(categoriesNowPlayingText(gs, 'p1', translate)!, /sudden death/i);
	assert.match(categoriesStatusText(gs, 'p1', translate)!, /sudden death/i);
});

test('the duty line tells each player their own job for the phase in play', () => {
	const preparing = gameState('preparing');
	const writing = gameState('writing');
	const review = gameState('review');

	assert.match(categoriesDutyText(preparing, 'p0', translate)!, /do not write/i);
	assert.match(categoriesDutyText(preparing, 'p1', translate)!, /Ada/);
	assert.match(categoriesDutyText(writing, 'p1', translate)!, /\bR\b/);
	assert.match(categoriesDutyText(review, 'p0', translate)!, /Rule on every answer/i);
	assert.match(categoriesDutyText(review, 'p2', translate)!, /Ada/);
});

test('progress answers "are we nearly there?" for both halves of the round', () => {
	const writing = gameState('writing');
	const allDone = gameState('writing', { finishedWriterIds: ['p1', 'p2'] });
	const review = gameState('review', { reviewIndex: 1 });

	assert.match(categoriesProgressText(writing, translate)!, /2/);
	assert.match(categoriesProgressText(allDone, translate)!, /finished/i);
	assert.match(categoriesProgressText(review, translate)!, /2 of 2/);
	assert.equal(categoriesProgressText(gameState('finished'), translate), null);
});

test('status speaks my score and my role; the rival survey leaves me out and leads with the leader', () => {
	const gs = gameState();

	const mine = categoriesStatusText(gs, 'p1', translate)!;
	const rivals = categoriesRivalStatus(gs, 'p1', translate)!;

	assert.match(mine, /5/);
	assert.match(mine, /writer/);
	assert.equal(rivals.includes('Berto'), false);
	assert.ok(rivals.indexOf('Ada') < rivals.indexOf('Cora'), rivals);
});

test('an answer under review reads as one sentence carrying both hints in words', () => {
	const gs = gameState('review');
	const plain = categoriesAnswerLabel(gs, answer('p1', 'rabbit'), 'R', translate);
	const wrongLetter = categoriesAnswerLabel(gs, answer('p1', 'cat', { matchesLetter: false }), 'R', translate);
	const repeated = categoriesAnswerLabel(gs, answer('p2', 'rat', { duplicateGroup: 0 }), 'R', translate);
	const blank = categoriesAnswerLabel(gs, answer('p2', '   '), 'R', translate);

	assert.match(plain, /Berto wrote rabbit\./);
	assert.match(wrongLetter, /does not start with R/i);
	assert.match(repeated, /same thing/i);
	assert.match(blank, /nothing/i);
	// The hints are observations, never a verdict: nothing here says valid or invalid.
	assert.equal(/invalid/i.test(wrongLetter), false);
});

test('suggested verdicts agree with every hint, and blanks never become a question for the judge', () => {
	const prompt = {
		categoryId: 'animal',
		name: 'An animal',
		answers: [
			answer('p1', 'rabbit'),
			answer('p2', 'rat', { duplicateGroup: 0 }),
			answer('p3', 'cat', { matchesLetter: false }),
			answer('p4', ''),
		],
	};

	const suggested = categoriesSuggestedVerdicts(prompt);

	assert.equal(suggested.get('p1'), 'accepted');
	assert.equal(suggested.get('p2'), 'duplicate');
	assert.equal(suggested.get('p3'), 'rejected');
	assert.equal(suggested.get('p4'), 'rejected');
});

test('writing is offered only to a writer, only while the clock runs, and only until they finish', () => {
	const writing = gameState('writing');
	const finished = gameState('writing', { finishedWriterIds: ['p1'] });

	assert.equal(categoriesCanWrite(writing.categories!.round, 'p1'), true);
	assert.equal(categoriesCanWrite(writing.categories!.round, 'p0'), false, 'the judge never writes');
	assert.equal(categoriesCanWrite(finished.categories!.round, 'p1'), false);
	assert.equal(categoriesCanWrite(gameState('review').categories!.round, 'p1'), false);
});
