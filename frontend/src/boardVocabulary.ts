import { i18nBinder, tSync } from './i18nBinder.js';
import type { GameState } from './models.js';

/**
 * Generic, board-agnostic fallback term keys (in the app's own i18n). A board overrides each via its
 * own i18n keys (the manifest's `terminology`/`building`/`currency.nameKey` and the transit/utility
 * group names); when it declares none, these neutral words keep announcements reading naturally —
 * never branded and never hardcoded per board.
 */
const TERM_FALLBACK: Record<string, string> = {
	holding: 'game.term_holding',
	freeparking: 'game.term_free_parking',
	sendtoholding: 'game.term_send_to_holding',
	start: 'game.term_start',
	transit: 'game.term_transit',
	utility: 'game.term_utility',
	building: 'game.term_building',
	buildings: 'game.term_buildings',
	bigBuilding: 'game.term_big_building',
};

/** The package corners exposed as i18n variables, keyed by the manifest `terminology` field name. */
const CORNER_TERMS = ['holding', 'freeparking', 'sendtoholding', 'start'] as const;
/** The square types whose board name comes from the like-named group (transit, utility). */
const TYPE_TERMS = ['transit', 'utility'] as const;

/**
 * Resolves an i18n key against the merged app + package translations for the given language: the
 * translated text, or '' when the key is absent/unresolved (so the caller can fall back). Everything
 * translatable in a package is a key now (only the board `name`, shown in the lobby before the i18n
 * merge, stays inline) — so the board's words come from its `i18n/{lang}.json` like any other string.
 */
function resolveKey(key: string | null | undefined, lang: string): string {
	if (!key) return '';
	const text = tSync(key, { lng: lang });
	return text && text !== key ? text : '';
}

/**
 * Installs the active board's vocabulary into i18next so EVERY translation can reference the board's
 * own words: `{{currency}}` / the `money` formatter for amounts, and `{{holding}}`, `{{freeparking}}`,
 * `{{transit}}`, `{{utility}}`, `{{building}}`, … for the corners, special types and building tiers.
 * The app strings stay generic; the board supplies the nouns via its own i18n keys — so no board ever
 * overrides an announcement, and nothing is hardcoded. Re-run on every state update / language change.
 */
export function setBoardVocabulary(gs: GameState | null | undefined, lang: string): void {
	const symbol = gs?.currency?.symbol || '€';

	const vars: Record<string, string> = {
		// The spoken currency word ("euros"/"credits") for "{{amount}} {{currencyName}}" strings,
		// from the board's currency.nameKey; falls back to its symbol when it names none.
		currencyName: resolveKey(gs?.currency?.nameKey, lang) || symbol,
	};

	// Corners: the package's terminology key for each, else the generic fallback word.
	const terminology = gs?.terminology ?? {};
	for (const term of CORNER_TERMS) {
		vars[term] = resolveKey(terminology[term], lang) || tSync(TERM_FALLBACK[term], { lng: lang });
	}

	// Special types (transit/utility): the name of the like-named group, else the generic fallback.
	for (const type of TYPE_TERMS) {
		const group = gs?.groups?.find(g => g.id === type);
		vars[type] = resolveKey(group?.colorName, lang) || tSync(TERM_FALLBACK[type], { lng: lang });
	}

	// Building tiers: the board's own names for the small/big constructions, else generic fallbacks.
	const b = gs?.building;
	vars.building = resolveKey(b?.smallKey, lang) || tSync(TERM_FALLBACK.building, { lng: lang });
	vars.buildings = resolveKey(b?.smallPluralKey, lang) || tSync(TERM_FALLBACK.buildings, { lng: lang });
	vars.bigBuilding = resolveKey(b?.bigKey, lang) || tSync(TERM_FALLBACK.bigBuilding, { lng: lang });

	i18nBinder.setBoardContext(symbol, vars);
}
