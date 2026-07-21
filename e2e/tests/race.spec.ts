// race.spec.ts — the race family end to end on the shipped "Galactic Race" board.
//
// Two real browsers, scripted SINGLE-die rolls (the race family consumes one value per
// roll from the same /e2e/random queue), Spanish locale. Covers: mandatory exit on 5,
// auto-move with a single option, the piece-choice dialog with several, barrier formation,
// and the topological keyboard exploration (arrows walk the circuit; cells voice their
// landmarks and occupants) — all asserted against the package's own i18n.

import { test, expect } from '../helpers/test';
import {
	actionButton,
	createGame,
	expectAnnouncement,
	joinGame,
	newPlayerPage,
	openJoinForm,
	packageI18n,
	resetDice,
	scriptDice,
	startGame,
} from '../helpers/game';

const BOARD = 'galactic-race';

test.beforeEach(async () => {
	await resetDice();
});

test('the lobby hides the property rules panel for a race board', async ({ browser }) => {
	// Regression: a race package declares no house rules, and the lobby used to fall back to
	  // the built-in property fieldsets — offering irrelevant trading rules for a race board.
	const page = await newPlayerPage(browser);
	await page.goto('/');
	await expect(page.locator('#your-games-empty, #your-games-list li').first()).toBeVisible();
	await page.click('#go-create-btn');

	await page.selectOption('#board-selector', BOARD);
	await expect(page.locator('.token-list:not(#join-token-list) input[value="spaceship"]')).toBeAttached();
	await expect(page.locator('#rules-details')).toBeHidden();
	// …and offers the board's seats (squadron colours) to pick from, plus the classic
	// pairs toggle (opposite seats team up — only meaningful on a 4-seat race board).
	await expect(page.locator('#seat-fieldset')).toBeVisible();
	await expect(page.locator('#seat-list input[name="seat"]')).toHaveCount(4);
	await expect(page.locator('#teams-group')).toBeVisible();

	// Switching back to a property board restores its rules panel (and drops the seats).
	await page.selectOption('#board-selector', 'galactic-empire');
	await expect(page.locator('.token-list:not(#join-token-list) input[value="ufo"]')).toBeAttached();
	await expect(page.locator('#rules-details')).toBeVisible();
	await expect(page.locator('#seat-fieldset')).toBeHidden();
	await expect(page.locator('#teams-group')).toBeHidden();
});

test('lobby seats: a taken colour says who holds it, bounces away, and the choices stick', async ({ browser }) => {
	const pkg = packageI18n(BOARD, 'es');
	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);

	// Ana creates picking the GREEN squadron (not the default first seat).
	const code = await createGame(ana, 'Ana', BOARD, { seat: 'green' });

	// Berto's join form: the green seat is Ana's — focusable, aria-disabled (NEVER the
	// disabled attribute) and labelled with her name; grabbing it bounces the selection.
	await openJoinForm(berto, code, 'Berto');
	const green = berto.locator('#join-seat-list input[value="green"]');
	await expect(green).toHaveAttribute('aria-disabled', 'true');
	// No `disabled` attribute: the option must remain REACHABLE by keyboard/screen reader
	// (Playwright's toBeEnabled follows aria-disabled, so pin the DOM property + focus).
	await expect(green).toHaveJSProperty('disabled', false);
	await green.focus();
	await expect(green).toBeFocused();
	await expect(berto.locator('#join-seat-list .token-label', { hasText: '(lo tiene Ana)' })).toBeVisible();
	await green.dispatchEvent('click');
	await expect(green).not.toBeChecked();

	// Berto takes blue instead; both identities survive into the game.
	await berto.locator('#join-token-list input.token-radio:not([data-taken])').first().dispatchEvent('click');
	await berto.locator('#join-seat-list input[value="blue"]').dispatchEvent('click');
	await berto.click('#join-final-button');
	await expect(berto.locator('#lobby-joined')).toBeVisible();
	await startGame(ana, [ana, berto]);

	await expect(berto.locator('.player-card', { hasText: 'Ana' }))
		.toHaveAttribute('aria-label', new RegExp(pkg.seats.green));
	await expect(ana.locator('.player-card', { hasText: 'Berto' }))
		.toHaveAttribute('aria-label', new RegExp(pkg.seats.blue));
});

