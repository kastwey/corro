// shedding-match-end.spec.ts — the shedding family from the first card to the LAST one.
//
// Everything the family's other specs do stops a few tricks in: the hands are still full when
// they finish, so a shedding round had never once been played out in a browser, and the states a
// finishing match reaches — the last card leaving a hand, the scoring lines, the end screen —
// had never been rendered, never been audited, never been read aloud in a test. Both tests here
// end a match, for two different reasons.
//
//  1. "a whole round…" plays Four Colours, the real shipped package, until a hand empties. It is
//     the coverage: an actual match, with the accessibility gate watching every state it passes.
//  2. "a rounds ending…" is the regression for the double ending fixed in f19356c (found by
//     kastwey reviewing PR #11): a match played to a fixed number of ROUNDS was still checking
//     the target score, which under penalty scoring a match crosses on the way, so the table
//     heard somebody "lose" and somebody else win, for one match.
//
// The deal is READ, not written down: the E2E identity shuffle keeps a deck in cards.json order
// and deals from its tail, so reproducing that here from the package's own files pins the
// determinism once, in a form that survives a reordered deck instead of breaking on it.

import { expect, test } from '../helpers/test';
import type { Locator, Page } from '@playwright/test';
import { flushAxeAudit } from '../helpers/axeAudit';
import {
	appI18n,
	createGame,
	expectAnnouncement,
	joinGame,
	newPlayerPage,
	packageCards,
	packageI18n,
	packageManifest,
	resetDice,
	startGame,
} from '../helpers/game';

interface DeckCard {
	id: string;
	type: string;
	color?: string;
	value?: number;
	count?: number;
	nameKey: string;
}

/** The deck as the server holds it: every copy of every card, in the order the package ships
 *  them, which is the order the E2E identity shuffle leaves untouched. */
function drawPile(packageId: string): string[] {
	return (packageCards(packageId) as DeckCard[])
		.flatMap(card => Array.from({ length: Math.max(1, card.count ?? 1) }, () => card.id));
}

/**
 * Reproduce `SheddingRulebook.DealRound` for the identity shuffle: hands come off the TAIL of
 * the pile, one card at a time round-robin, and then the opener is flipped from the tail until
 * a NUMBER shows — action cards sliding under the pile as they are passed over.
 *
 * The DEAL is safe to duplicate here (it is arithmetic on a known order, and the alternative is
 * a spec full of card names that a reordered deck silently invalidates). What must never be
 * duplicated is the play: who may answer what, and who wins, stay the server's answer.
 */
function deal(packageId: string, seats: number): {
	hands: string[][]; opener: DeckCard; drawCount: number;
} {
	const catalog = new Map((packageCards(packageId) as DeckCard[]).map(card => [card.id, card]));
	const handSize = packageManifest(packageId).sheddingRules.handSize as number;
	const pile = drawPile(packageId);
	const hands: string[][] = Array.from({ length: seats }, () => []);
	for (let round = 0; round < handSize; round++) {
		for (const hand of hands) hand.push(pile.pop()!);
	}
	let flipped = catalog.get(pile.pop()!)!;
	while (flipped.type !== 'number') {
		pile.unshift(flipped.id);
		flipped = catalog.get(pile.pop()!)!;
	}
	return { hands, opener: flipped, drawCount: pile.length };
}

/** A spoken line from the app's own locale table, as a matcher: the placeholders become
 *  wildcards and the rest stays literal. Worth the indirection for a line a test asserts is
 *  NEVER heard — a copied-out wording stops matching the day somebody rewords it, and the
 *  assertion then holds forever, proving nothing. */
function spokenLine(key: string): RegExp {
	const template = appI18n('es').game[key] as string;
	return new RegExp(template
		.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
		.replace(/\\\{\\\{\w+\\\}\\\}/g, '.+'));
}

const heldCards = (page: Page) => page.locator('.hand-card:not(.hand-card--info)');
const playableCards = (page: Page) =>
	page.locator('.hand-card:not(.hand-card--info):not(.hand-card--unplayable)');
const turnName = (page: Page) => page.locator('#turn-indicator .turn-indicator__name');

const cardIds = (cards: Locator): Promise<string[]> =>
	cards.evaluateAll(items => items.map(item => (item as HTMLElement).dataset.cardId ?? ''));

test.beforeEach(async () => {
	await resetDice();
});

