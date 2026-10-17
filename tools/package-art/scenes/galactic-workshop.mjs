// galactic-workshop — assembly family in space: modules, failures, fixes and imperial specials.

export const id = 'galactic-workshop';

/** Build the drawings with the package-art API (lib + draw + pictos helpers). */
export default function (art) {
	const { C, E, R, P, Ln, L, S, G, Curve, arcD, sectorD, starPts, ngonPts, T, dark, light, OUT, INK, WHITE, GOLD, warning, arcArrow, arrow, shield, robotHead, bolt } = art;

const COL = { green: '#43a047', blue: '#1e88e5', yellow: '#f9a825', red: '#e53935', wild: '#8e24aa' };
const WILD4 = ['#e53935', '#43a047', '#1e88e5', '#f9a825'];
const METAL = '#90a4ae';

// ---- modules ----
const lifeSupport = (cx, cy, k = 1) => [G([
	R(-18, -8, 36, 30, 4, { fill: METAL, stroke: dark(METAL), sw: OUT }),
	P(sectorD(0, -8, 18, 180, 360), { fill: '#b3e5fc', stroke: dark('#90caf9'), sw: OUT }),
	P('M-6 -8C-6 -16 -2 -22 0 -24C2 -22 6 -16 6 -8Z', { fill: COL.green, stroke: dark(COL.green), sw: 1.6 }), Ln(0, -8, 0, -20, { stroke: dark(COL.green), sw: 1.2 }),
	P('M-12 -8C-12 -12 -10 -16 -8 -17C-6 -14 -6 -10 -7 -8Z', { fill: COL.green, stroke: dark(COL.green), sw: 1.2 }), P('M12 -8C12 -12 10 -16 8 -17C6 -14 6 -10 7 -8Z', { fill: COL.green, stroke: dark(COL.green), sw: 1.2 }),
	R(-14, -2, 28, 6, 2, { fill: COL.green }), ...[-8, 0, 8].map((x) => C(x, 12, 2.4, { fill: light(COL.green) })),
], { transform: `${T.translate(cx, cy)} ${T.scale(k)}` })];
const dataCore = (cx, cy, k = 1) => [G([
	...[-12, -4, 4, 12].map((x) => [Ln(x, -22, x, -28, { stroke: dark(METAL), sw: 3 }), Ln(x, 22, x, 28, { stroke: dark(METAL), sw: 3 }), Ln(-22, x, -28, x, { stroke: dark(METAL), sw: 3 }), Ln(22, x, 28, x, { stroke: dark(METAL), sw: 3 })]),
	R(-22, -22, 44, 44, 4, { fill: '#263238', stroke: dark(METAL), sw: OUT }),
	R(-14, -14, 28, 28, 3, { fill: COL.blue, stroke: dark(COL.blue), sw: 1.6 }),
	P('M-8 -8H0V0H8V8M-8 4H-2M4 -8V-2', { fill: 'none', stroke: light(COL.blue), sw: 2, cap: 'round', join: 'round' }),
	C(-8, 8, 1.6, { fill: light(COL.blue) }),
], { transform: `${T.translate(cx, cy)} ${T.scale(k)}` })];
const hullFrame = (cx, cy, k = 1, cracked = false) => [G([
	...[[-20, -16], [20, -16], [-20, 16], [20, 16]].map(([x, y]) => C(x, y, 2.2, { fill: dark(COL.yellow) })),
	R(-24, -22, 48, 44, 3, { fill: 'none', stroke: COL.yellow, sw: 8 }), R(-24, -22, 48, 44, 3, { fill: 'none', stroke: dark(COL.yellow), sw: 1.4 }), R(-16, -14, 32, 28, 1, { fill: 'none', stroke: dark(COL.yellow), sw: 1.4 }),
	Ln(-20, -18, 20, 18, { stroke: COL.yellow, sw: 7 }), Ln(-20, 18, 20, -18, { stroke: COL.yellow, sw: 7 }),
	Ln(-20, -18, 20, 18, { stroke: dark(COL.yellow), sw: 1.2 }), Ln(-20, 18, 20, -18, { stroke: dark(COL.yellow), sw: 1.2 }),
	...(cracked ? [P('M-6 -26L-2 -14L-8 -6L-1 2L-5 10', { fill: 'none', stroke: INK, sw: 2.4, cap: 'round', join: 'round' })] : []),
], { transform: `${T.translate(cx, cy)} ${T.scale(k)}` })];
const reactor = (cx, cy, k = 1) => [G([
	L(ngonPts(0, 0, 8, 24), { fill: METAL, stroke: dark(METAL), sw: OUT, join: 'round' }, true),
	L(ngonPts(0, 0, 8, 17), { fill: '#263238', stroke: dark(METAL), sw: 1.4, join: 'round' }, true),
	C(0, 0, 11, { fill: COL.red, stroke: dark(COL.red), sw: 1.6 }), C(0, 0, 6, { fill: '#ffab91' }), C(0, 0, 2.5, { fill: WHITE }),
	...[0, 90, 180, 270].map((a) => Ln(Math.cos(a * Math.PI / 180) * 12, Math.sin(a * Math.PI / 180) * 12, Math.cos(a * Math.PI / 180) * 16, Math.sin(a * Math.PI / 180) * 16, { stroke: COL.red, sw: 2.4, cap: 'round' })),
], { transform: `${T.translate(cx, cy)} ${T.scale(k)}` })];
const universalModule = (cx, cy, k = 1) => [G([
	L(ngonPts(0, 0, 6, 26), { fill: METAL, stroke: dark(METAL), sw: OUT, join: 'round' }, true),
	...[0, 1, 2, 3].map((i) => P(sectorD(0, 0, 17, i * 90 - 90, i * 90), { fill: WILD4[i], stroke: dark(METAL), sw: 1.2 })),
	C(0, 0, 6, { fill: '#263238', stroke: dark(METAL), sw: 1.4 }), L(starPts(0, 0, 4, 4, 1.5), { fill: WHITE }, true),
], { transform: `${T.translate(cx, cy)} ${T.scale(k)}` })];

const tank = (cx, cy, color, cracked = false) => [
	R(cx - 10, cy - 22, 20, 44, 7, { fill: color, stroke: dark(color), sw: OUT }), R(cx - 4, cy - 28, 8, 7, 1.5, { fill: '#546e7a', stroke: INK, sw: 1.4 }),
	R(cx - 10, cy - 6, 20, 12, 0, { fill: WHITE, fo: 0.35 }),
	...(cracked ? [P(`M${cx + 6} ${cy - 20}L${cx + 2} ${cy - 10}L${cx + 8} ${cy - 2}L${cx + 3} ${cy + 8}`, { fill: 'none', stroke: INK, sw: 2.2, cap: 'round', join: 'round' })] : []),
];
const bubbles = (cx, cy) => [[0, 0, 3], [8, -8, 2.2], [4, -16, 1.6], [12, -20, 1.2]].map(([x, y, r]) => C(cx + x, cy + y, r, { fill: '#b3e5fc', stroke: '#4fc3f7', sw: 1.2 }));
const bug = (cx, cy, color = '#c62828') => [
	E(cx, cy + 3, 7, 9, 0, { fill: color, stroke: dark(color), sw: 1.6 }), C(cx, cy - 7, 4.5, { fill: color, stroke: dark(color), sw: 1.6 }),
	Ln(cx, cy - 4, cx, cy + 12, { stroke: dark(color), sw: 1.2 }),
	...[[-1, 1], [1, 1]].map(([s]) => [Ln(cx + s * 6, cy, cx + s * 12, cy - 4, { stroke: dark(color), sw: 1.6, cap: 'round' }), Ln(cx + s * 7, cy + 5, cx + s * 13, cy + 5, { stroke: dark(color), sw: 1.6, cap: 'round' }), Ln(cx + s * 6, cy + 9, cx + s * 11, cy + 13, { stroke: dark(color), sw: 1.6, cap: 'round' })]),
	C(cx - 1.6, cy - 8, 1, { fill: WHITE }), C(cx + 1.6, cy - 8, 1, { fill: WHITE }),
];

const cards = {
	'life-support': lifeSupport(32, 36, 1),
	'data-core': dataCore(32, 32, 1),
	'hull-frame': hullFrame(32, 32, 1),
	'universal-module': universalModule(32, 32, 1),
	reactor: reactor(32, 32, 1),
	'oxygen-leak': [...tank(26, 34, COL.green, true), ...bubbles(44, 30)],
	'data-corruption': [...dataCore(28, 34, 0.85), ...bug(50, 18)],
	'structural-crack': hullFrame(32, 32, 1, true),
	'systems-failure': [...warning(32, 32, 50, '#ffca28'), ...[0, 1, 2, 3].map((i) => R(8 + i * 13, 56, 9, 4, 1, { fill: WILD4[i] }))],
	overload: [...reactor(28, 34, 0.85), ...bolt(50, 18, 28, '#ffca28')],
	sealant: [
		G([R(-8, -20, 16, 40, 3, { fill: COL.green, stroke: dark(COL.green), sw: OUT }), R(-4, -27, 8, 8, 1.5, { fill: '#546e7a', stroke: INK, sw: 1.4 }), R(-8, -4, 16, 14, 0, { fill: WHITE }), R(-6, -14, 3, 8, 1, { fill: WHITE, fo: 0.5 })], { transform: `${T.translate(28, 32)} ${T.rotate(-30)}` }),
		P('M38 46C44 38 50 40 54 34', { fill: 'none', stroke: light(COL.green), sw: 6, cap: 'round' }), P('M38 46C44 38 50 40 54 34', { fill: 'none', stroke: dark(COL.green), sw: 1.2 }),
	],
	debugger: [...shield(30, 32, 40, 50, COL.blue), ...bug(30, 30, '#90caf9'), Ln(16, 46, 44, 16, { stroke: '#e53935', sw: 4, cap: 'round' })],
	bracing: [
		R(10, 28, 44, 8, 2, { fill: COL.yellow, stroke: dark(COL.yellow), sw: OUT }),
		...[0, 1].map((i) => G([R(-4, -14, 8, 28, 2, { fill: METAL, stroke: dark(METAL), sw: OUT }), R(-7, -16, 14, 6, 1.5, { fill: dark(METAL) }), R(-7, 10, 14, 6, 1.5, { fill: dark(METAL) })], { transform: T.translate(18 + i * 28, 32) })),
		Ln(22, 20, 42, 44, { stroke: dark(COL.yellow), sw: 3, cap: 'round' }), Ln(22, 44, 42, 20, { stroke: dark(COL.yellow), sw: 3, cap: 'round' }),
	],
	nanobots: [
		...[[18, 22, 0.55], [42, 18, 0.45], [28, 44, 0.5], [48, 42, 0.4]].map(([x, y, k]) => G(robotHead(0, 0, 26, '#ce93d8'), { transform: `${T.translate(x, y)} ${T.scale(k)}` })),
		...[[32, 32], [12, 44], [54, 30]].map(([x, y]) => L(starPts(x, y, 4, 3, 1.2), { fill: '#ce93d8' }, true)),
	],
	coolant: [
		P('M32 8C40 20 48 28 48 40A16 16 0 0 1 16 40C16 28 24 20 32 8Z', { fill: '#4fc3f7', stroke: '#0288d1', sw: OUT, join: 'round' }),
		...[0, 60, 120].map((a) => Ln(32 - Math.cos(a * Math.PI / 180) * 9, 40 - Math.sin(a * Math.PI / 180) * 9, 32 + Math.cos(a * Math.PI / 180) * 9, 40 + Math.sin(a * Math.PI / 180) * 9, { stroke: WHITE, sw: 2.4, cap: 'round' })),
		C(32, 40, 2, { fill: WHITE }),
	],
	'exchange-crane': [
		R(6, 54, 52, 6, 1, { fill: METAL, stroke: dark(METAL), sw: 1.6 }), R(12, 20, 6, 34, 1, { fill: COL.yellow, stroke: dark(COL.yellow), sw: OUT }), R(12, 16, 40, 6, 1, { fill: COL.yellow, stroke: dark(COL.yellow), sw: OUT }),
		Ln(14, 22, 44, 46, { stroke: dark(COL.yellow), sw: 1.4 }), Ln(48, 22, 48, 36, { stroke: INK, sw: 1.6 }), P('M48 36C44 36 42 40 44 44C46 46 50 46 52 44', { fill: 'none', stroke: INK, sw: 2.4, cap: 'round' }),
		R(36, 44, 24, 12, 2, { fill: COL.blue, stroke: dark(COL.blue), sw: OUT }), R(40, 47, 16, 6, 1, { fill: light(COL.blue) }),
	],
	'imperial-requisition': [
		R(12, 10, 40, 44, 3, { fill: '#f5f5f5', stroke: INK, sw: OUT }), ...[0, 1, 2].map((i) => Ln(18, 20 + i * 8, 46, 20 + i * 8, { stroke: '#b0bec5', sw: 2.4, cap: 'round' })),
		C(44, 44, 10, { fill: '#c62828', stroke: dark('#c62828'), sw: OUT }), L(starPts(44, 44, 5, 6, 2.6), { fill: GOLD }, true),
		R(8, 28, 12, 18, 3, { fill: '#f3c89a', stroke: dark('#f3c89a'), sw: 1.6 }), ...[0, 1, 2].map((i) => Ln(11 + i * 3.5, 28, 11 + i * 3.5, 18, { stroke: '#f3c89a', sw: 3, cap: 'round' })),
	],
	'chain-leak': [
		...[0, 1, 2, 3].map((i) => E(14 + i * 12, 20 + (i % 2) * 2, 7, 4.5, 0, { fill: 'none', stroke: METAL, sw: 4 })),
		...[0, 1, 2, 3].map((i) => E(14 + i * 12, 20 + (i % 2) * 2, 7, 4.5, 0, { fill: 'none', stroke: dark(METAL), sw: 1 })),
		...[[20, 40], [34, 46], [48, 40]].map(([x, y]) => P(`M${x} ${y - 10}C${x + 5} ${y - 3} ${x + 6} ${y + 1} ${x + 6} ${y + 3}A6 6 0 0 1 ${x - 6} ${y + 3}C${x - 6} ${y + 1} ${x - 5} ${y - 3} ${x} ${y - 10}Z`, { fill: '#4fc3f7', stroke: '#0288d1', sw: 1.6, join: 'round' })),
	],
	'imperial-inspection': [
		C(26, 26, 17, { fill: '#b3e5fc', fo: 0.6, stroke: INK, sw: 4 }), C(26, 26, 17, { fill: 'none', stroke: '#90a4ae', sw: 1.4 }),
		Ln(38, 38, 54, 54, { stroke: INK, sw: 8, cap: 'round' }), Ln(40, 40, 54, 54, { stroke: '#8d6e63', sw: 4, cap: 'round' }),
		L(starPts(26, 26, 5, 8, 3.4), { fill: '#c62828' }, true), E(18, 18, 4, 2, -40, { fill: WHITE, fo: 0.7 }),
	],
	'total-trade-in': [arcArrow(32, 32, 22, 200, 340, 6, COL.wild), arcArrow(32, 32, 22, 20, 160, 6, COL.wild), ...universalModule(32, 32, 0.45)],
};

	return { cards };
}
