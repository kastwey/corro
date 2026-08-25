// journey-touch.spec.ts — the journey hand on a PHONE.
//
// The card families with a specialised frame (journey's jcard, exploding's xcard) hide each
// card's Play/Discard/Help toolbar behind `:hover`/`:focus-within` and float it over the card.
// A phone has no hover, so the whole toolbar was reachable only through the tap that happens
// to focus the row — and the revealed toolbar then sat ON the card, so the next tap in the
// same place hit Discard. Measured on a 393px viewport before the fix: a 162px toolbar centred
// on a 92px card put Play 27px off the left edge of the screen on the leftmost card and Help
// on top of the neighbouring card, in 20px-tall buttons.
//
// None of that was ever visible to this suite, because every other spec runs a desktop context
// where `(hover: none)` does not match. That is what `touch: true` buys (see newPlayerPage):
// Chromium then reports a hoverless coarse pointer, which is the only state in which the
// touch layout exists at all.
//
// The desktop case is asserted here too, in the same file: the hover overlay is a deliberate
// design for a mouse, and "fixing" mobile by painting the toolbar over every desktop card
// would be a regression of its own.

import { test, expect } from '../helpers/test';
import type { Page } from '../helpers/test';
import { flushAxeAudit } from '../helpers/axeAudit';
import {
	createGame,
	joinGame,
	newPlayerPage,
	resetDice,
	startGame,
} from '../helpers/game';

const BOARD = 'great-route';
/** A small modern phone, the width the fix has to survive. */
const PHONE = { width: 393, height: 727 };
/** WCAG 2.5.8 (AA) asks for 24×24 CSS px; the touch layout targets the 44px of 2.5.5. */
const MIN_TARGET = 44;

test.beforeEach(async () => {
	await resetDice();
});

/** Ana + Berto in a started journey game; Ana's page is the one under test. */
async function startJourney(
	browser: Parameters<typeof newPlayerPage>[0],
	anaOptions: Parameters<typeof newPlayerPage>[2],
): Promise<Page> {
	const ana = await newPlayerPage(browser, 'es-ES', anaOptions);
	const berto = await newPlayerPage(browser);
	const code = await createGame(ana, 'Ana', BOARD);
	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);
	await expect(ana.locator('.hand-card:not(.hand-card--info)')).toHaveCount(6);
	return ana;
}

/** Every card row and action button, measured in the page's own coordinates. */
async function measureHand(page: Page) {
	return page.evaluate(() => {
		const rows = [...document.querySelectorAll<HTMLElement>('.hand-card:not(.hand-card--info)')];
		return {
			viewportWidth: document.documentElement.clientWidth,
			rows: rows.map(row => {
				const box = row.getBoundingClientRect();
				return {
					card: row.getAttribute('aria-label') ?? '',
					row: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
					buttons: [...row.querySelectorAll<HTMLElement>('.hand-card__btn')].map(btn => {
						const b = btn.getBoundingClientRect();
						return {
							label: (btn.textContent ?? '').trim(),
							left: b.left, right: b.right, top: b.top, bottom: b.bottom,
							width: b.width, height: b.height,
						};
					}),
				};
			}),
		};
	});
}