test('shedding: a whole Four Colours round is played out, and the match ends with it', async ({ browser }) => {
	const BOARD = 'four-colours';
	const catalog = new Map((packageCards(BOARD) as DeckCard[]).map(card => [card.id, card]));
	const colourOf = (cardId: string) => catalog.get(cardId)?.color;
	const colourWord = (colour: string) => packageI18n(BOARD, 'es').colors[colour] as string;
	/** Last resort for a wild played out of a hand that holds nothing else: any colour the deck
	 *  has is a legal answer, and the menu offers exactly those. */
	const anyColour = (packageCards(BOARD) as DeckCard[]).find(card => card.color)!.color!;

	/** The colour this hand is longest in — what a person leads with, and what they name after a
	 *  wild. Not strategy for its own sake: a table that answers at random can walk the whole
	 *  108-card deck without either hand emptying, and the round would never finish. */
	const longestColour = (hand: string[]): string | undefined => {
		const holdings = new Map<string, number>();
		for (const colour of hand.map(colourOf)) {
			if (colour) holdings.set(colour, (holdings.get(colour) ?? 0) + 1);
		}
		return [...holdings.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
	};

	/** Of the cards the table says are playable, the one a person would choose: the colour they
	 *  hold most of, keeping the wilds for when nothing else fits. */
	const choose = (options: string[], hand: string[]): string => {
		const holdings = (cardId: string) => {
			const colour = colourOf(cardId);
			return colour ? hand.filter(held => colourOf(held) === colour).length : -1;
		};
		return [...options].sort((a, b) => holdings(b) - holdings(a))[0];
	};

	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);

	// A match of exactly one round: the house rule PR #11 added is also what makes an ending
	// reachable in a browser at all — the classic race to 500 points needs a dozen of them.
	const code = await createGame(ana, 'Ana', BOARD, {
		houseRules: { sheddingEndMode: 'rounds', sheddingRounds: 1 },
	});
	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);

	// ── The deal, predicted from the package and confirmed by the table itself. This is the one
	// assertion that pins the deck order, and it fails saying so. ──
	const dealt = deal(BOARD, 2);
	await expect(heldCards(ana)).toHaveCount(dealt.hands[0].length);
	expect((await cardIds(heldCards(ana))).sort()).toEqual([...dealt.hands[0]].sort());
	expect((await cardIds(heldCards(berto))).sort()).toEqual([...dealt.hands[1]].sort());

	await heldCards(ana).first().focus();
	await ana.keyboard.press('d');
	const openerName = packageI18n(BOARD, 'es').cards[dealt.opener.nameKey.split('.')[1]] as string;
	await expectAnnouncement(ana, new RegExp(
		`Mazo: ${dealt.drawCount}\\. Arriba: ${openerName}, color en vigor ${colourWord(dealt.opener.color!)}\\.`));

	// ── The round, played out. Each side answers on its own turn with a real key press, and the
	// SERVER decides throughout what may be answered: the test reads playability off the hand it
	// is given and never computes it. ──
	const seats: Record<string, Page> = { Ana: ana, Berto: berto };
	const endScreen = ana.locator('.end-screen');
	let actions = 0;
	let wildMenuAudited = false;
	// Whose turn it is arrives at each browser as its own delivery, so ask the page that acted
	// LAST: it is the one that has certainly seen the state its own action produced. Asking the
	// other one can return the previous turn, and the round then hangs pressing keys on a page
	// that will refuse them.
	let informant = ana;
	while (!await endScreen.isVisible()) {
		// This deck and these two hands finish in 31 actions, and the identity shuffle makes that
		// the same 31 every run; the cap is loose enough to absorb a reordered deck and tight
		// enough that a round which is going nowhere says so instead of timing out silently.
		expect(actions++, 'the round should have ended by now').toBeLessThan(80);

		const name = (await turnName(informant).textContent())?.trim() ?? '';
		const page = seats[name];
		expect(page, `the turn indicator named "${name}"`).toBeTruthy();
		await expect(turnName(page)).toHaveText(name);
		informant = page;

		// Mid-round, with both hands full and the discards busy: the state a card family spends
		// almost all its time in, and one no scan had ever settled on.
		if (actions === 4) await flushAxeAudit(page);

		let hand = await cardIds(heldCards(page));
		if ((await playableCards(page).count()) === 0) {
			await page.locator('#board').focus();
			await page.keyboard.press(' ');
			// Either the drawn card fits — the game pauses on the drawer's own choice — or the
			// turn has already moved on with it.
			const drawn = heldCards(page).filter({ hasText: /recién robada/ });
			await expect.poll(async () => await drawn.count() > 0
				|| (await turnName(page).textContent())?.trim() !== name).toBe(true);
			if (await drawn.count() === 0) continue;
			// The card that was just drawn is now in hand, and during the pause it is the only
			// one the table will accept.
			hand = await cardIds(heldCards(page));
		}

		const wanted = choose(await cardIds(playableCards(page)), hand);
		const card = page.locator(`.hand-card[data-card-id="${wanted}"]:not(.hand-card--unplayable)`).first();
		await card.focus();
		await page.keyboard.press('Enter');
		if (!colourOf(wanted)) {
			// A wild names the colour in force through a menu — a state the family's other specs
			// never open, so this is also the first time Axe sees it.
			const menu = page.locator('.popup-menu[role="menu"]');
			await expect(menu).toBeVisible();
			if (!wildMenuAudited) {
				await flushAxeAudit(page);
				wildMenuAudited = true;
			}
			const colour = longestColour(hand.filter(held => held !== wanted)) ?? anyColour;
			await menu.locator('.popup-menu__item', { hasText: colourWord(colour) }).click();
		}
		await expect.poll(async () => await heldCards(page).count() < hand.length
			|| await endScreen.isVisible()).toBe(true);
	}

	// ── The end of the match, on both tables. The round winner is the hand that emptied, and
	// under the classic count they bank the points the loser was still holding — the total is
	// spoken, so the line proves the round was really scored and not merely stopped. ──
	await expectAnnouncement(ana,
		/(se queda|Te quedas) sin cartas y (gana|ganas) la ronda 1.*: \d+ en total/);
	await expectAnnouncement(berto, /¡Fin del juego!/);
	await expect(ana.locator('.end-screen')).toBeVisible();
	await expect(berto.locator('.end-screen')).toBeVisible();
	await expect(ana.locator('.end-screen__standings tbody tr')).toHaveCount(2);
	await expect(ana.locator('.end-screen__winner-row')).toHaveCount(1);
	// The busiest board of the run is the one nobody had ever audited: do it here, deliberately,
	// rather than trusting a mutation observer to have caught it mid-hand.
	await flushAxeAudit(ana);
	await flushAxeAudit(berto);
});

