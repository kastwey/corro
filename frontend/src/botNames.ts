// botNames.ts — the "give me a random one" hat for naming bots: silly, road-trip-flavoured
// names in Spanish and English. Content, not UI strings: they live here (per-language
// arrays a random pick can draw from), not in the i18n catalogs.

export const BOT_NAMES: Record<'es' | 'en', readonly string[]> = {
	es: [
		'Doña Rotonda',
		'Turbo Paco',
		'La Abuela Nitro',
		'Freno de Mano',
		'El Copiloto Fantasma',
		'Pepe Gasolina',
		'Kilometrina',
		'Don Derrape',
		'Intermitente Eterno',
		'Embrague Triste',
		'La Grúa Implacable',
		'Chispas el Veloz',
		'Curva Peligrosa',
		'El Rey del Atasco',
		'Rueda Suelta',
		'Matrícula Borrosa',
	],
	en: [
		'Granny Nitro',
		'Captain Handbrake',
		'Sir Stalls-a-Lot',
		'Turbo Ted',
		'The Phantom Co-driver',
		'Clutch Cassidy',
		'Miles McGiggles',
		'Turn Signal Tim',
		'Roundabout Rita',
		'Diesel Duck',
		'Gravel Gertie',
		'Wrong-Way Wanda',
		'Pothole Pete',
		'Zoom Zoom Zelda',
		'Blinker Bob',
		'Foggy Windshield',
	],
};

/** A random bot name in the given language (anything but Spanish falls back to English).
 *  `avoid` keeps re-rolls fun: the same name never comes up twice in a row. */
export function randomBotName(lang: string, avoid?: string): string {
	const list = BOT_NAMES[lang === 'es' ? 'es' : 'en'];
	const pool = avoid ? list.filter(n => n !== avoid) : list;
	return pool[Math.floor(Math.random() * pool.length)];
}
