// journey-teams.spec.ts — the journey PAIRS mode end to end on "La Gran Ruta".
//
// Four real browsers, Spanish locale. The host creates a 4-player game with 2 teams and
// arranges [Ana, Berto] (Equipo Rojo) vs [Carla, David] (Equipo azul) in the waiting room —
// every move announced to the whole room, and the start guard refusing while anyone is
// unassigned. In game: ONE seat (and one car) per team; the INTERLEAVED turn order
// Ana → Carla → Berto → David (never two partners back to back, ≠ the join order); each
// member holding their OWN six cards; and Ana's immunity landing on the SHARED seat, so her
// partner's identity line shows it too.

import { test, expect, type Page } from '../helpers/test';
import {
	createGame, expectAnnouncement, joinGame, newPlayerPage, resetDice, startGame,
} from '../helpers/game';

const BOARD = 'la-gran-ruta';

test.beforeEach(async () => {
	await resetDice();
});

/** The host adds a pool player to a team via the team box's "Añadir jugador" menu. */
async function assign(host: Page, teamIndex: number, playerName: string): Promise<void> {
	// The panel re-renders on every LobbyUpdated: locate the button fresh each time.
	await host.locator('#host-team-panel .team-box').nth(teamIndex).locator('.team-box__add').click();
	await host.locator('[role="menu"] [role="menuitem"]').filter({ hasText: playerName }).click();
	await expect(host.locator('#host-team-panel .team-box').nth(teamIndex)).toContainText(playerName);
}

test('pairs: host-arranged teams, one shared seat and car, interleaved turns, private hands', async ({ browser }) => {
	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);
	const carla = await newPlayerPage(browser);
	const david = await newPlayerPage(browser);

	const code = await createGame(ana, 'Ana', BOARD, { maxPlayers: 4, teamCount: 2 });
	await joinGame(berto, code, 'Berto');
	await joinGame(carla, code, 'Carla');
	await joinGame(david, code, 'David');

	// The waiting room shows the two team boxes; guests see the same picture, read-only.
	await expect(ana.locator('#host-team-panel .team-box')).toHaveCount(2);
	await expect(berto.locator('#joined-team-panel .team-box')).toHaveCount(2);
	await expect(berto.locator('#joined-team-panel button')).toHaveCount(0);

	// Starting with nobody placed is refused with the reason.
	await ana.click('#start-game-btn');
	await expect(ana.locator('#error-message')).toContainText(/sin equipo/i);

	// [Ana, Berto] red vs [Carla, David] blue — NOT the join order, so the interleave shows.
	await assign(ana, 0, 'Ana');
	await assign(ana, 0, 'Berto');
	await assign(ana, 1, 'Carla');
	await assign(ana, 1, 'David');
	// Every move is spoken to the whole room (the polite lobby live region).
	await expectAnnouncement(berto, /David entra en el Equipo azul/);

	await startGame(ana, [ana, berto, carla, david]);

	// ONE car per TEAM on the strip; each member holds their OWN six cards; the deck
	// counter row reads 106 − 4×6 = 82.
	await expect(ana.locator('#board .journey-car')).toHaveCount(2);
	for (const page of [ana, berto, carla, david]) {
		await expect(page.locator('.hand-card:not(.hand-card--info)')).toHaveCount(6);
	}
	await expect(ana.locator('.hand-card--info')).toHaveAttribute('aria-label', 'Cartas en el mazo: 82');

	// The players panel tells ONE story per team: both blue members read as «Equipo azul».
	await expect(ana.locator('.player-card', { hasText: 'Carla' })).toHaveAttribute('aria-label', /Equipo azul/);
	await expect(ana.locator('.player-card', { hasText: 'David' })).toHaveAttribute('aria-label', /Equipo azul/);

	// Ana draws and plays her known As del volante (identity deal → it is her first row):
	// the immunity lands on the SHARED red seat, and the turn passes to CARLA — the
	// interleaved order, not the join order (Berto joined second).
	await ana.locator('#board').focus();
	await ana.keyboard.press(' ');
	await expectAnnouncement(ana, /Robas:/);
	await ana.keyboard.press('Enter');
	await expectAnnouncement(berto, /¡Ana se corona como As del volante!/);
	await expectAnnouncement(ana, /Turno de Carla/);

	// The shared-seat proof: BERTO played nothing, yet his identity line carries his
	// team's immunity (and the team word both partners share).
	const bertoRow = carla.locator('.player-card', { hasText: 'Berto' });
	await expect(bertoRow).toHaveAttribute('aria-label', /Equipo Rojo/i);
	await expect(bertoRow).toHaveAttribute('aria-label', /As del volante/);
});
