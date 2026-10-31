// wheel-of-wits — quiz tokens (currentColor silhouettes with one or two accents).
export const id = 'wheel-of-wits';

/** Build the drawings with the package-art API (lib + draw + pictos helpers). */
export default function (art) {
	const { C, E, R, P, Ln, L, G, Curve, arcD, sectorD, starPts, ngonPts, T, dark } = art;
	const WHITE = '#ffffff';
	const ACC = { red: '#e53935', blue: '#29b6f6', gold: '#fdd835', green: '#43a047', purple: '#ab47bc' };

	const tokens = {
	atom: [
		E(12, 12, 10, 4, 0, { fill: 'none', stroke: 'currentColor', sw: 1.6 }), E(12, 12, 10, 4, 60, { fill: 'none', stroke: 'currentColor', sw: 1.6 }), E(12, 12, 10, 4, -60, { fill: 'none', stroke: 'currentColor', sw: 1.6 }),
		C(12, 12, 2.6), C(12, 12, 1.2, { fill: ACC.red }), C(21.5, 12, 1.4, { fill: ACC.blue }), C(7.2, 3.7, 1.4, { fill: ACC.blue }),
	],
	ball: [
		C(12, 12, 10), P(arcD(12, 12, 10, 200, 340) + 'L12 12Z', { fill: ACC.red }), P(arcD(12, 12, 10, 20, 160) + 'L12 12Z', { fill: ACC.red }),
		C(12, 12, 10, { fill: 'none', stroke: 'currentColor', sw: 1.6 }), Ln(2.6, 8.6, 21.4, 8.6, { stroke: 'currentColor', sw: 1.4 }), Ln(2.6, 15.4, 21.4, 15.4, { stroke: 'currentColor', sw: 1.4 }),
	],
	book: [
		P('M3 4H11C12 4 12 5 12 5V20C12 20 12 19 11 19H3Z'), P('M21 4H13C12 4 12 5 12 5V20C12 20 12 19 13 19H21Z'),
		R(5, 7, 5, 1.4, 0.7, { fill: ACC.gold }), R(5, 10, 5, 1.4, 0.7, { fill: ACC.gold }), R(14, 7, 5, 1.4, 0.7, { fill: ACC.gold }), R(14, 10, 5, 1.4, 0.7, { fill: ACC.gold }),
		Ln(12, 5, 12, 20, { stroke: 'currentColor', sw: 1 }),
	],
	brush: [
		Ln(16, 8, 20, 4, { stroke: 'currentColor', sw: 3.4, cap: 'round' }), Ln(10, 14, 16, 8, { stroke: 'currentColor', sw: 3.4 }),
		P('M4 20C4 14 6 12 10 12L12 14C12 18 10 20 4 20Z'), P('M5 19C5.5 15 7 13.5 10 13.5L11 14.5C11 17.5 9 19 5 19Z', { fill: ACC.purple }),
		C(20, 4, 1.8, { fill: ACC.gold }),
	],
	compass: [
		C(12, 12, 10), C(12, 12, 8, { fill: WHITE }), L([[12, 4.5], [14.2, 12], [12, 19.5], [9.8, 12]], { fill: 'currentColor' }, true), L([[12, 4.5], [14.2, 12], [9.8, 12]], { fill: ACC.red }, true),
		C(12, 12, 1.4, { fill: WHITE }),
	],
	mask: [
		P('M2 7C6 5 9 6 12 6C15 6 18 5 22 7C22 14 18 19 12 19C6 19 2 14 2 7Z'),
		E(8, 11, 2.4, 1.6, 0, { fill: WHITE }), E(16, 11, 2.4, 1.6, 0, { fill: WHITE }),
		P('M2 7C6 5 9 6 12 6C15 6 18 5 22 7L21 9C18 8 15 8.5 12 8.5C9 8.5 6 8 3 9Z', { fill: ACC.gold }),
		P('M8 15C10 17 14 17 16 15', { fill: 'none', stroke: ACC.red, sw: 1.4, cap: 'round' }),
	],
	};

	return { tokens };
}
