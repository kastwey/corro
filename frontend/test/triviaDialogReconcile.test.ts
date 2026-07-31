import test from 'node:test';
import assert from 'node:assert/strict';
import { desiredTriviaDialog, triviaDialogKey } from '../src/modalReconcile.js';
import type { GameState, TriviaPendingQuestion } from '../src/models.js';

/** A trivia state carrying just the pending fields the decision reads. */
function stateWith(trivia: Partial<NonNullable<GameState['trivia']>>): GameState {
	return { gameType: 'trivia', trivia: { players: [], categoryCursors: [], ...trivia } } as GameState;
}

function question(overrides: Partial<TriviaPendingQuestion> = {}): TriviaPendingQuestion {
	return {
		playerId: 'ana', judgeId: 'berto', questionId: 'q1', category: 0,
		prompt: 'Capital of France?', choices: [], ...overrides,
	} as TriviaPendingQuestion;
}

test('the host is asked to name the judge, and nobody else is', () => {
	const state = stateWith({ pendingJudgeSetup: { hostId: 'ana' } });

	assert.deepEqual(desiredTriviaDialog(state, 'ana'), { kind: 'judgeSetup' });
	// Everyone else waits — opening it for them would strand the table on four dialogs.
	assert.deepEqual(desiredTriviaDialog(state, 'berto'), { kind: 'none' });
});

test('the destination picker belongs to the player who rolled', () => {
	const state = stateWith({ pendingMove: { playerId: 'ana', rolled: 3, options: ['R1', 'S2.1'] } });

	assert.deepEqual(desiredTriviaDialog(state, 'ana'), { kind: 'move', options: ['R1', 'S2.1'] });
	assert.deepEqual(desiredTriviaDialog(state, 'berto'), { kind: 'none' });
});

test('answering and judging are exclusive, and both hinge on whether the answer is in', () => {
	const unanswered = stateWith({ pendingQuestion: question() });

	// Mine and unanswered: I answer. The judge sees nothing yet — ruling on an unsubmitted
	// answer would let them close the question before it was given.
	assert.deepEqual(desiredTriviaDialog(unanswered, 'ana'), { kind: 'answer', question: question() });
	assert.deepEqual(desiredTriviaDialog(unanswered, 'berto'), { kind: 'none' });

	const answered = stateWith({ pendingQuestion: question({ submitted: 'Paris' }) });

	// Submitted: the judge rules, and the answerer's dialog is gone (they cannot revise).
	assert.equal(desiredTriviaDialog(answered, 'berto').kind, 'judge');
	assert.deepEqual(desiredTriviaDialog(answered, 'ana'), { kind: 'none' });
});

test('a spectator with no role in the question keeps exploring the board', () => {
	const state = stateWith({ pendingQuestion: question({ submitted: 'Paris' }) });

	assert.deepEqual(desiredTriviaDialog(state, 'carla'), { kind: 'none' });
});

test('no state, no trivia or no identified player asks for nothing', () => {
	assert.deepEqual(desiredTriviaDialog(null, 'ana'), { kind: 'none' });
	assert.deepEqual(desiredTriviaDialog(undefined, 'ana'), { kind: 'none' });
	assert.deepEqual(desiredTriviaDialog({ gameType: 'property' } as GameState, 'ana'), { kind: 'none' });
	// Before the session resolves, my id is null: nothing may open on a guess.
	assert.deepEqual(desiredTriviaDialog(stateWith({ pendingJudgeSetup: { hostId: 'ana' } }), null),
		{ kind: 'none' });
});

test('the key stays stable for the same dialog and changes when the dialog does', () => {
	// This is what stops every state push from tearing down and rebuilding the open dialog,
	// which would steal focus mid-answer.
	const first = question({ questionId: 'q1' });
	assert.equal(triviaDialogKey({ kind: 'answer', question: first }),
		triviaDialogKey({ kind: 'answer', question: question({ questionId: 'q1', submitted: undefined }) }));

	// A different question, or the same question in the other role, is a different dialog.
	assert.notEqual(triviaDialogKey({ kind: 'answer', question: first }),
		triviaDialogKey({ kind: 'answer', question: question({ questionId: 'q2' }) }));
	assert.notEqual(triviaDialogKey({ kind: 'answer', question: first }),
		triviaDialogKey({ kind: 'judge', question: first }));

	// Fresh destinations must reopen the picker rather than leave the stale options up.
	assert.notEqual(triviaDialogKey({ kind: 'move', options: ['R1'] }),
		triviaDialogKey({ kind: 'move', options: ['R1', 'R2'] }));

	// "Nothing should be open" has no key, which is what closes whatever was.
	assert.equal(triviaDialogKey({ kind: 'none' }), null);
});
