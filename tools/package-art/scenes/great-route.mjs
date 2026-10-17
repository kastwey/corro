// great-route — journey family: distance milestones, hazards, remedies, safeties; vehicle tokens.

export const id = 'great-route';

/** Build the drawings with the package-art API (lib + draw + pictos helpers). */
export default function (art) {
	const { C, E, R, P, Ln, L, S, G, Curve, arcD, sectorD, starPts, T, dark, light, OUT, INK, GOLD, WHITE, digits, wrench, shield, star5, warning, arrow } = art;

const SIGN_BLUE = '#1e63b5';
const RED = '#e53935';
const GREEN = '#43a047';
const TYRE = '#37474f';

/** Milestone: a blue road sign with the distance and a stretch of road below. */
const milestone = (n) => [
	R(6, 46, 52, 12, 2, { fill: '#546e7a', stroke: dark('#546e7a'), sw: OUT }),
	...[10, 24, 38, 50].map((x) => R(x, 51, 7, 2.2, 1, { fill: WHITE })),
	R(8, 6, 48, 34, 5, { fill: SIGN_BLUE, stroke: dark(SIGN_BLUE), sw: OUT }),
	R(11, 9, 42, 28, 3, { fill: 'none', stroke: WHITE, sw: 1.6 }),
	digits(String(n), 32, 23, 20, WHITE, null, 4.2),
];

/** Traffic light with one lamp lit. */
const trafficLight = (lit) => [
	R(20, 4, 24, 56, 6, { fill: '#37474f', stroke: INK, sw: OUT }),
	...[[14, RED, 0], [32, '#ffca28', 1], [50, GREEN, 2]].map(([y, c, i]) => C(32, y, 7, { fill: lit === i ? c : '#5f6a6e', stroke: INK, sw: 1.4 })),
	...(lit === 0 ? [L(starPts(32, 14, 8, 11, 8.5), { fill: RED, fo: 0.35 }, true)] : lit === 2 ? [L(starPts(32, 50, 8, 11, 8.5), { fill: GREEN, fo: 0.35 }, true)] : []),
];

/** Round speed-limit sign. */
const speedSign = (ended) => [
	C(32, 32, 26, { fill: WHITE, stroke: RED, sw: 6 }), C(32, 32, 26, { fill: 'none', stroke: dark(RED), sw: 1 }),
	digits('50', 32, 32, 22, INK, null, 4.6),
	...(ended ? [Ln(14, 50, 50, 14, { stroke: INK, sw: 4, cap: 'round' }), Ln(9, 46, 45, 10, { stroke: INK, sw: 2, cap: 'round', opacity: 0.6 })] : []),
];

/** Fuel pump. */
const pump = (fuelColor, empty) => [
	R(14, 6, 28, 52, 4, { fill: '#546e7a', stroke: INK, sw: OUT }),
	R(19, 11, 18, 14, 2, { fill: '#b3e5fc', stroke: INK, sw: 1.4 }),
	R(19, 30, 18, 22, 2, { fill: fuelColor }),
	...(empty ? [Ln(22, 34, 34, 48, { stroke: WHITE, sw: 3, cap: 'round' }), Ln(34, 34, 22, 48, { stroke: WHITE, sw: 3, cap: 'round' })] : [R(22, 34, 12, 8, 1, { fill: WHITE, fo: 0.5 })]),
	P('M42 14H48V40A4 4 0 0 1 56 40V24', { fill: 'none', stroke: INK, sw: 3, cap: 'round', join: 'round' }),
	R(52, 18, 8, 8, 2, { fill: '#90a4ae', stroke: INK, sw: 1.4 }),
	R(10, 56, 36, 4, 1, { fill: INK }),
];

/** Wheel / tyre. */
const wheel = (cx, cy, r, flat = false) => [
	flat
		? P(`M${cx - r} ${cy}A${r} ${r} 0 0 1 ${cx + r} ${cy}Q${cx + r * 0.9} ${cy + r * 0.55} ${cx} ${cy + r * 0.55}Q${cx - r * 0.9} ${cy + r * 0.55} ${cx - r} ${cy}Z`, { fill: TYRE, stroke: INK, sw: OUT })
		: C(cx, cy, r, { fill: TYRE, stroke: INK, sw: OUT }),
	C(cx, cy - (flat ? r * 0.2 : 0), r * 0.55, { fill: '#b0bec5', stroke: INK, sw: 1.6 }),
	...[0, 1, 2, 3, 4].map((i) => { const a = (i / 5) * Math.PI * 2 - Math.PI / 2; return Ln(cx, cy - (flat ? r * 0.2 : 0), cx + Math.cos(a) * r * 0.42, cy - (flat ? r * 0.2 : 0) + Math.sin(a) * r * 0.42, { stroke: INK, sw: 2.2, cap: 'round' }); }),
	C(cx, cy - (flat ? r * 0.2 : 0), r * 0.12, { fill: INK }),
];

/** Side view of a small car. */
const car = (cx, cy, w, color) => [G([
	P('M-26 6V-2C-26 -6 -22 -8 -18 -8L-12 -18H10L20 -8C24 -8 26 -6 26 -2V6Z', { fill: color, stroke: dark(color), sw: OUT, join: 'round' }),
	P('M-10 -16H8L15 -8H-10Z', { fill: '#b3e5fc', stroke: dark(color), sw: 1.4 }),
	Ln(-1, -16, -1, -8, { stroke: dark(color), sw: 1.4 }),
	C(-15, 7, 6, { fill: TYRE, stroke: INK, sw: 1.8 }), C(15, 7, 6, { fill: TYRE, stroke: INK, sw: 1.8 }),
	C(-15, 7, 2.5, { fill: '#b0bec5' }), C(15, 7, 2.5, { fill: '#b0bec5' }),
	C(24, 0, 1.6, { fill: '#fff59d' }),
], { transform: `${T.translate(cx, cy)} ${T.scale(w / 56)}` })];

const cards = {
	'distance-25': milestone(25),
	'distance-50': milestone(50),
	'distance-75': milestone(75),
	'distance-100': milestone(100),
	'distance-200': milestone(200),
	'red-light': trafficLight(0),
	'speed-limit': speedSign(false),
	'out-of-fuel': pump('#ef9a9a', true),
	'flat-tyre': [...wheel(32, 30, 22, true), G([R(-1.5, -14, 3, 20, 1, { fill: '#90a4ae', stroke: INK, sw: 1.2 }), C(0, -15, 3.5, { fill: '#90a4ae', stroke: INK, sw: 1.2 })], { transform: `${T.translate(44, 16)} ${T.rotate(35)}` })],
	accident: [L(starPts(32, 30, 12, 30, 20), { fill: '#ffca28', stroke: '#ef6c00', sw: OUT, join: 'round' }, true), ...car(20, 36, 32, '#1e88e5'), ...car(46, 36, 32, RED).map((g) => G([g], { transform: `translate(92 0) scale(-1 1)` }))],
	'green-light': trafficLight(2),
	'end-speed-limit': speedSign(true),
	fuel: pump('#66bb6a', false),
	'spare-wheel': wheel(32, 32, 26, false),
	repairs: [...car(26, 40, 44, '#ffb300'), ...wrench(46, 20, 34, -45)],
	'right-of-way': [L([[32, 4], [60, 32], [32, 60], [4, 32]], { fill: '#ffca28', stroke: INK, sw: OUT, join: 'round' }, true), L([[32, 13], [51, 32], [32, 51], [13, 32]], { fill: WHITE, stroke: INK, sw: 1.4, join: 'round' }, true), L([[32, 20], [44, 32], [32, 44], [20, 32]], { fill: '#ffca28' }, true)],
	'tanker-truck': [
		R(4, 42, 56, 6, 1, { fill: '#546e7a' }),
		R(6, 18, 36, 22, 8, { fill: '#b0bec5', stroke: INK, sw: OUT }), R(10, 22, 28, 6, 3, { fill: WHITE, fo: 0.6 }),
		R(42, 24, 16, 16, 2, { fill: RED, stroke: dark(RED), sw: OUT }), R(45, 27, 9, 7, 1, { fill: '#b3e5fc', stroke: dark(RED), sw: 1.2 }),
		C(14, 44, 6, { fill: TYRE, stroke: INK, sw: 1.8 }), C(30, 44, 6, { fill: TYRE, stroke: INK, sw: 1.8 }), C(50, 44, 6, { fill: TYRE, stroke: INK, sw: 1.8 }),
	],
	'puncture-proof-wheel': [...wheel(28, 34, 22, false), ...shield(50, 18, 20, 24, '#43a047'), L([[44, 18], [48, 22], [56, 13]], { stroke: WHITE, sw: 2.6, cap: 'round', join: 'round' })],
	'driving-ace': [
		C(32, 34, 24, { fill: 'none', stroke: INK, sw: 7 }), C(32, 34, 24, { fill: 'none', stroke: '#546e7a', sw: 4 }),
		...[0, 120, 240].map((a) => Ln(32, 34, 32 + Math.cos((a - 90) * Math.PI / 180) * 20, 34 + Math.sin((a - 90) * Math.PI / 180) * 20, { stroke: INK, sw: 5, cap: 'round' })),
		C(32, 34, 7, { fill: '#546e7a', stroke: INK, sw: 2 }),
		star5(52, 12, 9),
	],
};

const ACC = { blue: '#29b6f6', red: '#e53935', gold: '#fdd835' };
const win = (x, y, w, h) => R(x, y, w, h, 0.8, { fill: ACC.blue });
const tokens = {
	bus: [R(2, 6, 20, 12, 2), C(6.5, 18.5, 2.4), C(17.5, 18.5, 2.4), C(6.5, 18.5, 0.9, { fill: ACC.gold }), C(17.5, 18.5, 0.9, { fill: ACC.gold }), win(4, 8, 4, 4), win(10, 8, 4, 4), win(16, 8, 4, 4)],
	car: [P('M2 17V12C2 10 4 9.5 6 9.5L9 5H16L19 9.5C21 9.5 22 10.5 22 12V17Z'), C(7, 17.5, 2.6), C(17, 17.5, 2.6), C(7, 17.5, 1, { fill: ACC.gold }), C(17, 17.5, 1, { fill: ACC.gold }), P('M9.5 6.5H15L17.5 9.5H9.5Z', { fill: ACC.blue })],
	lorry: [R(1.5, 6, 13, 11, 1), R(14.5, 9, 8, 8, 1), C(6, 18.5, 2.5), C(18, 18.5, 2.5), C(6, 18.5, 0.9, { fill: ACC.gold }), C(18, 18.5, 0.9, { fill: ACC.gold }), win(16, 10.5, 4, 3.5), R(3, 8, 10, 7, 0.6, { fill: ACC.red })],
	motorbike: [C(6, 16, 4.2), C(18, 16, 4.2), C(6, 16, 1.6, { fill: ACC.gold }), C(18, 16, 1.6, { fill: ACC.gold }), P('M6 16L10 9H15L18 16', { fill: 'none', stroke: 'currentColor', sw: 2.4, join: 'round' }), P('M9 9L7 6H11', { fill: 'none', stroke: 'currentColor', sw: 2, cap: 'round', join: 'round' }), R(10.5, 8, 4.5, 3, 1, { fill: ACC.red })],
	taxi: [P('M2 17V12C2 10 4 9.5 6 9.5L9 5H16L19 9.5C21 9.5 22 10.5 22 12V17Z'), R(9.5, 2.5, 5, 2.5, 0.8, { fill: ACC.gold }), C(7, 17.5, 2.6), C(17, 17.5, 2.6), C(7, 17.5, 1, { fill: ACC.gold }), C(17, 17.5, 1, { fill: ACC.gold }), P('M9.5 6.5H15L17.5 9.5H9.5Z', { fill: ACC.blue })],
	van: [P('M2 17V9C2 7.5 3 7 4.5 7H14L19 11H21C21.5 11 22 11.5 22 12V17Z'), C(6.5, 17.5, 2.6), C(17.5, 17.5, 2.6), C(6.5, 17.5, 1, { fill: ACC.gold }), C(17.5, 17.5, 1, { fill: ACC.gold }), P('M14.5 8.5L18 11H14.5Z', { fill: ACC.blue }), R(4, 9, 8, 4, 0.6, { fill: ACC.red })],
};

	return { cards, tokens };
}
