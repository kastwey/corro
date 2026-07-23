// visualNarrativePolicy.ts — client presentation policy for authoritative announcements.
//
// Most visual mechanics arrive with explicit server `visual*` metadata. Property predates that
// contract and already has a stable, curated list of salient announcements, so its former toast
// policy moves here unchanged. This selects PRESENTATION only: the server still owns every word.

export type VisualNarrativeTone = 'gain' | 'loss' | 'neutral';

export interface VisualNarrativePolicy {
	kind: string;
	tone: VisualNarrativeTone;
}

const PROPERTY_NARRATIVE_TONES: Readonly<Record<string, VisualNarrativeTone>> = {
	'game.passed_through_go': 'gain',
	'game.landed_on_go': 'gain',
	'game.free_parking_collect': 'gain',
	'game.collected_from_all': 'gain',
	'game.group_completed': 'gain',
	'game.game_over': 'gain',
	'game.debt_cleared': 'gain',

	'game.rent_paid': 'loss',
	'game.tax_paid': 'loss',
	'game.paid_all_players': 'loss',
	'game.paid_repairs': 'loss',
	'game.paid_holding_release_cost': 'loss',
	'game.send_to_holding': 'loss',
	'game.sent_to_holding_by_card': 'loss',
	'game.player_bankrupt': 'loss',

	'game.property_purchased': 'neutral',
	'game.auction_won': 'neutral',
	'game.building_built': 'neutral',
	'game.buildings_sold': 'neutral',
	'game.property_mortgaged': 'neutral',
	'game.property_unmortgaged': 'neutral',
	'game.trade_completed': 'neutral',
};

/** Audience variants share one visual policy while retaining their personalized sentence. */
export function baseVisualAnnouncementKey(key: string): string {
	for (const suffix of ['_victim_team', '_victim', '_self']) {
		if (key.endsWith(suffix)) return key.slice(0, -suffix.length);
	}
	return key;
}

/** Property's former toast selection, now rendered by the shared persistent narrative. */
export function visualNarrativePolicyForAnnouncement(key: string): VisualNarrativePolicy | null {
	if (!key) return null;
	const tone = PROPERTY_NARRATIVE_TONES[baseVisualAnnouncementKey(key)];
	return tone ? { kind: 'outcome', tone } : null;
}
