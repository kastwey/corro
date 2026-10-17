// grand-tapas-feast — tapas-bar tokens in currentColor with one accent each.
export const id = 'grand-tapas-feast';

/** Build the drawings with the package-art API (lib + draw + pictos helpers). */
export default function (art) {
	const { C, E, R, P, Ln, L, G, T } = art;
	const WHITE = '#ffffff';
	const ACC = { red: '#e53935', green: '#7cb342', gold: '#fdd835', wine: '#ad1457' };

	const tokens = {
		'cocktail-stick': [
			Ln(5, 21, 18, 5, { stroke: 'currentColor', sw: 2.2, cap: 'round' }), C(18.5, 4.5, 2),
			E(11, 13.5, 3.2, 4, -50, { fill: ACC.green }), E(11, 13.5, 1, 1.4, -50, { fill: ACC.red }),
		],
		fork: [
			...[8.5, 12, 15.5].map((x) => Ln(x, 2.5, x, 9, { stroke: 'currentColor', sw: 2.2, cap: 'round' })),
			P('M7 8C7 12 9 13 10.5 14V21.5H13.5V14C15 13 17 12 17 8Z'), R(11, 15, 2, 5.5, 1, { fill: ACC.gold }),
		],
		napkin: [
			R(3, 3, 18, 18, 2), L([[3, 21], [21, 3], [21, 21]], { fill: WHITE, fo: 0.3 }, true), Ln(3, 21, 21, 3, { stroke: WHITE, sw: 1.2 }),
			C(16, 16, 2.6, { fill: ACC.red }),
		],
		olive: [
			E(12, 13, 7, 8.5, -15), E(12, 13, 2.2, 3, -15, { fill: ACC.red }), E(8.5, 8.5, 1.4, 2.4, -15, { fill: WHITE, fo: 0.5 }),
			Ln(16, 5, 19, 2.5, { stroke: 'currentColor', sw: 2, cap: 'round' }),
		],
		'wine-glass': [
			P('M6 2H18L17 10C17 14 14 15.5 12 15.5C10 15.5 7 14 7 10Z'), Ln(12, 15.5, 12, 20, { stroke: 'currentColor', sw: 2 }), R(7, 20, 10, 2.5, 1),
			P('M7.5 7H16.5L17 10C17 13.5 14 15 12 15C10 15 7 13.5 7 10Z', { fill: ACC.wine }), E(14.5, 5, 1, 1.8, 0, { fill: WHITE, fo: 0.5 }),
		],
	};

	return { tokens };
}
