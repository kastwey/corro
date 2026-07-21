import type { Square } from './models.js';

/**
 * A square's display name in the given language: `names[lang]` when the board provides it,
 * otherwise the canonical `name`. So a localized package shows each player the board in their
 * own language, while single-language boards and partial translations just fall back gracefully.
 */
export function localizedSquareName(square: Pick<Square, 'name' | 'names'>, lang: string): string {
	return square.names?.[lang] ?? square.name;
}

/**
 * Resolve a per-locale text map to a language: the requested language if present, else any
 * available translation (a partial translation still shows *something*). For content with no
 * canonical fallback string, like a package card's text.
 */
export function pickLocale(map: Record<string, string> | undefined, lang: string): string {
	if (!map) return '';
	return map[lang] ?? Object.values(map)[0] ?? '';
}

/**
 * A non-hex `color` value is really a special TYPE the board carries in the colour slot with no
 * group-name key — a railroad ("transit") or utility ("utility"). Return the translated TYPE word
 * ("station"/"utility") when there is a `game.term_<color>` key for it, else null so the caller
 * can fall back to a plain colour word.
 */
function typeTerm(color: string, translate: (key: string) => string): string | null {
	const term = translate(`game.term_${color}`);
	return term && term !== `game.term_${color}` ? term : null;
}

/**
 * The screen-reader text for a square's group/colour: the group's name resolved from its i18n key
 * ("Group: Brown") against the merged app + package translations — falling back to the key's text
 * literally when there's no translation (so an upload can use a plain name). With no group key it
 * announces the TYPE word for a special group ("station"/"utility", no "Color:" prefix — a station
 * is not a colour), else a real colour word ("Color: brown"); a raw colour value such as a hex
 * ("#8a5a2b") is meaningless read aloud, so it returns '' (nothing announced).
 *
 * `translate` resolves FULL i18n keys against the merged app + package store (pass i18next's raw
 * tSync, not a namespaced wrapper): the fixed labels use `game.group`/`game.color`, and the group
 * name key (`groups.g1`, `game.color_brown`, …) is already a full key.
 */
export function squareGroupLabel(
	square: Pick<Square, 'groupNameKey' | 'color'>,
	translate: (key: string) => string,
	localizeColor: (color: string) => string,
): string {
	const key = square.groupNameKey;
	if (key) {
		const resolved = translate(key);
		const name = resolved && resolved !== key ? resolved : key; // translated, else the key/text itself
		return `${translate('game.group')}: ${name}`;
	}
	const color = square.color;
	if (color && !/^#?[0-9a-fA-F]{3,8}$/.test(color)) {
		// A station/utility announces its type ("station"/"utility") with no "Color:" prefix
		// instead of the nonsense "Color: transit"; a classic colour keeps the "Color:" prefix.
		return typeTerm(color, translate) ?? `${translate('game.color')}: ${localizeColor(color)}`;
	}
	return '';
}

/**
 * A square's group display NAME (no "Grupo:" prefix) for swatch/list labels: the group's name key
 * resolved (a FULL key — pass tSync), else the localized colour word for a classic named colour, else
 * '' (a bare hex like "#8a5a2b" is meaningless read aloud). Same rules as {@link squareGroupLabel},
 * without the label prefix — used by the trade / manage-properties / player-detail lists.
 */
export function groupDisplayName(
	prop: { groupNameKey?: string; color?: string | null },
	translate: (key: string) => string,
	localizeColor: (color: string) => string,
): string {
	const key = prop.groupNameKey;
	if (key) {
		const resolved = translate(key);
		return resolved && resolved !== key ? resolved : key;
	}
	const color = prop.color;
	if (color && !/^#?[0-9a-fA-F]{3,8}$/.test(color)) {
		// A special TYPE (railroad "transit", "utility") carries its type string as the colour
		// and has no group name key — name the TYPE ("station"/"utility") instead of echoing
		// the raw word "transit" (the trade list used to read "Central Station, transit").
		return typeTerm(color, translate) ?? localizeColor(color);
	}
	return '';
}

/** Generic landing behaviour -> the i18n key for its display name, for squares a board leaves unnamed. */
const CORNER_NAME_KEY: Record<string, string> = {
	start: 'game.square_start',
	justVisiting: 'game.square_holding',
	freeParking: 'game.square_free_parking',
	sendToHolding: 'game.square_send_to_holding',
};

/**
 * Best display name for a square, so a package board that doesn't name every square is never
 * blank: its per-locale name, else its deck's name (for card squares), else a generic label from
 * its behaviour (corners), else the canonical name (possibly empty). `translate` returns the key
 * unchanged when missing, which is treated as "no translation".
 */
export function resolveSquareName(
	square: Pick<Square, 'name' | 'names' | 'deck' | 'behavior'>,
	lang: string,
	decks: ReadonlyArray<{ id: string; label: string }>,
	translate: (key: string) => string,
): string {
	const explicit = localizedSquareName(square, lang);
	if (explicit) return explicit;

	if (square.deck) {
		const deck = decks.find(d => d.id === square.deck);
		if (deck?.label) return deck.label;
	}

	const key = square.behavior ? CORNER_NAME_KEY[square.behavior] : undefined;
	if (key) {
		const label = translate(key);
		if (label && label !== key) return label;
	}

	return square.name;
}
