// connection.spec.ts — live-connection tracking, end to end.
//
// When a player's browser drops mid-game the rest of the table must SEE it (a
// "Desconectado" tag on their row and on the turn indicator) and HEAR it (a server
// announcement); pressing "t" must also voice that the current player is away. On
// rejoin the reconnection is announced (first-person for the returning player) and
// every flag clears.

import { test, expect } from '../helpers/test';
import {
	actionButton,
	appI18n,
	createGame,
	expectAnnouncement,
	joinGame,
	newPlayerPage,
	resetDice,
	roll,
	scriptDice,
	startGame,
} from '../helpers/game';

const BOARD = 'imperio-galactico';

test.beforeEach(async () => {
	await resetDice();
});

test('disconnect is seen and heard, "t" voices the absence, rejoin announces the return', async ({ browser }) => {
	const app = appI18n('es');

	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);

	const code = await createGame(ana, 'Ana', BOARD);
	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);

	// Hand the turn to Berto (Ana rolls to a harmless corner and ends her turn),
	// so his disconnection happens ON HIS TURN — the case that stalls the table.
	await roll(ana, 4, 6); // → just visiting
	await actionButton(ana, 'endTurn').click();

	// Berto's browser drops. Keep his CONTEXT (cookies + saved session) so he can
	// come back exactly like a player reopening the tab.
	const bertoUrl = berto.url();
	const bertoContext = berto.context();
	await berto.close();

	// Ana HEARS the disconnection (server-owned voice, from the app's own strings)…
	const disconnectedLine = (app.game.player_disconnected as string).replace('{{player}}', 'Berto');
	await expectAnnouncement(ana, new RegExp(disconnectedLine));

	// …and SEES it: a tag on Berto's row (plus in its accessible label) and on the
	// turn indicator, since it is Berto's turn the table is waiting on.
	const bertoRow = ana.locator('.player-card', { hasText: 'Berto' });
	await expect(bertoRow.locator('.player-tag--offline')).toBeVisible();
	await expect(bertoRow).toHaveAttribute('aria-label', new RegExp(app.game.disconnected_tag));
	await expect(ana.locator('.turn-indicator__offline')).toBeVisible();

	// Pressing "t" (announce turn) voices WHY nothing is happening.
	await ana.locator('#board').focus();
	await ana.keyboard.press('t');
	const turnOffline = (app.game.turn_player_disconnected as string).replace('{{player}}', 'Berto');
	await expectAnnouncement(ana, new RegExp(turnOffline));

	// Berto reopens the game (same context → same saved credentials) and reconnects.
	const berto2 = await bertoContext.newPage();
	await berto2.goto(bertoUrl);
	await expect(berto2.locator('#board .square').first()).toBeVisible();

	// Every disconnected flag clears on both surfaces (the broadcast state reached Ana)…
	await expect(bertoRow.locator('.player-tag--offline')).toBeHidden();
	await expect(ana.locator('.turn-indicator__offline')).toBeHidden();

	// …and the reconnection is HEARD: by Ana in third person, by Berto in first person
	// (the server's actorId convention delivers him the _self variant).
	const reconnectedLine = (app.game.player_reconnected as string).replace('{{player}}', 'Berto');
	await expectAnnouncement(ana, new RegExp(reconnectedLine));
	await expectAnnouncement(berto2, new RegExp(app.game.player_reconnected_self));
});

// Field bug: after a TRANSPORT blip (wifi hiccup, laptop sleep) SignalR auto-reconnects
// with a NEW connection id — and the client never re-joined, so the server treated the
// new connection as a stranger: no announcements, no state updates, commands bounced
// with NOT_AUTHENTICATED. A player rolled and heard NOTHING of what the engine did.
// The client must re-run JoinGameWithAuth on 'reconnected' so play resumes audibly.
test('a transport blip auto-rejoins: the game stays audible after the reconnection', async ({ browser }) => {
	const app = appI18n('es');

	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);

	const code = await createGame(ana, 'Ana', BOARD);
	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);

	// Berto's transport drops WITHOUT a page reload: closing the raw websocket makes
	// SignalR start its automatic reconnection (a fresh connection id).
	await berto.evaluate(() => {
		// Reach the raw socket through SignalR's internals (names vary across builds).
		const hub: any = (window as any).__corroConnection;
		const transport = (hub.connection ?? hub._connection)?.transport;
		// The minified bundle mangles the field name; find the socket by instance.
		const ws = Object.values(transport ?? {}).find((v): v is WebSocket => v instanceof WebSocket);
		if (!ws) throw new Error('websocket not found on the SignalR transport');
		ws.close();
	});

	// The automatic re-join reaches the server: Berto hears his own return first-person
	// (only an authenticated, re-mapped connection receives the _self variant).
	await expectAnnouncement(berto, new RegExp(app.game.player_reconnected_self));

	// And the game is AUDIBLE again: Ana rolls and the announcement reaches Berto's
	// NEW connection (before the fix, every line after the blip was lost for him).
	await roll(ana, 2, 3);
	const rolledLine = (app.game.dice_rolled as string)
		.replace('{{player}}', 'Ana').replace('{{die1}}', '2').replace('{{die2}}', '3').replace('{{total}}', '5');
	await expectAnnouncement(berto, new RegExp(rolledLine.replace(/[+]/g, '\\+')));
});

test('an action while disconnected kicks an immediate reconnect and carries through', async ({ browser }) => {
	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);
	const code = await createGame(ana, 'Ana', 'escaleras-y-serpientes');
	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);

	// Ana (the turn holder) loses her transport WITHOUT leaving the board — stop the SignalR
	// connection directly. (The Disconnect *button* now deliberately returns to the lobby, so it
	// can no longer stand in for a drop the player then acts through; stopping the connection
	// reproduces the same "down, still on the board" state, and stop() won't auto-reconnect.)
	await ana.evaluate(() => (window as any).__corroConnection.stop());
	await expectAnnouncement(berto, /Ana se ha desconectado/);

	// Her next action must not wait for any backoff: rolling revives the session
	// (immediate reconnect + re-auth) and the roll itself carries through.
	await scriptDice(3);
	await actionButton(ana, 'rollDice').click();
	await expectAnnouncement(berto, /Ana se ha vuelto a conectar/);
	await expectAnnouncement(berto, /Ana saca un 3/);
	await expect(ana.locator('#board .track-cell[data-square="3"] .track-piece')).toHaveCount(1);
});
