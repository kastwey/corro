// familyCardCatalog.ts — "find the card with this id and draw it, whatever family we are playing".
//
// Every card family keeps its catalog in its own slot on the state (explodingDeck, journeyDeck…)
// and draws with its own renderer — most reuse the neutral one, exploding and journey have their
// own faces and backs. Callers that just need the picture (the card-flight layer) asked with a
// chain of `if (gameType === …)` arms that were identical bar the deck and the renderer; the
// registry below holds that pair once, so a new card family adds a line here instead of another
// arm in every caller.
//
// This is a CATALOG LOOKUP, not a renderer: it resolves an id the server sent against the
// package's own cards and hands the definition to a renderer. The renderers themselves never see
// an id — they draw from type, geometry and value, so nothing here can branch on shipped content
// (PackageContentBoundaryTests enforces that on every *CardArt.ts).
//
// ACCESSIBILITY: this is aria-hidden decoration for sighted players. The hand row and the reveal
// text remain the accessible source of a card's localized name and rules — nothing here speaks.

import { genericCardArtHtml, genericCardBackHtml } from './cardArt.js';
import { explodingCardArtHtml, explodingCardBackHtml } from './explodingCardArt.js';
import { journeyCardArtHtml, journeyCardBackHtml } from './journeyCardArt.js';
import { tSync } from './i18nBinder.js';
import type { GameState } from './models.js';

/** Find the card in a family's catalog and draw it under its localized name. */
function draw<TCard extends { id: string; nameKey: string }>(
	deck: TCard[] | null | undefined,
	cardId: string,
	render: (def: TCard, name: string) => string,
): string | null {
	const def = deck?.find(card => card.id === cardId);
	return def ? render(def, tSync(def.nameKey)) : null;
}

interface FamilyCardArt {
	/** The card's face, or null when this family's catalog does not hold that id. */
	face(state: GameState, cardId: string): string | null;
	back(): string;
}

const FAMILY_CARD_ART: Record<string, FamilyCardArt> = {
	exploding: {
		face: (s, id) => draw(s.explodingDeck, id, explodingCardArtHtml),
		back: explodingCardBackHtml,
	},
	journey: {
		face: (s, id) => draw(s.journeyDeck, id, journeyCardArtHtml),
		back: journeyCardBackHtml,
	},
	assembly: {
		face: (s, id) => draw(s.assemblyDeck, id, genericCardArtHtml),
		back: genericCardBackHtml,
	},
	draft: {
		face: (s, id) => draw(s.draftDeck, id, genericCardArtHtml),
		back: genericCardBackHtml,
	},
	shedding: {
		face: (s, id) => draw(s.sheddingDeck, id, genericCardArtHtml),
		back: genericCardBackHtml,
	},
};

/** The card back this family shows; the neutral back for families with no card art of their own. */
export function familyCardBackHtml(state: GameState | null | undefined): string {
	return (state?.gameType ? FAMILY_CARD_ART[state.gameType] : undefined)?.back() ?? genericCardBackHtml();
}

/**
 * The face of `cardId` in the family currently being played. Falls back to the card BACK whenever
 * the card cannot be drawn — no id (a face-down move), a family with no catalog, or an id the
 * catalog does not hold (a rival's card the projection stripped) — so a caller always has markup.
 */
export function familyCardFaceHtml(state: GameState | null | undefined, cardId: string | null): string {
	const family = state?.gameType ? FAMILY_CARD_ART[state.gameType] : undefined;
	const face = family && cardId && state ? family.face(state, cardId) : null;
	return face ?? familyCardBackHtml(state);
}
