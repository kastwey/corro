// smoke-en.spec.ts — the same package coherence, in English.
//
// Every other scenario runs in Spanish; this smoke proves the i18n plumbing end to
// end for the second language: browser locale en-US → the lobby and board resolve
// the package's EN texts (square names, currency word) and the app's EN labels.

import { test, expect } from '../helpers/test';
import {
	appI18n,
	buyPendingProperty,
	createGame,
	expectAnnouncement,
	joinGame,
	newPlayerPage,
	packageI18n,
	resetDice,
	roll,
	square,
	startGame,
} from '../helpers/game';

const BOARD = 'imperio-galactico';

test.beforeEach(async () => {
	await resetDice();
});

test('english smoke: purchase reads the package EN name and currency word', async ({ browser }) => {
	const pkg = packageI18n(BOARD, 'en');
	const app = appI18n('en');
	const sq3 = pkg.squares['3'];

	const ana = await newPlayerPage(browser, 'en-US');
	const berto = await newPlayerPage(browser, 'en-US');

	const code = await createGame(ana, 'Ana', BOARD);
	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);

	await roll(ana, 1, 2);
	await buyPendingProperty(ana);

	// Berto hears the purchase with the EN square name and the EN currency word
	// ("credits"), and his board labels the square as Ana's in English.
	await expectAnnouncement(berto, new RegExp(`Ana.*${sq3}.*60 ${pkg.currency.name}`));
	const propertyOfAna = (app.game.property_of as string).replace('{{owner}}', 'Ana');
	await expect(square(berto, 3)).toHaveAttribute('aria-label', new RegExp(`${sq3}.*${propertyOfAna}`));
});