test('race: exits, auto-moves, piece choice on a barrier, and circuit exploration', async ({ browser }) => {
	const pkg = packageI18n(BOARD, 'es');

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

	// ── Ana rolls 5: mandatory exit, auto-played; the turn passes (5 ≠ 6) ─────
	await roll(ana, 5);
	await expectAnnouncement(berto, /Ana pone una ficha en juego/);
	await expect(circuitCell(berto, 5).locator('.race-piece')).toHaveCount(1);

	// ── Berto rolls 5: exits onto his own start (square 22) ──────────────────
	await roll(berto, 5);
	await expect(circuitCell(ana, 22).locator('.race-piece')).toHaveCount(1);

	// ── Ana rolls 5 again: second exit → two pieces on her start = a barrier ─
	await roll(ana, 5);
	await expect(circuitCell(berto, 5).locator('.race-piece--barrier')).toHaveCount(2);
	// The fresh barrier is VOICED as a landing consequence (after the piece settles).
	await expectAnnouncement(berto, /Ana forma una barrera en la casilla 5/);

	// ── Berto rolls 1: his only circuit piece auto-moves 22 → 23 ─────────────
	await roll(berto, 1);
	await expectAnnouncement(ana, /Berto avanza una ficha hasta la casilla 23/);
	await expect(circuitCell(ana, 23).locator('.race-piece')).toHaveCount(1);

	// ── The players panel wears the squadron identity (no money in a race) ───
	const anaRow = berto.locator('.player-card', { hasText: 'Ana' });
	await expect(anaRow).toHaveAttribute('aria-label', new RegExp(pkg.seats.red));
	await expect(anaRow.locator('.player-card__seat')).toHaveText(pkg.seats.red);

	// ── Keyboard exploration: arrows walk the circuit and voice the cells ────
	// The cursor is parked on MY start square (5 for the red seat), so the first →
	// step walks the player's actual route ahead.
	await ana.locator('#board').focus();
	await ana.keyboard.press('ArrowRight'); // my start (5) → 6
	await expectAnnouncement(ana, /Casilla 6 de 68/);
	await ana.keyboard.press('Home');       // Home = start of the CURRENT lane → square 1
	await expectAnnouncement(ana, /Casilla 1 de 68/);
	// S / Shift+S survey EVERY seat's route landmarks in ring order (salidas and
	// corridor entries of all players in the game), same forward/backward convention
	// as N. Landmarks here: 5 (red start), 17 (blue entry), 22 (blue start), 68
	// (red entry). From square 1 (off-cycle) S enters at the first one.
	await ana.keyboard.press('s');
	await expectAnnouncement(ana, new RegExp(`Casilla 5 de 68.*Seguro.*Salida de ${pkg.seats.red}.*Barrera de Ana`));
	await ana.keyboard.press('s');          // → Berto's corridor entry (17)
	await expectAnnouncement(ana, new RegExp(`Casilla 17 de 68.*Entrada al pasillo de ${pkg.seats.blue}`));
	await ana.keyboard.press('Shift+S');    // and back to Ana's salida
	await expectAnnouncement(ana, /Casilla 5 de 68.*Barrera de Ana/);

	// ── N / Shift+N walk the squares holding pieces, in RING order ────────────
	// (regressions: the family gate used to swallow N entirely, and seat order felt
	// like random jumps — now: circuit ascending [5, 23], then the seat zones.)
	await ana.keyboard.press('n');          // barrier (5) → Berto's piece on 23
	await expectAnnouncement(ana, /Casilla 23 de 68.*Una ficha de Berto/);
	await ana.keyboard.press('n');          // → Ana's home box (2 pieces left), after the ring
	await expectAnnouncement(ana, /Casa de .*2 fichas/);
	await ana.keyboard.press('Shift+N');    // and truly BACK (not the same square again)
	await expectAnnouncement(ana, /Casilla 23 de 68.*Una ficha de Berto/);

	// ── Ctrl+F1 opens the shortcuts help, with the property-only rows hidden ──
	await ana.keyboard.press('Control+F1');
	const help = ana.locator('.game-dialog.dialog-help');
	await expect(help).toBeVisible();
	await expect(help).toContainText('Ir a la siguiente casilla ocupada');
	await expect(help).not.toContainText(/subasta/i); // no auctions in a race
	await ana.keyboard.press('Escape');
	await expect(help).toBeHidden();
	await ana.locator('#board').focus();    // back to the board for the next section

	// ── Typing a square number jumps to that circuit square, 1-based ─────────
	// (regression: the property 0-based translation made "1" dead and "2" land on 1)
	await ana.keyboard.press('2');
	await ana.keyboard.press('3');
	await expectAnnouncement(ana, /Casilla 23 de 68.*Una ficha de Berto/);

	// ── Ana rolls 2: BOTH barrier pieces can move → the choice dialog opens ──
	await roll(ana, 2);
	const dialog = ana.locator('.game-dialog.dialog-race-choice');
	// The dialog waits a beat before taking focus: the roll must be HEARD first (the
	// screen reader's dialog entry cuts off whatever is being spoken).
	await expect(dialog).toBeHidden();
	await expectAnnouncement(ana, /Sacas un 2/);
	await expect(dialog).toBeVisible();
	// The title carries the squadron identity; each option names the piece after the
	// player's token and says WHERE it stands, so the choice is between real positions.
	await expect(dialog.locator('.dialog-title')).toContainText(pkg.seats.red);
	const options = dialog.locator('.dialog-buttons button');
	await expect(options).toHaveCount(2);
	await expect(options.first()).toContainText(/Nave estelar \d, desde tu salida: avanza a la casilla 7/);

	// ── The highlighted destination speaks its MOVE and mirrors the dialog focus ──
	// While choosable, the cell is a real button whose accessible name is the option
	// text (touch screen readers hear the move, not just the square's contents), and
	// the focused option's destination wears the stronger ring.
	await expect(options.first()).toBeFocused();
	const destination = circuitCell(ana, 7);
	await expect(destination).toHaveAttribute('role', 'button');
	await expect(destination).toHaveAttribute('aria-label', /avanza a la casilla 7/);
	await expect(destination).toHaveClass(/race-cell--highlight-focus/);
	// A destination WITHOUT dialog focus must be visibly ringed too, not just carry the
	// class: an invalid box-shadow computes to 'none' and the glow silently vanishes
	// (regression: rgba(var(--accent-rgb…)) was invalid CSS on the property board's twin
	// rule). Both options here share ONE destination (the barrier), so probe the base
	// rule by lifting the focus class for a computed-style read.
	const baseRing = await destination.evaluate(el => {
		el.classList.remove('race-cell--highlight-focus');
		const shadow = getComputedStyle(el).boxShadow;
		el.classList.add('race-cell--highlight-focus');
		return shadow;
	});
	expect(baseRing, 'the non-focused highlight ring must survive (valid box-shadow)').not.toBe('none');

	// ── The choice dialog is NON-modal: the player may leave it to explore the board ──
	// Focus starts on the first option; Escape returns to the board WITHOUT dismissing
	// the dialog; arrows explore; Ctrl+D jumps back into the open dialog.
	await ana.keyboard.press('Escape');
	await expect(ana.locator('#board')).toBeFocused();
	await expect(dialog).toBeVisible(); // Escape must NOT dismiss a pending choice
	await ana.keyboard.press('ArrowRight');
	await expectAnnouncement(ana, /Casilla 6 de 68/);
	await ana.keyboard.press('Control+d');
	await expect(options.first()).toBeFocused();
	// Entering the dialog re-states its title (its reason for being), not just "dialog".
	await expectAnnouncement(ana, new RegExp(`Diálogo: ${pkg.seats.red}`));

	await options.first().click();
	await expect(dialog).toBeHidden();
	// Resolving the choice hands focus back to the board (a closed non-modal dialog
	// would otherwise drop it on <body>).
	await expect(ana.locator('#board')).toBeFocused();

	// The barrier split: one piece stays on 5, the mover stands on 7 — on BOTH boards.
	await expect(circuitCell(ana, 5).locator('.race-piece')).toHaveCount(1);
	await expect(circuitCell(ana, 7).locator('.race-piece')).toHaveCount(1);
	await expect(circuitCell(berto, 7).locator('.race-piece')).toHaveCount(1);
	await expectAnnouncement(berto, /Ana avanza una ficha hasta la casilla 7/);
});

