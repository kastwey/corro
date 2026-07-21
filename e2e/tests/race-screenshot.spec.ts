// race-screenshot.spec.ts — capture visual screenshots of the race board in action
import { test, expect } from '../helpers/test';
import { captureScreenshot } from '../helpers/screenshot';
import {
	actionButton,
	createGame,
	joinGame,
	newPlayerPage,
	resetDice,
	scriptDice,
	startGame,
} from '../helpers/game';

const BOARD = 'galactic-race';

test.beforeEach(async () => {
	await resetDice();
});

test('visual: race board gameplay and design', async ({ browser }, testInfo) => {
	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);

	const code = await createGame(ana, 'Ana', BOARD);
	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);

	// Capture initial board state
	await captureScreenshot(ana, testInfo, 'race-board-01-start.png');

	// Ana rolls 5 (mandatory exit)
	await scriptDice(5);
	await actionButton(ana, 'rollDice').click();
	await ana.waitForTimeout(500); // Wait for animation
	await captureScreenshot(ana, testInfo, 'race-board-02-exit.png');

	// Berto rolls 5 (his own exit)
	await scriptDice(5);
	await actionButton(berto, 'rollDice').click();
	await berto.waitForTimeout(500);
	await captureScreenshot(berto, testInfo, 'race-board-03-both-exited.png');

	// Ana rolls 5 again (barrier formation)
	await scriptDice(5);
	await actionButton(ana, 'rollDice').click();
	await ana.waitForTimeout(500);
	await captureScreenshot(ana, testInfo, 'race-board-04-barrier.png');

	// Berto rolls 2 (normal move)
	await scriptDice(2);
	await actionButton(berto, 'rollDice').click();
	await berto.waitForTimeout(500);
	await captureScreenshot(berto, testInfo, 'race-board-05-normal-move.png');

	// Ana rolls 2 (choice dialog with multiple options)
	await scriptDice(2);
	await actionButton(ana, 'rollDice').click();
	const dialog = ana.locator('.game-dialog.dialog-race-choice');
	await expect(dialog).toBeVisible();
	await ana.waitForTimeout(500);
	await captureScreenshot(ana, testInfo, 'race-board-06-choice-dialog.png');

	// Pick first option (one of the barrier pieces)
	await dialog.locator('.dialog-buttons button').first().click();
	await ana.waitForTimeout(500);
	await captureScreenshot(ana, testInfo, 'race-board-07-after-choice.png');

	console.log('✅ Screenshots captured successfully');
});