test('shedding: a rounds ending never also announces a loss on the target nobody set', async ({ browser }) => {
	// The E2E-only fixture package deals ONE card each and plays a single penalty round, so the
	// whole match is one key press. Its target score sits at 1, which is the discriminating
	// condition and cannot be reached through the shipped package: the lobby HIDES the target
	// field under a rounds ending (manifest showWhen), so a host can never lower Four Colours'
	// 500, and a one-round hand never adds up to that.
	const BOARD = 'one-play-match';
	const rules = packageManifest(BOARD).sheddingRules;
	expect(rules.endMode).toBe('rounds');
	expect(rules.scoring).toBe('penalty');

	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);
	const code = await createGame(ana, 'Ana', BOARD);
	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);

	const dealt = deal(BOARD, 2);
	await expect(heldCards(ana)).toHaveCount(1);
	expect(await cardIds(heldCards(ana))).toEqual(dealt.hands[0]);
	expect(await cardIds(heldCards(berto))).toEqual(dealt.hands[1]);

	// Ana's only card answers the opener, so her hand empties: the round ends, and with it the
	// match. Berto is left holding 9 points against him — nine times the target that is NOT in
	// force here, which is exactly what the fix has to ignore.
	await ana.locator('#board').focus();
	await heldCards(ana).first().focus();
	await ana.keyboard.press('Enter');

	await expectAnnouncement(ana, /Te quedas sin cartas y ganas la ronda 1/);
	await expectAnnouncement(ana, /A Berto le quedan 9 puntos en la mano/);
	await expectAnnouncement(ana, /¡Fin del juego!/);
	await expectAnnouncement(berto, /¡Fin del juego!/);

	// One ending, and it is that one. The line that used to follow — "Berto reaches 1 point and
	// loses the match with 9", spoken to Berto in the first person — is checked for AFTER the
	// game is over, when it would already have been said.
	for (const [page, lost] of [
		[ana, spokenLine('shedding_match_lost')],
		[berto, spokenLine('shedding_match_lost_self')],
	] as const) {
		const heard: string[] = await page.evaluate(() => (window as any).__announcements ?? []);
		expect(heard.filter(line => lost.test(line)), `heard:\n- ${heard.join('\n- ')}`).toEqual([]);
	}

	// Penalty scoring: the lowest total wins, and here that is the hand that emptied.
	await expect(ana.locator('.end-screen')).toBeVisible();
	await expect(berto.locator('.end-screen')).toBeVisible();
	await expect(berto.locator('.end-screen__winner-row')).toContainText('Ana');
	await flushAxeAudit(ana);
	await flushAxeAudit(berto);
});
