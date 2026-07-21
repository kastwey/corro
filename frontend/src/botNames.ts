// botNames.ts — the "give me a random one" hat for naming bots. The names themselves are
// localized content under lobby.botNames; this module owns only the random selection.

export const BOT_NAME_COUNT = 16;

export type BotNameTranslator = (key: string) => string;

export function localizedBotNames(translate: BotNameTranslator): string[] {
	return Array.from({ length: BOT_NAME_COUNT }, (_, index) => translate(`lobby.botNames.${index}`));
}

/** A random localized bot name. `avoid` prevents an immediate repeat when re-rolling. */
export function randomBotName(translate: BotNameTranslator, avoid?: string): string {
	const list = localizedBotNames(translate);
	const pool = avoid ? list.filter(n => n !== avoid) : list;
	return pool[Math.floor(Math.random() * pool.length)];
}
