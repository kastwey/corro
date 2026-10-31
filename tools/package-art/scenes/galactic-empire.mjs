// galactic-empire — Quantum Anomaly (f1-f16) and Black Market (b1-b16) decks; space tokens.

export const id = 'galactic-empire';

/** Build the drawings with the package-art API (lib + draw + pictos helpers). */
export default function (art) {
	const { C, E, R, P, Ln, L, S, G, Curve, arcD, sectorD, starPts, ngonPts, T, dark, light, OUT, INK, GOLD, WHITE, digits, coin, coinStack, banknote, document, chartUp, arrow, arcArrow, key, wrench, warning, gem, star5, planet, rocket, gear, robotHead, portal, briefcase, cake, shield, bars, pickaxe } = art;

const ADVANCE = '#29b6f6';
const PAY = '#ef5350';
const COLLECT = '#66bb6a';
const CREDIT = '#4dd0e1';

/** Credit chip: a hexagonal coin. */
const credit = (cx, cy, r) => [
	L(ngonPts(cx, cy, 6, r), { fill: CREDIT, stroke: dark(CREDIT), sw: OUT, join: 'round' }, true),
	L(ngonPts(cx, cy, 6, r * 0.7), { fill: 'none', stroke: dark(CREDIT), sw: 1.4, join: 'round' }, true),
	C(cx, cy, r * 0.28, { fill: dark(CREDIT) }),
];
const creditStack = (cx, cy, w, n = 3) => Array.from({ length: n }, (_, i) => {
	const y = cy + (n / 2 - i - 1) * w * 0.3;
	return [R(cx - w / 2, y, w, w * 0.3, w * 0.14, { fill: CREDIT, stroke: dark(CREDIT), sw: 1.6 }), Ln(cx - w * 0.3, y + w * 0.15, cx + w * 0.3, y + w * 0.15, { stroke: dark(CREDIT), sw: 1.2, cap: 'round' })];
}).reverse();

const stars = (seed = 0) => [[8, 10], [54, 8], [12, 50], [56, 52], [30, 6]].map(([x, y], i) => L(starPts(x + (seed * 3) % 5, y, 4, 2.4, 0.9), { fill: '#ffe082' }, true));
const dome = (cx, cy, r, color = '#b3e5fc') => [
	P(sectorD(cx, cy, r, 180, 360), { fill: color, stroke: dark('#90caf9'), sw: OUT }),
	P(arcD(cx, cy, r * 0.75, 200, 270), { fill: 'none', stroke: WHITE, sw: 2, cap: 'round' }),
	R(cx - r * 1.1, cy - 1, r * 2.2, 5, 1.5, { fill: '#78909c', stroke: dark('#78909c'), sw: 1.6 }),
];
const blackHole = (cx, cy, r) => [
	...[3, 2.3, 1.7].map((k, i) => E(cx, cy, r * k * 0.5, r * k * 0.5 * 0.45, -25, { fill: 'none', stroke: ['#7e57c2', '#9575cd', '#b39ddb'][i], sw: 2.4 })),
	C(cx, cy, r * 0.5, { fill: '#1a1a2e', stroke: '#b39ddb', sw: OUT }),
];
const shipSide = (cx, cy, w, color = '#eceff1') => [G([
	L([[-22, 0], [-10, -10], [14, -10], [24, 0], [14, 10], [-10, 10]], { fill: color, stroke: dark('#b0bec5'), sw: OUT, join: 'round' }, true),
	L([[-22, 0], [-30, -8], [-30, 8]], { fill: '#ef5350', stroke: dark('#ef5350'), sw: OUT, join: 'round' }, true),
	C(4, 0, 4.5, { fill: '#81d4fa', stroke: dark('#81d4fa'), sw: 1.4 }),
	R(-14, -3, 10, 6, 2, { fill: '#90a4ae' }),
], { transform: `${T.translate(cx, cy)} ${T.scale(w / 56)}` })];

const cards = {
	f1: [...stars(), ...rocket(26, 36, 44), arrow(42, 50, 58, 14, 4, ADVANCE)],
	f2: [...stars(1), ...dome(32, 44, 20, '#ffe082'), R(29, 12, 6, 14, 1, { fill: '#ffca28', stroke: dark('#ffca28'), sw: 1.6 }), star5(32, 9, 6)],
	f3: [...stars(2), ...portal(30, 34, 20, '#7e57c2'), arrow(44, 54, 58, 40, 4, ADVANCE), ...credit(14, 50, 7), ...credit(24, 54, 7)],
	f4: [...warning(32, 30, 48), P('M44 46L58 56', { stroke: '#90a4ae', sw: 4, cap: 'round' }), C(58, 57, 3.5, { fill: 'none', stroke: '#90a4ae', sw: 3 })],
	f5: [...stars(3), Curve([[10, 40], [18, 20], [34, 14], [50, 22], [54, 40], [40, 52], [24, 50]], { fill: '#ab47bc', fo: 0.55, stroke: '#8e24aa', sw: OUT }, true, 0.9), Curve([[22, 38], [26, 26], [38, 24], [44, 34], [36, 44]], { fill: '#f48fb1', fo: 0.8 }, true), arrow(16, 52, 52, 14, 4, ADVANCE)],
	f6: [...stars(4), ...planet(30, 34, 15, '#ff8a65', '#ffd54f'), arrow(44, 54, 58, 40, 4, ADVANCE)],
	f7: [arcArrow(34, 34, 22, 20, -170, 6, PAY), digits('3', 34, 38, 24, INK)],
	f8: [...stars(5), ...blackHole(32, 34, 20), ...shipSide(14, 14, 22)],
	f9: [...shield(32, 32, 42, 52, '#5c6bc0'), star5(32, 30, 12), R(22, 42, 20, 4, 1.5, { fill: WHITE }), R(26, 48, 12, 3, 1, { fill: WHITE })],
	f10: [...gem(44, 44, 26, '#26c6da'), ...pickaxe(22, 24, 44, -35)],
	f11: [P(arcD(32, 40, 24, 180, 360), { fill: '#eceff1', stroke: INK, sw: OUT }), R(8, 40, 48, 4, 1, { fill: INK }), ...[200, 230, 260, 290, 320, 350].map((a) => P(arcD(32, 40, 19, a, a + 1), { fill: 'none', stroke: INK, sw: 3, cap: 'round' })), P(arcD(32, 40, 19, 300, 358), { fill: 'none', stroke: PAY, sw: 6 }), Ln(32, 40, 46, 22, { stroke: PAY, sw: 3.5, cap: 'round' }), C(32, 40, 4, { fill: INK })],
	f12: [...shipSide(28, 24, 44), ...wrench(44, 46, 34, 40)],
	f13: [...creditStack(26, 40, 28, 4), star5(48, 20, 11)],
	f14: [R(8, 46, 10, 14, 2, { fill: '#546e7a', stroke: dark('#546e7a'), sw: OUT }), G([R(0, -4, 48, 8, 3, { fill: WHITE, stroke: INK, sw: OUT }), ...[0, 1, 2, 3].map((i) => R(4 + i * 12, -4, 6, 8, 0, { fill: PAY }))], { transform: `${T.translate(12, 44)} ${T.rotate(-30)}` }), ...credit(50, 50, 8)],
	f15: [...stars(6), ...portal(32, 34, 20, '#26a69a'), arrow(6, 34, 26, 34, 4, ADVANCE), P('M38 34L58 34', { stroke: ADVANCE, sw: 4, cap: 'round', dash: '4 4' })],
	f16: [star5(32, 24, 18), ...[[-1, 1], [1, -1]].map(([sx]) => G([L([[0, 0], [14, -8], [22, -2], [12, 6]], { fill: GOLD, stroke: dark(GOLD), sw: OUT, join: 'round' }, true)], { transform: `${T.translate(32 + sx * 14, 26)} ${T.scale(sx, 1)}` })), R(22, 44, 20, 14, 2, { fill: '#5c6bc0', stroke: dark('#5c6bc0'), sw: OUT }), R(26, 44, 12, 14, 0, { fill: '#ef5350' })],

	b1: [...document(26, 32, 34, 44), L([[36, 44], [42, 52], [56, 36]], { stroke: COLLECT, sw: 5, cap: 'round', join: 'round' })],
	b2: [...document(32, 32, 40, 52, true), ...credit(50, 14, 8)],
	b3: [...gem(24, 40, 24, '#26c6da'), ...gem(44, 32, 20, '#ab47bc'), ...gem(38, 50, 16, '#ffca28')],
	b4: [...creditStack(30, 34, 30, 3), arrow(54, 50, 38, 50, 4, COLLECT)],
	b5: [...shipSide(28, 30, 48), P('M20 22L26 30L22 36', { fill: 'none', stroke: INK, sw: 2, cap: 'round' }), ...credit(50, 50, 8)],
	b6: [],
	b7: [R(8, 16, 48, 32, 3, { fill: '#90a4ae', stroke: dark('#90a4ae'), sw: OUT }), ...[[14, 22], [50, 22], [14, 42], [50, 42]].map(([x, y]) => C(x, y, 2.2, { fill: dark('#90a4ae') })), P('M22 24L30 34L26 40L36 46', { fill: 'none', stroke: INK, sw: 2.4, cap: 'round', join: 'round' }), ...wrench(46, 44, 30, 40)],
	b8: [...robotHead(32, 30, 34), ...credit(50, 52, 8)],
	b9: [...[[16, 20, 7], [40, 14, 6], [26, 44, 8], [48, 40, 7]].map(([x, y, r]) => credit(x, y, r)).flat(), ...[[30, 28], [12, 40], [52, 24]].map(([x, y]) => L(starPts(x, y, 4, 3, 1), { fill: '#ffe082' }, true))],
	b10: [C(32, 32, 24, { fill: '#ffca28', stroke: dark('#ffca28'), sw: OUT }), C(32, 32, 18, { fill: WHITE, stroke: dark('#ffca28'), sw: 1.6 }), digits('7', 32, 32, 20, '#e53935'), L(starPts(14, 14, 4, 4, 1.5), { fill: '#ffe082' }, true), L(starPts(52, 50, 4, 4, 1.5), { fill: '#ffe082' }, true)],
	b11: [R(10, 22, 36, 30, 2, { fill: '#8d6e63', stroke: dark('#8d6e63'), sw: OUT }), ...[0, 1].map((i) => Ln(10, 32 + i * 10, 46, 32 + i * 10, { stroke: dark('#8d6e63'), sw: 1.6 })), R(24, 30, 8, 14, 2, { fill: GOLD, stroke: dark(GOLD), sw: 1.6 }), ...blackHole(50, 14, 10)],
	b12: [R(10, 16, 44, 30, 4, { fill: '#546e7a', stroke: dark('#546e7a'), sw: OUT }), R(16, 22, 12, 9, 1.5, { fill: GOLD, stroke: dark(GOLD), sw: 1.2 }), ...[0, 1, 2].map((i) => R(32, 24 + i * 5, 16, 2.5, 1, { fill: '#b0bec5' })), star5(48, 48, 9)],
	b13: [...dome(32, 48, 20), Ln(32, 28, 32, 8, { stroke: INK, sw: 2.4, cap: 'round' }), L([[33, 9], [46, 13], [33, 17]], { fill: '#ef5350', stroke: dark('#ef5350'), sw: 1.6, join: 'round' }, true), ...[[10, 14, '#42a5f5'], [52, 20, '#ffca28'], [16, 30, '#66bb6a'], [50, 36, '#ec407a']].map(([x, y, c]) => L(starPts(x, y, 4, 3.2, 1.2), { fill: c }, true))],
	b14: [...gear(28, 34, 22, '#90a4ae'), ...credit(48, 48, 10)],
	b15: [R(16, 10, 32, 46, 3, { fill: '#fff8e1', stroke: INK, sw: OUT }), R(24, 6, 16, 8, 2, { fill: '#546e7a', stroke: dark('#546e7a'), sw: 1.6 }), ...[0, 1, 2].map((i) => [R(21, 20 + i * 10, 6, 6, 1, { fill: 'none', stroke: INK, sw: 1.4 }), Ln(30, 23 + i * 10, 43, 23 + i * 10, { stroke: '#90a4ae', sw: 2.4, cap: 'round' })]), L([[22, 23], [24, 25], [27, 20]], { stroke: COLLECT, sw: 2, cap: 'round', join: 'round' }), L([[22, 33], [24, 35], [27, 30]], { stroke: COLLECT, sw: 2, cap: 'round', join: 'round' })],
	b16: [...chartUp(30, 34, 44, 40), ...gem(52, 16, 16, '#26c6da')],
};
// b6: the oxygen bottle reads "O2" with a ring for the O (digits has no letters).
cards.b6 = [
	R(22, 14, 20, 44, 6, { fill: '#b3e5fc', stroke: '#0288d1', sw: OUT }),
	R(28, 6, 8, 9, 2, { fill: '#546e7a', stroke: dark('#546e7a'), sw: 1.6 }),
	C(30, 34, 6, { fill: 'none', stroke: '#0288d1', sw: 3 }), digits('2', 40, 40, 10, '#0288d1'),
	R(26, 48, 12, 4, 1, { fill: '#0288d1' }),
	...credit(52, 52, 8), arrow(52, 34, 52, 42, 3, PAY),
];

const ACC = { green: '#66bb6a', red: '#ef5350', blue: '#29b6f6', gold: '#fdd835' };
const tokens = {
	alien: [
		E(12, 11, 8, 9.5, 0), R(9, 18, 6, 4, 1.5),
		E(8.5, 11, 2.6, 3.4, 20, { fill: ACC.green }), E(15.5, 11, 2.6, 3.4, -20, { fill: ACC.green }),
		E(8.8, 11.2, 1, 1.5, 20, { fill: '#222222' }), E(15.2, 11.2, 1, 1.5, -20, { fill: '#222222' }),
	],
	rocket: [G([
		L([[-4, 9], [-9, 15], [-5, 15]], {}, true), L([[4, 9], [9, 15], [5, 15]], {}, true),
		P('M0 -15C5 -8 5 4 4 12H-4C-5 4 -5 -8 0 -15Z'),
		C(0, -1, 2.3, { fill: ACC.blue }), L([[-2.5, 12], [2.5, 12], [0, 18]], { fill: ACC.red }, true),
	], { transform: `${T.translate(12, 11)} ${T.rotate(0)}` })],
	star: [L(starPts(12, 12, 5, 10.5, 4.5), {}, true), C(12, 12, 1.6, { fill: ACC.gold })],
	ufo: [
		E(12, 14.5, 10.5, 4), P('M6 12A6 6 0 0 1 18 12Z', { fill: ACC.blue }),
		...[[6, 15.5], [12, 17.5], [18, 15.5]].map(([x, y]) => C(x, y, 1.1, { fill: ACC.gold })),
	],
};

	return { cards, tokens };
}
