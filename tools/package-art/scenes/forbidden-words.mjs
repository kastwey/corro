// forbidden-words — party tokens: small emblems in currentColor with one accent each.
export const id = 'forbidden-words';

/** Build the drawings with the package-art API (lib + draw + pictos helpers). */
export default function (art) {
	const { C, E, R, P, Ln, L, G, Curve, arcD, starPts, T } = art;
	const WHITE = '#ffffff';
	const ACC = { red: '#e53935', blue: '#29b6f6', gold: '#fdd835', green: '#43a047', brown: '#8d6e63', purple: '#ab47bc' };

	const tokens = {
		acorn: [
			P('M5 10C5 16 8 21 12 22C16 21 19 16 19 10Z'), P('M4 10C4 6 8 4 12 4C16 4 20 6 20 10Z', { fill: ACC.brown }),
			Ln(12, 4, 12, 1.5, { stroke: 'currentColor', sw: 2, cap: 'round' }), E(9, 14, 1.2, 2.6, -15, { fill: WHITE, fo: 0.5 }),
		],
		arrow: [
			Ln(4, 20, 17, 7, { stroke: 'currentColor', sw: 2.4, cap: 'round' }),
			L([[21, 3], [19.5, 10], [14, 4.5]], {}, true),
			L([[4, 20], [3, 14], [7, 17]], { fill: ACC.red }, true), L([[4, 20], [10, 21], [7, 17]], { fill: ACC.red }, true),
		],
		comet: [
			C(16, 8, 5.5), P('M12 11L2 21L4 22.5L15 13Z'), P('M10 6L2 8L10 9Z', { fill: ACC.gold }), P('M17 14L15 22L13 15Z', { fill: ACC.gold }),
			C(17.5, 7, 1.8, { fill: ACC.blue }),
		],
		knot: [
			P('M6 12C6 6 12 6 12 12C12 18 18 18 18 12C18 6 12 6 12 12C12 18 6 18 6 12Z', { fill: 'none', stroke: 'currentColor', sw: 3 }),
			P('M6 12C6 6 12 6 12 12', { fill: 'none', stroke: ACC.gold, sw: 1.2 }), P('M12 12C12 18 18 18 18 12', { fill: 'none', stroke: ACC.gold, sw: 1.2 }),
		],
		leaf: [
			P('M4 20C4 10 10 4 21 3C21 14 15 20 4 20Z'), P('M5 19C9 13 13 9 19 5', { fill: 'none', stroke: ACC.green, sw: 1.6, cap: 'round' }),
			Ln(4, 20, 2.5, 21.5, { stroke: 'currentColor', sw: 2, cap: 'round' }),
		],
		orbit: [
			E(12, 12, 10.5, 4, -25, { fill: 'none', stroke: 'currentColor', sw: 1.8 }), C(12, 12, 5.5), C(10.5, 10.5, 2, { fill: ACC.blue }),
			C(21, 8, 1.6, { fill: ACC.gold }),
		],
		prism: [
			L([[12, 3], [21, 20], [3, 20]], {}, true), L([[12, 7], [18.5, 18.5], [5.5, 18.5]], { fill: WHITE }, true),
			Ln(2, 12, 9, 13, { stroke: 'currentColor', sw: 1.4, cap: 'round' }),
			...[[ACC.red, 11], [ACC.gold, 13], [ACC.green, 15], [ACC.blue, 17]].map(([c, y]) => Ln(13, 13, 22, y, { stroke: c, sw: 1.4, cap: 'round' })),
		],
		pulse: [
			R(2, 4, 20, 16, 3), P('M4 13H8L10 8L13 17L15 11L17 13H20', { fill: 'none', stroke: WHITE, sw: 1.8, cap: 'round', join: 'round' }),
			C(20.5, 13, 1.3, { fill: ACC.red }),
		],
		spark: [L(starPts(12, 12, 4, 10.5, 3.5), {}, true), L(starPts(12, 12, 4, 5, 1.8, -45), { fill: ACC.gold }, true), C(12, 12, 1.4, { fill: WHITE })],
		wave: [
			P('M2 9C5 5 8 5 11 9C14 13 17 13 20 9L22 11C19 15 14 15 11 11C8 7 5 7 2 11Z'),
			P('M2 15C5 11 8 11 11 15C14 19 17 19 20 15L22 17C19 21 14 21 11 17C8 13 5 13 2 17Z', { fill: ACC.blue }),
		],
	};

	return { tokens };
}
