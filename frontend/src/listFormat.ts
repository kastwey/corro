// listFormat.ts — joining items the way a SPOKEN sentence needs them.
//
// It lives on its own because both the board and the lobby compose lists of names, and the
// lobby must not pull a game surface in just to say "Ana, Berto y Carla".

import { i18nBinder } from './i18nBinder.js';

/** Join items the way a SPOKEN sentence needs them — "A, B y C" / "A, B, and C". The screen
 *  reader hears a composed label as one line, so the last connector carries the flow; visual
 *  separators ("·", ";") don't speak and leave a soup of juxtaposed facts. */
export function joinList(items: string[], lang: string = i18nBinder.getCurrentLanguage()): string {
	try {
		return new Intl.ListFormat(lang, { style: 'long', type: 'conjunction' }).format(items);
	} catch {
		return items.join(', ');
	}
}
