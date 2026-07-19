// race-screenshot.spec.ts — capture visual screenshots of the race board in action
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

test('visual: race board gameplay and design', async ({ browser }) => {
	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);

	const code = await createGame(ana, 'Ana', BOARD);
	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);

	// Capture initial board state
	await ana.screenshot({ path: 'race-board-01-start.png', fullPage: true });

	// Ana rolls 5 (mandatory exit)
	await scriptDice(5);
	await actionButton(ana, 'rollDice').click();
	await ana.waitForTimeout(500); // Wait for animation
	await ana.screenshot({ path: 'race-board-02-exit.png', fullPage: true });

	// Berto rolls 5 (his own exit)
	await scriptDice(5);
	await actionButton(berto, 'rollDice').click();
	await berto.waitForTimeout(500);
	await berto.screenshot({ path: 'race-board-03-both-exited.png', fullPage: true });

	// Ana rolls 5 again (barrier formation)
	await scriptDice(5);
	await actionButton(ana, 'rollDice').click();
	await ana.waitForTimeout(500);
	await ana.screenshot({ path: 'race-board-04-barrier.png', fullPage: true });

	// Berto rolls 2 (normal move)
	await scriptDice(2);
	await actionButton(berto, 'rollDice').click();
	await berto.waitForTimeout(500);
	await berto.screenshot({ path: 'race-board-05-normal-move.png', fullPage: true });

	// Ana rolls 2 (choice dialog with multiple options)
	await scriptDice(2);
	await actionButton(ana, 'rollDice').click();
	const dialog = ana.locator('.game-dialog.dialog-race-choice');
	await expect(dialog).toBeVisible();
	await ana.waitForTimeout(500);
	await ana.screenshot({ path: 'race-board-06-choice-dialog.png', fullPage: true });

	// Pick first option (one of the barrier pieces)
	await dialog.locator('.dialog-buttons button').first().click();
	await ana.waitForTimeout(500);
	await ana.screenshot({ path: 'race-board-07-after-choice.png', fullPage: true });

	console.log('✅ Screenshots captured successfully');
});
