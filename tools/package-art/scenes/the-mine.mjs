// the-mine — exploding family underground: hazards, tools and tunnel critters in colour.

export const id = 'the-mine';

/** Build the drawings with the package-art API (lib + draw + pictos helpers). */
export default function (art) {
	const { C, E, R, P, Ln, L, S, G, Curve, arcD, sectorD, starPts, T, dark, light, OUT, INK, WHITE, GOLD, pickaxe, arrow, arcArrow, warning } = art;

const ROCK = '#8d6e63';
const FUR = { rat: '#9e9e9e', bat: '#5e4b8b', mole: '#6d4c41', worm: '#f48fb1', beetle: '#37474f' };

const eyes = (cx, cy, dx, r = 2.6) => [C(cx - dx, cy, r, { fill: WHITE }), C(cx + dx, cy, r, { fill: WHITE }), C(cx - dx + 0.5, cy, r * 0.45, { fill: INK }), C(cx + dx + 0.5, cy, r * 0.45, { fill: INK })];
const flame = (cx, cy, h, outer = '#ff7043', inner = '#ffeb3b') => [
	P(`M${cx} ${cy - h}C${cx + h * 0.6} ${cy - h * 0.4} ${cx + h * 0.5} ${cy + h * 0.1} ${cx} ${cy + h * 0.1}C${cx - h * 0.5} ${cy + h * 0.1} ${cx - h * 0.6} ${cy - h * 0.4} ${cx} ${cy - h}Z`, { fill: outer, stroke: dark(outer), sw: OUT, join: 'round' }),
	P(`M${cx} ${cy - h * 0.55}C${cx + h * 0.28} ${cy - h * 0.2} ${cx + h * 0.22} ${cy + h * 0.1} ${cx} ${cy + h * 0.1}C${cx - h * 0.22} ${cy + h * 0.1} ${cx - h * 0.28} ${cy - h * 0.2} ${cx} ${cy - h * 0.55}Z`, { fill: inner }),
];
const rock = (cx, cy, w, h, color = ROCK) => Curve([[cx - w / 2, cy], [cx - w * 0.3, cy - h / 2], [cx + w * 0.2, cy - h * 0.45], [cx + w / 2, cy - h * 0.1], [cx + w * 0.35, cy + h / 2], [cx - w * 0.3, cy + h * 0.45]], { fill: color, stroke: dark(color), sw: OUT, join: 'round' }, true, 0.7);

const cards = {
	firedamp: [
		Curve([[12, 40], [10, 26], [22, 16], [34, 20], [46, 14], [56, 26], [52, 42], [36, 50], [20, 50]], { fill: '#9ccc65', fo: 0.85, stroke: '#558b2f', sw: OUT, join: 'round' }, true, 0.9),
		...flame(32, 40, 18), ...flame(18, 46, 9), ...flame(46, 46, 11),
	],
	'cut-fuse': [
		C(24, 40, 15, { fill: '#37474f', stroke: INK, sw: OUT }), E(19, 35, 4, 2.6, -35, { fill: WHITE, fo: 0.6 }),
		P('M34 30C38 22 44 24 48 16', { fill: 'none', stroke: '#8d6e63', sw: 3, cap: 'round' }),
		L(starPts(49, 14, 6, 4, 1.8), { fill: '#ffca28', stroke: '#ef6c00', sw: 1.2, join: 'round' }, true),
		G([
			C(-7, 7, 4.5, { fill: 'none', stroke: '#e53935', sw: 3 }), C(7, 7, 4.5, { fill: 'none', stroke: '#e53935', sw: 3 }),
			Ln(-4, 3.5, 5, -14, { stroke: '#90a4ae', sw: 3.6, cap: 'round' }), Ln(4, 3.5, -5, -14, { stroke: '#90a4ae', sw: 3.6, cap: 'round' }), C(0, -4, 1.6, { fill: INK }),
		], { transform: `${T.translate(50, 30)} ${T.rotate(35)}` }),
	],
	'leave-shaft': [
		R(10, 6, 44, 52, 0, { fill: '#5d4037', stroke: dark('#5d4037'), sw: OUT }), R(16, 6, 32, 52, 0, { fill: '#3e2723' }),
		...[0, 1].map((i) => R(22 + i * 16, 6, 5, 52, 1, { fill: '#c69c6d', stroke: dark('#c69c6d'), sw: 1.4 })),
		...[14, 24, 34, 44, 54].map((y) => R(22, y - 2, 21, 4, 1, { fill: '#c69c6d', stroke: dark('#c69c6d'), sw: 1.4 })),
		arrow(52, 50, 52, 16, 4, '#66bb6a'),
	],
	'cave-in': [
		R(6, 50, 52, 8, 1, { fill: '#5d4037' }),
		rock(20, 20, 16, 12), rock(42, 14, 14, 11, '#a1887f'), rock(34, 34, 20, 14), rock(14, 40, 14, 12, '#a1887f'), rock(50, 40, 16, 12),
		...[[28, 8], [52, 28], [8, 26]].map(([x, y]) => L(starPts(x, y, 4, 3, 1.2), { fill: '#bcaaa4' }, true)),
	],
	canary: [
		R(14, 8, 36, 50, 14, { fill: 'none', stroke: '#90a4ae', sw: 3 }), R(26, 4, 12, 6, 2, { fill: '#90a4ae', stroke: INK, sw: 1.2 }),
		...[22, 32, 42].map((x) => Ln(x, 10, x, 56, { stroke: '#b0bec5', sw: 1.6 })),
		Ln(14, 44, 50, 44, { stroke: '#8d6e63', sw: 2.4 }),
		E(32, 34, 10, 8, 0, { fill: '#ffeb3b', stroke: dark('#ffeb3b'), sw: OUT }), C(39, 28, 6, { fill: '#ffeb3b', stroke: dark('#ffeb3b'), sw: OUT }),
		L([[44, 28], [50, 30], [44, 31]], { fill: '#ff9800', stroke: dark('#ff9800'), sw: 1, join: 'round' }, true), C(40, 27, 1.4, { fill: INK }),
		L([[22, 36], [14, 32], [20, 40]], { fill: '#ffeb3b', stroke: dark('#ffeb3b'), sw: 1.4, join: 'round' }, true),
		E(30, 35, 5, 3, 20, { fill: '#fdd835', stroke: dark('#ffeb3b'), sw: 1 }),
		Ln(30, 42, 29, 46, { stroke: '#ff9800', sw: 1.6 }), Ln(34, 42, 35, 46, { stroke: '#ff9800', sw: 1.6 }),
	],
	'gallery-reshuffle': [
		P('M8 58V30A24 24 0 0 1 56 30V58Z', { fill: '#3e2723', stroke: '#5d4037', sw: OUT }),
		P('M14 58V32A18 18 0 0 1 50 32V58Z', { fill: '#1b1b1b' }),
		R(6, 54, 52, 6, 0, { fill: '#5d4037' }),
		arcArrow(32, 36, 13, 200, 340, 4, '#ffb300'), arcArrow(32, 36, 13, 20, 160, 4, '#ffb300'),
	],
	'borrowed-pickaxe': [
		...pickaxe(28, 30, 48, -40),
		G([
			R(-9, -2, 18, 16, 6, { fill: '#f3c89a', stroke: dark('#f3c89a'), sw: 1.8 }),
			...[[-6.5, 9], [-2.2, 11], [2.2, 10], [6.5, 8]].map(([x, l]) => Ln(x, -1, x, -1 - l, { stroke: dark('#f3c89a'), sw: 5.2, cap: 'round' })),
			...[[-6.5, 9], [-2.2, 11], [2.2, 10], [6.5, 8]].map(([x, l]) => Ln(x, -1, x, -1 - l, { stroke: '#f3c89a', sw: 3.6, cap: 'round' })),
			R(-9, 0, 18, 14, 6, { fill: '#f3c89a' }),
		], { transform: `${T.translate(48, 46)} ${T.scale(0.9)}` }),
	],
	'no-way': [
		R(6, 52, 52, 6, 1, { fill: '#5d4037' }),
		...[0, 1].map((i) => R(10 + i * 40, 24, 4, 30, 1, { fill: '#8d6e63', stroke: dark('#8d6e63'), sw: 1.2 })),
		G([R(0, -4, 48, 8, 2, { fill: '#ffca28', stroke: INK, sw: OUT }), ...[0, 1, 2, 3].map((j) => R(4 + j * 12, -4, 6, 8, 0, { fill: INK }))], { transform: T.translate(8, 30) }),
		G([R(0, -4, 48, 8, 2, { fill: '#ffca28', stroke: INK, sw: OUT }), ...[0, 1, 2, 3].map((j) => R(4 + j * 12, -4, 6, 8, 0, { fill: INK }))], { transform: T.translate(8, 44) }),
		C(32, 14, 8, { fill: '#e53935', stroke: dark('#e53935'), sw: OUT }), R(26, 12.5, 12, 3, 1, { fill: WHITE }),
	],
	'mine-rat': [
		P('M12 44C8 30 18 20 32 20C46 20 56 28 54 40C52 48 40 50 30 48C20 46 14 50 12 44Z', { fill: FUR.rat, stroke: dark(FUR.rat), sw: OUT }),
		P('M12 44C6 48 4 54 10 58', { fill: 'none', stroke: '#f8bbd0', sw: 3, cap: 'round' }),
		C(44, 22, 6, { fill: FUR.rat, stroke: dark(FUR.rat), sw: OUT }), C(44, 22, 3, { fill: '#f8bbd0' }),
		C(54, 34, 2.4, { fill: '#f8bbd0', stroke: dark(FUR.rat), sw: 1 }), ...eyes(46, 34, 0, 2.6).slice(0, 1), C(46, 34, 2.4, { fill: WHITE }), C(46.5, 34, 1.1, { fill: INK }),
		Ln(52, 36, 60, 34, { stroke: dark(FUR.rat), sw: 1.2, cap: 'round' }), Ln(52, 38, 60, 40, { stroke: dark(FUR.rat), sw: 1.2, cap: 'round' }),
	],
	bat: [
		P('M4 30C10 16 24 18 32 28C40 18 54 16 60 30C52 28 46 32 44 40C40 36 36 34 32 36C28 34 24 36 20 40C18 32 12 28 4 30Z', { fill: FUR.bat, stroke: dark(FUR.bat), sw: OUT, join: 'round' }),
		E(32, 32, 7, 9, 0, { fill: FUR.bat, stroke: dark(FUR.bat), sw: OUT }),
		L([[26, 26], [28, 18], [31, 25]], { fill: FUR.bat, stroke: dark(FUR.bat), sw: 1.6, join: 'round' }, true), L([[38, 26], [36, 18], [33, 25]], { fill: FUR.bat, stroke: dark(FUR.bat), sw: 1.6, join: 'round' }, true),
		...eyes(32, 31, 3, 2), L([[30, 36], [32, 39], [34, 36]], { fill: WHITE }, true),
	],
	mole: [
		R(8, 46, 48, 10, 3, { fill: '#5d4037' }),
		Curve([[14, 48], [16, 28], [32, 18], [48, 28], [50, 48]], { fill: FUR.mole, stroke: dark(FUR.mole), sw: OUT, join: 'round' }, true, 0.8),
		E(32, 38, 5, 4, 0, { fill: '#f8bbd0', stroke: dark(FUR.mole), sw: 1.4 }),
		Ln(24, 30, 29, 32, { stroke: dark(FUR.mole), sw: 2, cap: 'round' }), Ln(40, 30, 35, 32, { stroke: dark(FUR.mole), sw: 2, cap: 'round' }),
		...[[-1, 0], [1, 0]].map(([s]) => L([[32 + s * 14, 44], [32 + s * 22, 42], [32 + s * 22, 48], [32 + s * 14, 50]], { fill: '#f8bbd0', stroke: dark(FUR.mole), sw: 1.4, join: 'round' }, true)),
	],
	worm: [
		P('M8 44C6 30 18 26 24 34C30 42 40 42 44 32C48 22 60 24 56 36', { fill: 'none', stroke: dark(FUR.worm), sw: 14 + OUT * 2, cap: 'round' }),
		P('M8 44C6 30 18 26 24 34C30 42 40 42 44 32C48 22 60 24 56 36', { fill: 'none', stroke: FUR.worm, sw: 14, cap: 'round' }),
		...[14, 22, 30, 38, 46].map((x, i) => Ln(x, 24 + (i % 2) * 2, x, 46 - (i % 2) * 2, { stroke: dark(FUR.worm), sw: 1.4, opacity: 0.5 })),
		C(56, 36, 9, { fill: FUR.worm, stroke: dark(FUR.worm), sw: OUT }), ...eyes(56, 34, 3, 2.2), L([[53, 40], [56, 42], [59, 40]], { stroke: dark(FUR.worm), sw: 1.4, cap: 'round' }),
	],
	'dung-beetle': [
		C(22, 40, 14, { fill: '#8d6e63', stroke: dark('#8d6e63'), sw: OUT }), ...[[16, 34], [26, 46], [28, 36], [18, 46]].map(([x, y]) => C(x, y, 2, { fill: dark('#8d6e63'), fo: 0.5 })),
		...[[-1, 1], [1, 1]].map(([s]) => [Ln(44, 36, 44 + s * 10, 26, { stroke: dark(FUR.beetle), sw: 2.4, cap: 'round' }), Ln(44, 42, 44 + s * 12, 46, { stroke: dark(FUR.beetle), sw: 2.4, cap: 'round' })]),
		E(44, 38, 11, 14, 0, { fill: FUR.beetle, stroke: dark(FUR.beetle), sw: OUT }), Ln(44, 28, 44, 52, { stroke: dark(FUR.beetle), sw: 1.6 }),
		E(44, 36, 8, 10, 0, { fill: '#546e7a', fo: 0.4 }),
		C(44, 22, 5, { fill: FUR.beetle, stroke: dark(FUR.beetle), sw: OUT }), ...eyes(44, 21, 2, 1.4),
		Ln(42, 18, 38, 12, { stroke: dark(FUR.beetle), sw: 1.6, cap: 'round' }), Ln(46, 18, 50, 12, { stroke: dark(FUR.beetle), sw: 1.6, cap: 'round' }),
	],
};

	return { cards };
}
