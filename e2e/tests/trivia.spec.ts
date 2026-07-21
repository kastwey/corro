// trivia.spec.ts — the trivia family end to end on the shipped "The Wheel of Wits" wheel.
//
// Two real browsers, scripted SINGLE-die rolls, Spanish locale. Covers the core loop: roll →
// choose a headquarters → answer in writing → the rotating judge rules → a wedge is earned and
// the turn continues; plus the wheel's radial keyboard navigation (E = centre, colour letters
// jump to a headquarters, arrows follow up=centre / down=ring). This family has NO bots.
//
// The deal is the question queue: the identity shuffle keeps questions.es.json order, so the
// first Geografía question is "the capital of Australia" (reordering that file breaks this spec).

import { test, expect } from '../helpers/test';
import {
	actionButton,
	createGame,
	expectAnnouncement,
	joinGame,
	newPlayerPage,
	resetDice,
	scriptDice,
	startGame,
} from '../helpers/game';

const BOARD = 'wheel-of-wits';

test.beforeEach(async () => {
	await resetDice();
});

test('trivia: roll, pick a headquarters, answer, the judge rules, a wedge is earned', async ({ browser }) => {
	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);

	const code = await createGame(ana, 'Ana', BOARD);
	// Trivia ships no bot policy (a bot can't judge), so the host's "add bot" chair stays hidden.
	await expect(ana.locator('#add-bot-btn')).toBeHidden();
	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);
	// Both players' pieces paint at the centre: the themed token icon on a colour chip, wrapped by
	// its quesito holder — and fanned apart so neither hides the other (the "who's at the centre?"
	// report). The icons are decorative; the announcer names who stands where.
	await expect(ana.locator('#board .trivia-piece')).toHaveCount(2);
	await expect(ana.locator('#board .trivia-piece__icon').first()).toBeVisible();

	// ── Ana rolls 4: from the centre that reaches every headquarters (spokeLength 3 + 1). ──
	await scriptDice(4);
	await actionButton(ana, 'rollDice').click();
	await expectAnnouncement(berto, /Ana saca un 4/);

	// The destination is a NON-modal, plain-buttons dialog; the legal landings are highlighted on
	// the board, so Ana can Escape to it, cycle with 'd', and press Enter to pick — direct
	// manipulation, no focus trap, no role="application".
	const destDialog = ana.locator('#game-dialog-nonmodal');
	await expect(destDialog).toBeVisible();
	await expect(destDialog).toHaveAttribute('data-modal', 'false');
	await expect(destDialog.locator('.dialog-buttons')).not.toHaveAttribute('role', 'application');
	// Each landing button names its spot in the wheel, so you can anticipate where you'll go —
	// a headquarters carries its clock hour (Geografía sits at 12 o'clock).
	await expect(destDialog.locator('.dialog-buttons button', { hasText: 'Geografía' })).toContainText('a las 12');
	await expect(ana.locator('#board .trivia-cell--option')).toHaveCount(6); // the six headquarters

	// Escape out of the picker MINIMIZES it (never closes — that would abandon the pending
	// choice) and drops focus on the board, so a screen-reader user backs out to the highlighted
	// squares in one keystroke without losing the turn.
	const minBtn = destDialog.locator('.dialog-minimize');
	await expect(minBtn).toBeVisible();
	await destDialog.locator('.dialog-buttons button').first().focus();
	await ana.keyboard.press('Escape');
	await expect(destDialog).toBeVisible();
	await expect(destDialog).toHaveClass(/dialog--minimized/);
	await expect(ana.locator('#board')).toBeFocused();

	// The corner button toggles it back open; minimizing it again also hands focus to the board
	// (a sighted player shrinks it and clicks the highlighted square on the now fully-visible board).
	await minBtn.click();
	await expect(destDialog).not.toHaveClass(/dialog--minimized/);
	await minBtn.click();
	await expect(destDialog).toHaveClass(/dialog--minimized/);
	await expect(destDialog.locator('.dialog-buttons')).toBeHidden();
	await expect(ana.locator('#board')).toBeFocused();

	await ana.keyboard.press('d'); // cursor → the first legal landing (Geografía HQ, at 12 o'clock)
	await expectAnnouncement(ana, /Casa de Geografía/);
	// The highlighted landing is a labelled button, so a sighted player can just CLICK the square
	// (no need to touch the corner dialog) — and a touch screen reader can find and activate it.
	const geoCell = ana.locator('#board .trivia-cell--option[data-node="R0"]');
	await expect(geoCell).toHaveAttribute('role', 'button');
	await expect(geoCell).toHaveAttribute('aria-label', /Casa de Geografía/);
	await geoCell.click(); // clicking the board square executes the move
	await expectAnnouncement(berto, /Ana cae en la casa de Geografía/);

	// ── Ana's Geografía question (deck order → the capital of Australia); she writes "Canberra". ──
	// Accessibility: the QUESTION is the dialog title (so it is announced on open), and focus
	// lands straight on the input (not a button), so NVDA reads it and never gets stuck.
	const anaDialog = ana.locator('#game-dialog');
	await expect(anaDialog.locator('.dialog-title')).toContainText('capital de Australia');
	const answerInput = anaDialog.locator('input[type="text"]');
	await expect(answerInput).toBeFocused();
	// TYPE it key by key: every letter must reach the field, not be hijacked as a global
	// shortcut (the "a → auction, f → pot" bug). A stolen letter would shorten the value.
	await answerInput.pressSequentially('Canberra');
	await expect(answerInput).toHaveValue('Canberra');
	await anaDialog.locator('.dialog-buttons button', { hasText: 'Responder' }).click();
	await expectAnnouncement(berto, /Ana responde: Canberra/);

	// ── Berto is the rotating judge (the next player); he sees the answer and rules it right. ──
	const bertoDialog = berto.locator('#game-dialog');
	await expect(bertoDialog).toBeVisible();
	// The judge must see the QUESTION to rule — not just the answer given and the correct one.
	await expect(bertoDialog).toContainText('capital de Australia');
	await expect(bertoDialog).toContainText('Canberra'); // the correct answer reaches the judge
	// The verdict is MANDATORY: an accidental Escape must NOT close it. Before the fix a stray
	// Escape closed the judge dialog for good and stranded the whole table with no way to resume.
	await bertoDialog.getByRole('button', { name: 'Correcto', exact: true }).focus();
	await berto.keyboard.press('Escape');
	await expect(bertoDialog).toBeVisible(); // still open — Escape was refused
	await bertoDialog.getByRole('button', { name: 'Correcto', exact: true }).click();

	// The reveal, the verdict and the earned wedge are announced (Ana hears the first-person
	// form); the turn stays hers.
	await expectAnnouncement(ana, /La respuesta correcta era: Canberra/);
	await expectAnnouncement(ana, /Ganas el quesito de Geografía/);
	await expectAnnouncement(ana, /Vuelve a tirar/); // a correct answer grants another roll — say so

	// ── The wheel's radial keyboard navigation. ──────────────────────────────────
	await ana.locator('#board').focus();
	await ana.keyboard.press('e'); // E → the centre
	await expectAnnouncement(ana, /Centro/);
	await ana.keyboard.press('ArrowDown'); // ↓ enters a spoke (away from the centre)
	await expectAnnouncement(ana, /del centro/);
	await ana.keyboard.press('b'); // B (blue) → the Geografía headquarters
	await expectAnnouncement(ana, /Casa de Geografía/);
	// Spatial cues: the junction gives its exact clock hour (Geografía HQ sits at 12 o'clock)…
	await expectAnnouncement(ana, /a las 12/);

	// The colour key is a ROTOR: press it again to advance to the next square of that category,
	// Shift+colour to step back — so you can survey every Geografía square, not only its house.
	const focusedNode = () => ana.locator('#board .trivia-cell.focused').getAttribute('data-node');
	expect(await focusedNode()).toBe('R0');
	await ana.keyboard.press('b');
	expect(await focusedNode()).not.toBe('R0'); // moved on to another Geografía square
	await ana.keyboard.press('Shift+B');
	expect(await focusedNode()).toBe('R0'); // …and back to the house

	// …and walking the ring names the region of the circle when it changes.
	await ana.keyboard.press('ArrowRight');
	await ana.keyboard.press('ArrowRight');
	await expectAnnouncement(ana, /parte/);

	// ── The wedge tally: 's' reads your own quesitos (by category), Shift+S the rivals'. ──
	await ana.keyboard.press('s');
	await expectAnnouncement(ana, /Tienes 1 de 6 quesitos: Geografía/);
	await ana.keyboard.press('Shift+S'); // Berto has none earned yet
	await expectAnnouncement(ana, /Berto: sin quesitos/);
	// The players panel carries the same count, so it is readable without asking.
	await expect(berto.locator('.player-card', { hasText: 'Ana' })).toContainText('1 de 6 quesitos');
});
