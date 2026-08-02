// botNames.ts — the "give me a random one" hat for naming bots.
//
// A board's opponents belong to its world. The engine's own names cannot be right for a mining
// game, a galactic empire and a road trip at once, so a PACKAGE declares its own (manifest
// `botNames`: i18n keys into the package's own bundle, which is how every other name a package
// contributes already works), and the engine's list is the deliberately theme-less fallback for
// boards that declare none. This module owns only the choosing.

export const BOT_NAME_COUNT = 16;

export type BotNameTranslator = (key: string) => string;

/** The engine's own names, for a board that brings none. */
export function localizedBotNames(translate: BotNameTranslator): string[] {
	return Array.from({ length: BOT_NAME_COUNT }, (_, index) => translate(`lobby.botNames.${index}`));
}

/**
 * The names on offer: the package's if it declares any, else the engine's. A key that resolves to
 * itself is dropped — a package whose translations have not arrived yet, or that names a key it
 * never defined, must not put a raw key in front of the host as a name to accept.
 */
export function botNamePool(translate: BotNameTranslator, packageKeys?: readonly string[]): string[] {
	const fromPackage = (packageKeys ?? [])
		.map(key => ({ key, name: translate(key) }))
		.filter(entry => !!entry.name && entry.name !== entry.key)
		.map(entry => entry.name);
	return fromPackage.length > 0 ? fromPackage : localizedBotNames(translate);
}

/** A random bot name. `avoid` prevents an immediate repeat when re-rolling. */
export function randomBotName(
	translate: BotNameTranslator,
	avoid?: string,
	packageKeys?: readonly string[],
): string {
	const list = botNamePool(translate, packageKeys);
	const pool = avoid ? list.filter(name => name !== avoid) : list;
	// A board that offers exactly one name still has to answer when the hat is rolled again:
	// give that name back rather than nothing.
	const choices = pool.length > 0 ? pool : list;
	return choices[Math.floor(Math.random() * choices.length)];
}
