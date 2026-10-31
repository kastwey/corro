/**
 * svgArt.ts — the client half of the package-art gate.
 *
 * The server reduces every token icon and card illustration to a closed SVG subset and
 * re-serialises it in a canonical form (see SvgArtSanitizer on the server). Package art is still
 * uploaded content that ends up in `innerHTML`, so this module accepts ONLY that canonical form:
 * the same eight drawing elements, the same attributes, the same value grammars. Anything else —
 * a stray character between tags, an unknown attribute, a colour that is not hexadecimal — rejects
 * the whole drawing and the caller falls back to its neutral picture. The output is rebuilt from
 * the validated pieces, never copied from the input.
 *
 * Legacy state (games saved before colour art) carries bare path data instead of markup; it is
 * wrapped in the one element it stands for after the same path grammar check.
 */

const ELEMENTS = new Set(['g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);

const GEOMETRY: Record<string, readonly string[]> = {
	g: [],
	path: ['d'],
	rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
	circle: ['cx', 'cy', 'r'],
	ellipse: ['cx', 'cy', 'rx', 'ry'],
	line: ['x1', 'y1', 'x2', 'y2'],
	polyline: ['points'],
	polygon: ['points'],
};

const PRESENTATION = [
	'fill', 'fill-rule', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
	'stroke-miterlimit', 'stroke-opacity', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'transform',
] as const;

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/;
const PATH_DATA = /^[MmZzLlHhVvCcSsQqTtAa0-9.,+\-eE\s]+$/;
const TRANSFORM = /(matrix|translate|scale|rotate|skewX|skewY)\(([^()]*)\)/g;
const KEYWORDS: Record<string, readonly string[]> = {
	'fill-rule': ['nonzero', 'evenodd'],
	'stroke-linecap': ['butt', 'round', 'square'],
	'stroke-linejoin': ['miter', 'round', 'bevel'],
};
const UNIT_INTERVAL = new Set(['opacity', 'fill-opacity', 'stroke-opacity']);

/** Canonical tags only: `<name a="v" b="w"/>`, `<g …>` and `</g>`, double quotes, no entities. */
const TAG = /\s*<(\/?)([a-z]+)((?:\s+[a-z][a-z0-9-]*="[^"<>&]*")*)\s*(\/?)>/y;
const ATTRIBUTE = /\s+([a-z][a-z0-9-]*)="([^"]*)"/g;

function validPathData(value: string): string | null {
	const d = value.trim().replace(/\s+/g, ' ');
	return d.length > 0 && PATH_DATA.test(d) && /^[Mm]/.test(d) && /\d/.test(d) ? d : null;
}

function validNumberList(value: string, minimum: number, even: boolean): string[] | null {
	const numbers = value.trim().split(/[\s,]+/).filter(Boolean);
	if (numbers.length < minimum || (even && numbers.length % 2 !== 0) || !numbers.every((n) => NUMBER.test(n))) return null;
	return numbers;
}

function validGeometry(name: string, value: string): string | null {
	if (name === 'd') return validPathData(value);
	if (name === 'points') {
		const numbers = validNumberList(value, 4, true);
		if (!numbers) return null;
		const pairs: string[] = [];
		for (let i = 0; i < numbers.length; i += 2) pairs.push(`${numbers[i]},${numbers[i + 1]}`);
		return pairs.join(' ');
	}
	return NUMBER.test(value) ? value : null;
}

function validTransform(value: string): string | null {
	const functions: string[] = [];
	let consumed = 0;
	for (const match of value.matchAll(TRANSFORM)) {
		if (value.slice(consumed, match.index).trim() !== '') return null;
		const fn = match[1];
		const args = validNumberList(match[2], 1, false);
		if (!args) return null;
		const arity: Record<string, number[]> = { matrix: [6], translate: [1, 2], scale: [1, 2], rotate: [1, 3], skewX: [1], skewY: [1] };
		if (!arity[fn].includes(args.length)) return null;
		functions.push(`${fn}(${args.join(' ')})`);
		consumed = match.index + match[0].length;
	}
	return functions.length > 0 && value.slice(consumed).trim() === '' ? functions.join(' ') : null;
}

function validPresentation(name: string, value: string): string | null {
	const v = value.trim();
	if (name === 'fill' || name === 'stroke') {
		if (v === 'none' || v === 'currentColor') return v;
		return HEX_COLOR.test(v) ? v : null;
	}
	if (name in KEYWORDS) return KEYWORDS[name].includes(v) ? v : null;
	if (UNIT_INTERVAL.has(name)) {
		if (!NUMBER.test(v)) return null;
		const n = Number(v);
		return n >= 0 && n <= 1 ? v : null;
	}
	if (name === 'stroke-dasharray') {
		if (v === 'none') return v;
		const numbers = validNumberList(v, 1, false);
		return numbers ? numbers.join(' ') : null;
	}
	if (name === 'transform') return validTransform(v);
	return NUMBER.test(v) ? v : null; // stroke-width, stroke-miterlimit, stroke-dashoffset
}

/** Rebuild one tag's attributes in canonical order, or null when any of them is not allowed. */
function rebuildAttributes(element: string, raw: string): string | null {
	const seen = new Map<string, string>();
	for (const match of raw.matchAll(ATTRIBUTE)) {
		const [, name, value] = match;
		if (seen.has(name)) return null;
		const geometry = GEOMETRY[element].includes(name);
		const presentation = (PRESENTATION as readonly string[]).includes(name);
		if (!geometry && !presentation) return null;
		const valid = geometry ? validGeometry(name, value) : validPresentation(name, value);
		if (valid === null) return null;
		seen.set(name, valid);
	}
	let out = '';
	for (const name of [...GEOMETRY[element], ...PRESENTATION]) {
		const value = seen.get(name);
		if (value !== undefined) out += ` ${name}="${value}"`;
	}
	return out;
}

/**
 * Validate canonical package-art markup and return it rebuilt, or null when any part of it falls
 * outside the allowed subset. Bare legacy path data is accepted and wrapped in a `<path>`.
 */
export function sanitizeSvgArt(art: string | null | undefined): string | null {
	if (!art) return null;
	const text = art.trim();
	if (!text.startsWith('<')) {
		const d = validPathData(text.replace(/[^0-9A-Za-z.,\-\s]/g, ''));
		return d ? `<path d="${d}"/>` : null;
	}

	let out = '';
	let drawn = 0;
	const open: string[] = [];
	TAG.lastIndex = 0;
	let position = 0;
	while (position < text.length) {
		TAG.lastIndex = position;
		const match = TAG.exec(text);
		if (!match) return null;
		const [, closing, element, attributes, selfClosing] = match;
		position = TAG.lastIndex;
		if (!ELEMENTS.has(element)) return null;
		if (closing) {
			if (element !== 'g' || attributes || selfClosing || open.pop() !== 'g') return null;
			out += '</g>';
			continue;
		}
		const rebuilt = rebuildAttributes(element, attributes);
		if (rebuilt === null) return null;
		if (element === 'g') {
			if (selfClosing) return null;
			open.push('g');
			out += `<g${rebuilt}>`;
			continue;
		}
		if (!selfClosing) return null;
		drawn++;
		out += `<${element}${rebuilt}/>`;
	}
	if (text.slice(position).trim() !== '' || open.length > 0 || drawn === 0) return null;
	return out;
}
