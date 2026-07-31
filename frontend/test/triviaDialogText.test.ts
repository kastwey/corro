import test from 'node:test';
import assert from 'node:assert/strict';
import {
	triviaDestinationLabel, triviaJudgeLines, triviaQuestionTitle,
} from '../src/triviaDialogText.js';
import type { TriviaBoardDef, TriviaPendingQuestion } from '../src/models.js';

/** A translator that shows its interpolation, so a dropped variable is visible in the assertion. */
const t = (key: string, vars: Record<string, any> = {}) => {
	if (key === 'game.trivia_judge_question') return `The question was: ${vars.prompt}`;
	if (key === 'game.trivia_answered') return `${vars.player} answered ${vars.answer}.`;
	if (key === 'game.trivia_reveal') return `The correct answer is ${vars.correct}.`;
	if (key === 'game.trivia_answer_title') return 'Your answer';
	if (key === 'game.trivia_choice_title') return 'Choose an answer';
	if (key === 'game.trivia_cell_center') return 'the centre';
	if (key === 'game.trivia_cell_wedge') return `the ${vars.cat} wedge at ${vars.hour} o'clock`;
	if (key === 'game.trivia_cell_ring') return `${vars.cat}, space ${vars.num}`;
	if (key === 'game.trivia_pos_clock') return `at ${vars.hour} o'clock`;
	if (key.startsWith('game.trivia_region_')) return `in the ${key.slice('game.trivia_region_'.length)}`;
	if (key.startsWith('game.trivia_cat_')) return key.slice('game.trivia_cat_'.length);
	if (key.startsWith('colors.')) return key.slice('colors.'.length);
	return key;
};

/** Six wedges and six fillers, the shape a real wheel has. */
const BOARD: TriviaBoardDef = {
	spokeLength: 5,
	ring: Array.from({ length: 12 }, (_, i) => ({ category: i % 6, wedge: i % 2 === 0 })),
};

function question(overrides: Partial<TriviaPendingQuestion> = {}): TriviaPendingQuestion {
	return {
		playerId: 'ana', judgeId: 'berto', questionId: 'q1', category: 0,
		prompt: 'Capital of France?', choices: [], ...overrides,
	} as TriviaPendingQuestion;
}

test('a destination reads as one sentence: what the square is, then where it sits', () => {
	// A ring filler has a spatial anchor, so the two halves are joined with a comma — never
	// juxtaposed, which a screen reader would run together.
	const filler = triviaDestinationLabel(BOARD, 'R1', t);

	assert.match(filler, /^.+, in the .+$/, `expected "<square>, <where>" but got "${filler}"`);
});

test('a node with no spatial anchor is not left with a dangling separator', () => {
	// The centre has nowhere to be; a wedge already names its own clock hour. Appending an empty
	// suffix would leave the line ending in ", " — audible as a stumble.
	const centre = triviaDestinationLabel(BOARD, 'C', t);

	assert.equal(centre, 'the centre');
	assert.doesNotMatch(centre, /,\s*$/);
	assert.doesNotMatch(triviaDestinationLabel(BOARD, 'R0', t), /,\s*$/);
});

test('with no board yet the option still carries an unambiguous label', () => {
	// A state can arrive before the package definition; a blank button is worse than a raw id.
	assert.equal(triviaDestinationLabel(null, 'R3', t), 'R3');
});

test('the judge hears the question first, then the answer given, then the answer key', () => {
	// Order is the contract: ruling "right or wrong" without the question is impossible.
	const lines = triviaJudgeLines(
		question({ submitted: 'Paris', correctAnswer: 'Paris' }), 'Ana', t);

	assert.deepEqual(lines, [
		'The question was: Capital of France?',
		'Ana answered Paris.',
		'The correct answer is Paris.',
	]);
});

test('a pack without a prompt or an answer key says only what it has', () => {
	// No blank paragraph, and no line interpolating an absent value.
	assert.deepEqual(
		triviaJudgeLines(question({ prompt: '', submitted: 'Paris' }), 'Ana', t),
		['Ana answered Paris.']);

	assert.deepEqual(
		triviaJudgeLines(question({ submitted: 'Paris' }), 'Ana', t),
		['The question was: Capital of France?', 'Ana answered Paris.']);
});

test('an empty submission still reads as a sentence, never as "undefined"', () => {
	const lines = triviaJudgeLines(question({ prompt: '', submitted: undefined }), 'Ana', t);

	assert.deepEqual(lines, ['Ana answered .']);
	assert.doesNotMatch(lines[0], /undefined|null/);
});

test('the question is the dialog title, and a promptless pack still gets a named dialog', () => {
	assert.equal(triviaQuestionTitle(question(), 'game.trivia_answer_title', t), 'Capital of France?');
	// Falling back per MODE: the typed and multiple-choice dialogs have different headings.
	assert.equal(triviaQuestionTitle(question({ prompt: '' }), 'game.trivia_answer_title', t), 'Your answer');
	assert.equal(triviaQuestionTitle(question({ prompt: '' }), 'game.trivia_choice_title', t), 'Choose an answer');
});
