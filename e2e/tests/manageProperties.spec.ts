// manageProperties.spec.ts — the manage-properties dialog, end to end (bugs #10/#12).
//
//  * #10  each row must read the property's GROUP NAME from the package i18n
//         (never the raw hex colour);
//  * #12  Shift+F10 (the keyboard context-menu gesture) must open the actions menu
//         INSIDE the modal dialog — the dialog is modal, so a menu appended to
//         <body> would sit in the inert region and be unreachable.

import { test, expect } from '../helpers/test';
import {
	actionButton,
	appI18n,
	buyPendingProperty,
	createGame,
	joinGame,
	newPlayerPage,
	packageI18n,
	resetDice,
	roll,
	startGame,
} from '../helpers/game';

const BOARD = 'galactic-empire';

test.beforeEach(async () => {
	await resetDice();
});

test('manage: rows read group names (not hex), Shift+F10 menu opens inside the dialog', async ({ browser }) => {
	const pkg = packageI18n(BOARD, 'es');
	const app = appI18n('es');
	const sq3 = pkg.squares['3'];

	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);

	const code = await createGame(ana, 'Ana', BOARD);
	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);

	// Ana lands on square 3 and buys it, then opens the manage dialog.
	await roll(ana, 1, 2);
	await buyPendingProperty(ana);
	await actionButton(ana, 'manageProperties').click();

	const dialog = ana.locator('dialog.manage-dialog');
	await expect(dialog).toBeVisible();

	// Bug #10: the row voices name + GROUP NAME + price in the board's currency
	// localized currency WORD — no raw hex anywhere.
	const row = dialog.locator('.manage-item').first();
	await expect(row).toHaveAttribute('aria-label', new RegExp(`${sq3}.*${pkg.groups.g1}`));
	await expect(row).toHaveAttribute('aria-label', new RegExp(`60 ${pkg.currency.name}`));
	await expect(row).not.toHaveAttribute('aria-label', /#/);

	// Bug #12: Shift+F10 on the row opens the accessible context menu INSIDE the
	// modal dialog (a <body>-hosted menu would be inert and unreachable).
	await row.focus();
	await ana.keyboard.press('Shift+F10');
	const menu = dialog.locator('.manage-context-menu');
	await expect(menu).toBeVisible();
	const items = menu.locator('[role="menuitem"]');
	await expect(items.first()).toBeFocused();

	// Activate "mortgage" from the menu and watch the row update in place.
	await items.filter({ hasText: /hipoteca/i }).first().click();
	await expect(row).toHaveAttribute('aria-label', new RegExp(app.game.manage_state_mortgaged));
});
