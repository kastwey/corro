// track.spec.ts — the track family end to end on the shipped "Escaleras y serpientes" board.
//
// Two real browsers, scripted SINGLE-die rolls, Spanish locale. Covers: the first entry
// walk, a ladder climb voiced with the package's own themed line, the roll-again on a 6,
// and the keyboard exploration (digits jump 1-based, arrows walk the serpentine track,
// effect squares voice where they lead, M finds my piece) — the property-only shortcuts
// stay hidden from the help.

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

const BOARD = 'snakes-and-ladders';

test.beforeEach(async () => {
	await resetDice();
});

test('the lobby offers the track board with tokens only (no rules, no seats)', async ({ browser }) => {
	const page = await newPlayerPage(browser);
	await page.goto('/');
	await expect(page.locator('#your-games-empty, #your-games-list li').first()).toBeVisible();
	await page.click('#go-create-btn');

	await page.selectOption('#board-selector', BOARD);
	await expect(page.locator('.token-list:not(#join-token-list) input[value="star"]')).toBeAttached();
	await expect(page.locator('#rules-details')).toBeHidden(); // no property house rules
	await expect(page.locator('#seat-fieldset')).toBeHidden(); // no race seats either
});

test('track: entry walk, a themed ladder climb, roll-again on 6, and board exploration', async ({ browser }) => {
	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);

	const code = await createGame(ana, 'Ana', BOARD);
	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);

	// Spatial families enter the board automatically and retain arrow exploration.
	const intro = ana.locator('#game-surface-intro');
	await expect(intro).toHaveAttribute('data-i18n', 'game.surface_intro.board');
	await expect(intro).toHaveText('El foco se coloca automáticamente en el tablero. Usa las flechas para explorarlo; tu lector de pantalla anunciará cada posición. Pulsa Control más F1 para consultar los atajos de este juego.');
	await expect(ana.locator('#board')).toBeFocused();

	const roll = async (page: typeof ana, value: number) => {
		await scriptDice(value);
		await actionButton(page, 'rollDice').click();
	};
	const cell = (page: typeof ana, square: number) =>
		page.locator(`#board .track-cell[data-square="${square}"]`);

	// Both pieces start OFF the board, waiting in the start tray.
	await expect(cell(ana, 0).locator('.track-piece')).toHaveCount(2);

	// The SVG overlay draws one connector per board effect (ladders + snakes) from the
	// real cell geometry — proof the post-layout drawing didn't abort.
	await expect(ana.locator('#board .track-overlay .track-connector')).toHaveCount(16);
	await expect(ana.locator('#board .track-overlay .track-connector--ladder')).toHaveCount(8);
	await expect(ana.locator('#board .track-overlay .track-connector--snake')).toHaveCount(8);

	// ── Ana rolls 4: walks in to square 4 — a ladder mouth — and climbs to 14. ──
	// The climb is voiced with the PACKAGE's themed line (its i18n overrides the
	// engine's track_effect_up), as a consequence after the piece settles.
	await roll(ana, 4);
	await expectAnnouncement(berto, /Ana saca un 4/);
	await expectAnnouncement(berto, /¡Ana encuentra una escalera y trepa de la casilla 4 a la 14!/);
	await expect(cell(berto, 14).locator('.track-piece')).toHaveCount(1);
	await expectAnnouncement(ana, /Turno de Berto/);

	// ── Berto rolls 6: enters at 6 and ROLLS AGAIN (the turn stays his). ──────
	await roll(berto, 6);
	await expectAnnouncement(ana, /Berto vuelve a tirar/);
	await expect(cell(ana, 6).locator('.track-piece')).toHaveCount(1);
	await roll(berto, 5); // 6 → 11, plain square, turn passes
	await expect(cell(ana, 11).locator('.track-piece')).toHaveCount(1);
	await expectAnnouncement(berto, /Turno de Ana/);

	// ── The players panel shows the piece identity instead of money. ──────────
	const anaRow = berto.locator('.player-card', { hasText: 'Ana' });
	await expect(anaRow).toHaveAttribute('aria-label', /Estrella/);
	await expect(anaRow.locator('.player-card__seat')).toHaveText('Estrella');

	// ── Keyboard exploration: digits are 1-based, arrows walk the serpentine. ─
	await ana.locator('#board').focus();
	await ana.keyboard.press('1');
	await ana.keyboard.press('7'); // composes 17: a snake's mouth
	await expectAnnouncement(ana, /Casilla 17 de 100.*Serpiente: baja a la casilla 7/);
	await ana.keyboard.press('ArrowRight');
	await expectAnnouncement(ana, /Casilla 18 de 100/);
	await ana.keyboard.press('ArrowUp'); // +10, one visual row up
	await expectAnnouncement(ana, /Casilla 28 de 100.*Escalera: sube a la casilla 84/);

	// M jumps to my piece; N cycles the occupied squares (11 and 14).
	await ana.keyboard.press('m');
	await expectAnnouncement(ana, /Casilla 14 de 100.*Ficha de Ana/);
	await ana.keyboard.press('n');
	await expectAnnouncement(ana, /Casilla 11 de 100.*Ficha de Berto/);
	await ana.keyboard.press('n');
	await expectAnnouncement(ana, /Casilla 14 de 100.*Ficha de Ana/);

	// ── Ctrl+F1: the shortcuts help hides every property-only row, and opens as a
	// READING dialog — no role="application" inside (it starved NVDA's browse mode)
	// and no aria-describedby (it dumped the whole table on entry). ───────────
	await ana.keyboard.press('Control+F1');
	const help = ana.locator('.game-dialog.dialog-help');
	await expect(help).toBeVisible();
	await expect(help).toContainText('Ir a la siguiente casilla ocupada');
	await expect(help).not.toContainText(/subasta/i);
	await expect(help).not.toContainText(/hipotec/i);
	await expect(help.locator('[role="application"]')).toHaveCount(0);
	await expect(help).not.toHaveAttribute('aria-describedby', /.+/);
	// Reading starts at the TITLE (tabindex=-1), not on the close button.
	await expect(help.locator('.dialog-title')).toBeFocused();
	await ana.keyboard.press('Escape');
	await expect(help).toBeHidden();
});