test('journey on a phone: every card carries its own reachable Play/Discard/Help', async ({ browser }) => {
	const ana = await startJourney(browser, { touch: true, viewport: PHONE });

	const cards = ana.locator('.hand-card:not(.hand-card--info)');
	const count = await cards.count();

	// ── The toolbar exists without hover, on EVERY card — not just the focused one. ──
	// The row that owns focus would pass on `:focus-within` alone, and the family drops
	// focus into the hand at the start: asserting only the first card would prove nothing.
	for (let i = 0; i < count; i++) {
		const actions = cards.nth(i).locator('.hand-card__actions');
		await expect(actions).toBeVisible();
		await expect(actions.getByRole('button', { name: 'Jugar' })).toBeVisible();
		await expect(actions.getByRole('button', { name: 'Descartar' })).toBeVisible();
	}

	// ── Geometry: on screen, big enough to hit, and inside its own row. ──────────
	const layout = await measureHand(ana);
	expect(layout.viewportWidth).toBe(PHONE.width);

	for (const { card, row, buttons } of layout.rows) {
		expect(buttons.length, `${card} has no actions`).toBeGreaterThan(0);
		for (const btn of buttons) {
			// Nothing off the edge of the screen. This is the assertion the old layout failed
			// outright: Play sat at x = -27 on the leftmost card.
			expect(btn.left, `"${btn.label}" of ${card} starts off-screen`).toBeGreaterThanOrEqual(0);
			expect(btn.right, `"${btn.label}" of ${card} runs past the screen`)
				.toBeLessThanOrEqual(layout.viewportWidth);
			// A real touch target.
			expect(btn.width, `"${btn.label}" of ${card} is too narrow to tap`)
				.toBeGreaterThanOrEqual(MIN_TARGET);
			expect(btn.height, `"${btn.label}" of ${card} is too short to tap`)
				.toBeGreaterThanOrEqual(MIN_TARGET);
			// Contained by its OWN card's row: the old overlay spilled over the neighbour,
			// so a tap meant for the next card activated this one's Help.
			expect(btn.left, `"${btn.label}" escapes ${card}'s row`)
				.toBeGreaterThanOrEqual(row.left - 0.5);
			expect(btn.right, `"${btn.label}" escapes ${card}'s row`)
				.toBeLessThanOrEqual(row.right + 0.5);
			expect(btn.top, `"${btn.label}" escapes ${card}'s row`).toBeGreaterThanOrEqual(row.top - 0.5);
			expect(btn.bottom, `"${btn.label}" escapes ${card}'s row`)
				.toBeLessThanOrEqual(row.bottom + 0.5);
		}
	}

	// No two rows share a line, so a tap can never be ambiguous about which card it means.
	const tops = layout.rows.map(r => r.row.top);
	expect(new Set(tops).size, 'cards share a line on a phone').toBe(tops.length);

	// ── The trap: tapping the card itself must never discard it. ─────────────────
	// With the overlay, the second tap in the same spot landed on Discard, because the
	// toolbar had just appeared under the finger. Done on a card that does NOT already hold
	// focus, so "the tap moved me here" is a real outcome rather than the starting state.
	const second = cards.nth(1);
	const secondFace = second.locator('.jcard');
	await secondFace.tap();
	await expect(second).toBeFocused();
	await secondFace.tap();
	await expect(ana.locator('.game-dialog.dialog-confirm')).toBeHidden();
	await expect(second).toBeFocused();
	await expect(cards).toHaveCount(6); // nothing was played or thrown away either

	// ── Discarding from a phone, the way a player actually does it. ──────────────
	// Journey gates discard behind drawing ("draw a card first"), so draw first and the
	// flow is then the two deliberate taps it should be: the card's own Discard button,
	// then the irreversible-action confirmation.
	await ana.locator('.hand-panel__draw').tap();
	await expect(cards).toHaveCount(7);

	const doomed = cards.nth(1);
	const doomedLabel = await doomed.getAttribute('aria-label');
	await doomed.getByRole('button', { name: 'Descartar' }).tap();

	const confirm = ana.locator('.game-dialog.dialog-confirm');
	await expect(confirm).toBeVisible();
	await expect(confirm).toContainText('¿Quieres descartar');
	// A dialog is a UI state of its own, and this one only exists on the phone layout.
	await flushAxeAudit(ana);
	await confirm.getByRole('button', { name: 'Descartar' }).tap();

	await expect(confirm).toBeHidden();
	await expect(cards).toHaveCount(6);
	await expect(ana.locator(`.hand-card[aria-label="${doomedLabel}"]`)).toHaveCount(0);
});

test('journey with a mouse: the card keeps its hover overlay', async ({ browser }) => {
	const ana = await startJourney(browser, {});

	// A card that does NOT hold focus: the family drops focus onto the first one, whose
	// toolbar is legitimately shown by `:focus-within`.
	const resting = ana.locator('.hand-card:not(.hand-card--info)').nth(1);
	const actions = resting.locator('.hand-card__actions');

	// A pointer that CAN hover keeps the uncluttered fan: the toolbar is not painted over
	// every card at rest. This is what proves the mobile rule did not leak into the desktop one.
	await expect(actions).toBeHidden();

	await resting.hover();
	await expect(actions).toBeVisible();
	await expect(actions.getByRole('button', { name: 'Jugar' })).toBeVisible();
});
