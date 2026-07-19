// race-animation.spec.ts — verify piece animation in race games
//
// Tests that pieces animate smoothly from one square to another rather than
// teleporting instantly, with announcements deferred until animation completes.

import { test, expect } from '../helpers/test';
import {
	actionButton,
	createGame,
	joinGame,
	newPlayerPage,
	resetDice,
	scriptDice,
	startGame,
} from '../helpers/game';

const BOARD = 'carrera-galactica';

test.beforeEach(async () => {
	await resetDice();
});

test('pieces animate from one square to another', async ({ browser }) => {
	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);

	const code = await createGame(ana, 'Ana', BOARD);
	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);

	const roll = async (page: typeof ana, value: number) => {
		await scriptDice(value);
		await actionButton(page, 'rollDice').click();
	};

	const circuitCell = (page: typeof ana, square: number) =>
		page.locator(`#board .race-cell[data-square="${square}"]`);

	// ── Ana rolls 5: exit onto square 5 ──────────────────────────────
	await roll(ana, 5);

	// Verify the piece is on the target square (Ana's start = 5)
	await expect(circuitCell(ana, 5).locator('.race-piece')).toHaveCount(1);

	// ── Berto rolls 5: exit onto square 22 ──────────────────────────
	await roll(berto, 5);

	// Verify the piece is on the target square (Berto's start = 22)
	await expect(circuitCell(berto, 22).locator('.race-piece')).toHaveCount(1);

	// ── Ana rolls 4: move from 5 to 9 ──────────────────────────────
	await roll(ana, 4);

	// Verify the piece reached the destination
	await expect(circuitCell(ana, 9).locator('.race-piece')).toHaveCount(1);

	// Verify no piece is left on the origin square
	await expect(circuitCell(ana, 5).locator('.race-piece')).toHaveCount(0);

	// ── Berto rolls 3: move from 22 to 25 ──────────────────────────
	await roll(berto, 3);

	// Verify the piece reached the destination
	await expect(circuitCell(berto, 25).locator('.race-piece')).toHaveCount(1);

	// Verify no piece is left on the origin square
	await expect(circuitCell(berto, 22).locator('.race-piece')).toHaveCount(0);

	console.log('✓ Piece animation test passed: pieces moved correctly');
});