test('a chained bonus choice replaces the dialog with FRESH options', async ({ browser }) => {
	// Field bug: choose a capturing move → the +20 bonus dialog opened showing the
	// PREVIOUS roll's options ("move 1/2/3, capture…") while the voice asked to move 20.
	// Deterministic chase: Ana exits two ships and walks one across the ring after
	// Berto's lone ship, captures it, and must then choose which ship counts the 20.
	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);
	const code = await createGame(ana, 'Ana', BOARD);
	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);

	const roll = async (page: typeof ana, value: number) => {
		await scriptDice(value);
		await actionButton(page, 'rollDice').click();
	};
	const dialog = ana.locator('.game-dialog.dialog-race-choice');
	const rollAndPick = async (value: number, optionIndex = 0) => {
		await roll(ana, value);
		await expect(dialog).toBeVisible();
		await dialog.locator('.dialog-buttons button').nth(optionIndex).click();
		await expect(dialog).toBeHidden();
	};

	await roll(ana, 5);              // exit ship A @5
	await roll(berto, 5);            // Berto exits @22
	await roll(ana, 5);              // exit ship B → barrier @5
	await roll(berto, 2);            // 22 → 24
	// Ana walks her lead ship with 4s (choice each turn: lead vs the one parked at 5).
	for (const step of [4, 4, 4, 4, 4, 4, 4, 4]) {
		await rollAndPick(step, 0);  // lead: 5→9→13→17→21→25→29→33→37
		await roll(berto, 2);        // Berto: 24→26→…→40
	}

	// Ana rolls 3: lead 37 → 40 CAPTURES Berto's ship; the parked ship could go 5 → 8.
	await roll(ana, 3);
	await expect(dialog).toBeVisible();
	const captureOption = dialog.locator('.dialog-buttons button').first();
	await expect(captureOption).toContainText(/come una ficha de Berto/);
	await captureOption.click();

	// THE REGRESSION: the dialog must RE-RENDER for the +20 bonus — fresh title and
	// fresh destinations, never the previous roll's capture options.
	await expect(dialog).toBeVisible();
	await expect(dialog.locator('.dialog-title')).toContainText('20');
	const bonusOptions = dialog.locator('.dialog-buttons button');
	await expect(bonusOptions.first()).toContainText(/avanza a la casilla 60/); // 40 + 20
	await expect(dialog).not.toContainText(/come una ficha/);

	await bonusOptions.first().click();
	await expect(dialog).toBeHidden();
	await expect(ana.locator('#board .race-cell[data-square="60"] .race-piece')).toHaveCount(1);
});
