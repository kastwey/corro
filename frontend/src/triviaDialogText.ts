// triviaDialogText.ts — the WORDING of the trivia family's dialogs, without the dialogs.
//
// Same split as busChoice.ts: app.ts owns dialogManager and the DOM, this owns what is said. That
// matters here more than most places, because these lines are read aloud: a destination option and
// the judge's briefing must each land as ONE flowing sentence, connected by words and punctuation
// rather than by visual layout a screen reader cannot see.
//
// Pure and DOM-free, so the phrasing is unit-testable; the translator is injected.

import { triviaNodeLabel, triviaPositionSuffix } from './triviaBoard.js';
import type { TriviaBoardDef, TriviaPendingQuestion } from './models.js';

type Translate = (key: string, vars?: Record<string, unknown>) => string;

/**
 * One destination option in the picker: what the square IS, then where it sits.
 *
 * The two halves come from different helpers ("the sports wedge", "at five o'clock") and are
 * joined with a comma so they read as a single spoken line. Some nodes have no spatial anchor —
 * the centre has nowhere to be, a wedge already names its own clock hour — and those return the
 * label alone rather than a line ending in a dangling separator.
 */
export function triviaDestinationLabel(
	board: TriviaBoardDef | null,
	node: string,
	t: Translate,
): string {
	// No board definition yet (a state that arrived before the package): the raw node id is a
	// poor label, but it is unambiguous and never blank.
	if (!board) return node;

	const label = triviaNodeLabel(board, node, t);
	const position = triviaPositionSuffix(board, node, t);
	return position ? `${label}, ${position}` : label;
}

/**
 * What the judge is told, in order: the QUESTION first — they cannot rule "right or wrong"
 * without it — then what was actually answered, then the correct answer when the pack ships one.
 *
 * A pack may omit the prompt or the answer key, so the lines present are exactly the ones with
 * something to say; the caller renders them as paragraphs in this order.
 */
export function triviaJudgeLines(
	question: TriviaPendingQuestion,
	answererName: string,
	t: Translate,
): string[] {
	const lines: string[] = [];
	if (question.prompt) {
		lines.push(t('game.trivia_judge_question', { prompt: question.prompt }));
	}
	lines.push(t('game.trivia_answered', {
		player: answererName,
		// An empty submission still reads as a sentence rather than interpolating "undefined".
		answer: question.submitted ?? '',
	}));
	if (question.correctAnswer) {
		lines.push(t('game.trivia_reveal', { correct: question.correctAnswer }));
	}
	return lines;
}

/**
 * A question dialog's title. The PROMPT is the title — announced on open like any other dialog —
 * so the player hears the question and lands straight on the answer control. A pack that ships no
 * prompt falls back to the generic heading rather than opening a nameless dialog.
 */
export function triviaQuestionTitle(
	question: TriviaPendingQuestion,
	fallbackKey: 'game.trivia_choice_title' | 'game.trivia_answer_title',
	t: Translate,
): string {
	return question.prompt || t(fallbackKey);
}
