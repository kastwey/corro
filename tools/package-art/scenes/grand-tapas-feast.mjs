// grand-tapas-feast — draft family: tapas dishes in colour.

export const id = 'grand-tapas-feast';

/** Build the drawings with the package-art API (lib + draw + pictos helpers). */
export default function (art) {
	const { C, E, R, P, Ln, L, S, G, Curve, arcD, sectorD, starPts, T, dark, light, OUT, INK, WHITE, digits } = art;

const PLATE = '#eceff1';
const OLIVE = '#6d8b3a';
const BREAD = '#e0a96d';
const TOMATO = '#e53935';

const plate = (cx, cy, rx, ry = rx * 0.35) => [E(cx, cy, rx, ry, 0, { fill: PLATE, stroke: '#90a4ae', sw: OUT }), E(cx, cy, rx * 0.72, ry * 0.6, 0, { fill: WHITE, stroke: '#cfd8dc', sw: 1 })];
const olive = (cx, cy, r, color = OLIVE) => [E(cx, cy, r, r * 1.25, -20, { fill: color, stroke: dark(color), sw: OUT }), E(cx, cy + r * 0.1, r * 0.3, r * 0.45, -20, { fill: TOMATO }), E(cx - r * 0.35, cy - r * 0.5, r * 0.22, r * 0.32, -20, { fill: WHITE, fo: 0.5 })];
const skewer = (x1, y1, x2, y2) => [Ln(x1, y1, x2, y2, { stroke: '#8d6e63', sw: 3, cap: 'round' }), Ln(x1, y1, x2, y2, { stroke: '#bcaaa4', sw: 1.2, cap: 'round' })];
const croquette = (cx, cy, rot = 0) => [E(cx, cy, 15, 9, rot, { fill: '#d9873a', stroke: dark('#d9873a'), sw: OUT }), ...[[-8, -2], [0, 3], [7, -3], [-3, -5], [4, 0]].map(([x, y]) => C(cx + x * Math.cos(rot * Math.PI / 180) - y * Math.sin(rot * Math.PI / 180), cy + x * Math.sin(rot * Math.PI / 180) + y * Math.cos(rot * Math.PI / 180), 1.3, { fill: dark('#d9873a'), fo: 0.6 }))];
const tapa = (cx, cy) => [E(cx, cy, 7, 4, 0, { fill: BREAD, stroke: dark(BREAD), sw: 1.6 }), E(cx, cy - 3, 5, 3, 0, { fill: TOMATO, stroke: dark(TOMATO), sw: 1.4 }), ...skewer(cx, cy - 10, cx, cy + 1)];
const portion = (n) => [...plate(32, 42, 28, 11), ...(n === 1 ? tapa(32, 38) : n === 2 ? [...tapa(22, 38), ...tapa(42, 38)] : [...tapa(18, 40), ...tapa(32, 34), ...tapa(46, 40)])];

const cards = {
	'caramel-custard': [
		...plate(32, 48, 28, 10),
		P('M16 46L20 22H44L48 46Z', { fill: '#f7d774', stroke: dark('#f7d774'), sw: OUT, join: 'round' }),
		P('M20 22H44L45 28C40 31 24 31 19 28Z', { fill: '#a0522d', stroke: dark('#a0522d'), sw: 1.6, join: 'round' }),
		P('M24 29C26 36 24 40 23 44', { fill: 'none', stroke: '#a0522d', sw: 3, cap: 'round' }),
		E(30, 36, 2.5, 6, 0, { fill: WHITE, fo: 0.4 }),
	],
	olives: [...plate(32, 44, 28, 11), P('M10 40C12 50 52 50 54 40Z', { fill: '#c8e6c9', stroke: '#81c784', sw: OUT }), ...olive(22, 36, 6), ...olive(34, 32, 6.5), ...olive(44, 37, 6), ...olive(30, 42, 5, '#3e3b32')],
	'portion-1': portion(1),
	'portion-2': portion(2),
	'portion-3': portion(3),
	croquette: [...plate(32, 46, 28, 10), ...croquette(24, 38, -15), ...croquette(42, 34, 10)],
	'small-sandwich': [
		...plate(32, 50, 28, 9),
		E(32, 44, 20, 7, 0, { fill: BREAD, stroke: dark(BREAD), sw: OUT }),
		P('M12 40C18 34 46 34 52 40C50 44 14 44 12 40Z', { fill: '#ef9a9a', stroke: dark('#ef9a9a'), sw: 1.4 }),
		P('M13 36C20 32 44 32 51 36L50 39C44 36 20 36 14 39Z', { fill: '#8bc34a', stroke: dark('#8bc34a'), sw: 1.2 }),
		E(32, 30, 20, 8, 0, { fill: BREAD, stroke: dark(BREAD), sw: OUT }),
		E(28, 27, 5, 2, 0, { fill: WHITE, fo: 0.45 }),
		...skewer(40, 8, 40, 34),
	],
	'olive-skewer': [...skewer(14, 54, 50, 10), ...olive(22, 46, 5.5), ...olive(32, 36, 5.5, '#3e3b32'), ...olive(42, 26, 5.5)],
	'serving-tongs': [
		P('M18 8C10 30 14 48 24 56', { fill: 'none', stroke: '#b0bec5', sw: 6, cap: 'round' }),
		P('M46 8C54 30 50 48 40 56', { fill: 'none', stroke: '#b0bec5', sw: 6, cap: 'round' }),
		P('M18 8C10 30 14 48 24 56', { fill: 'none', stroke: INK, sw: 1.2 }), P('M46 8C54 30 50 48 40 56', { fill: 'none', stroke: INK, sw: 1.2 }),
		R(22, 54, 20, 6, 3, { fill: '#b0bec5', stroke: INK, sw: 1.4 }),
		R(26, 4, 12, 8, 3, { fill: '#546e7a', stroke: INK, sw: 1.4 }),
	],
	'spicy-sauce': [
		R(24, 4, 16, 8, 2, { fill: '#8d6e63', stroke: dark('#8d6e63'), sw: OUT }),
		P('M26 12H38V20C44 22 46 30 46 36V54A4 4 0 0 1 42 58H22A4 4 0 0 1 18 54V36C18 30 20 22 26 20Z', { fill: TOMATO, stroke: dark(TOMATO), sw: OUT, join: 'round' }),
		R(22, 32, 20, 16, 2, { fill: WHITE, stroke: dark(TOMATO), sw: 1.4 }),
		P('M28 46C30 36 34 34 36 36C38 40 34 44 32 46Z', { fill: TOMATO }), L(starPts(37, 37, 5, 3, 1.2), { fill: '#ffca28' }, true),
		E(23, 28, 1.6, 8, 0, { fill: WHITE, fo: 0.4 }),
	],
	'potato-omelette': [
		...plate(32, 48, 28, 10),
		P('M8 44L32 14L56 44Z', { fill: '#f5c542', stroke: dark('#f5c542'), sw: OUT, join: 'round' }),
		P('M14 42L32 20L50 42Z', { fill: '#ffe082' }),
		...[[26, 36], [36, 38], [32, 28], [22, 42], [42, 42]].map(([x, y]) => E(x, y, 2.2, 1.4, 20, { fill: '#f5c542', stroke: dark('#f5c542'), sw: 1 })),
		R(8, 44, 48, 6, 0, { fill: dark('#f5c542') }), L([[8, 44], [8, 50], [56, 50], [56, 44]], { stroke: dark('#f5c542'), sw: OUT, join: 'round', fill: 'none' }),
		Ln(32, 14, 32, 50, { stroke: dark('#f5c542'), sw: 1.4 }),
	],
	'prawn-skewer': [
		...skewer(12, 56, 52, 8),
		...[[22, 42, -45], [40, 24, -45]].map(([x, y, rot]) => G([
			P('M-10 2C-10 -6 -4 -9 2 -8C8 -7 10 -2 8 3C6 7 0 9 -4 7', { fill: '#ff8a65', stroke: dark('#ff8a65'), sw: OUT, cap: 'round', join: 'round' }),
			P('M-6 -4C-4 -1 -2 2 0 5M-1 -6C1 -3 3 0 5 3', { fill: 'none', stroke: dark('#ff8a65'), sw: 1.4, cap: 'round' }),
			L([[-10, 2], [-15, -1], [-13, 5]], { fill: '#ff8a65', stroke: dark('#ff8a65'), sw: 1.6, join: 'round' }, true),
			C(3, -6, 1.1, { fill: INK }),
		], { transform: `${T.translate(x, y)} ${T.rotate(rot)}` })),
	],
};

	return { cards };
}
