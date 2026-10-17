// api.mjs — the one object a scene receives: geometry and booleans (lib), SVG elements (draw)
// and the shared pictograms (pictos). Scenes destructure what they use, so a scene file never
// imports by path and a hidden package's scene can live in its own repository.
import * as lib from './lib.mjs';
import * as draw from './draw.mjs';
import * as pictos from './pictos.mjs';

export const art = Object.freeze({ ...lib, ...draw, ...pictos });

/** Canvas size per asset kind, as the engine renders them. */
export const CANVAS = Object.freeze({ tokens: 24, cards: 64 });

/** Load a scene module and build its drawings. */
export async function loadScene(file) {
	const module = await import(file);
	if (typeof module.default !== 'function' || typeof module.id !== 'string') {
		throw new Error(`${file} must export an id and a default function (art) => ({ cards?, tokens? })`);
	}
	const built = module.default(art);
	return { id: module.id, cards: built.cards ?? {}, tokens: built.tokens ?? {} };
}
