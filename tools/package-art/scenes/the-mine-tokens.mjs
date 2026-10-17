// the-mine — mining tokens in currentColor with one accent each.
export const id = 'the-mine';

/** Build the drawings with the package-art API (lib + draw + pictos helpers). */
export default function (art) {
	const { C, E, R, P, Ln, L, G, T, starPts } = art;
	const WHITE = '#ffffff';
	const ACC = { red: '#e53935', gold: '#fdd835', orange: '#fb8c00', brown: '#8d6e63' };

	const tokens = {
		helmet: [P('M3 15A9 9 0 0 1 21 15Z'), R(2, 15, 20, 3, 1.5), C(12, 9, 2.6, { fill: ACC.gold }), C(12, 9, 1.2, { fill: WHITE })],
		lantern: [
			R(8, 2.5, 8, 2.5, 1), Ln(12, 1, 12, 2.5, { stroke: 'currentColor', sw: 2, cap: 'round' }),
			P('M7 5H17L18 19H6Z'), R(8.5, 7, 7, 10, 1, { fill: ACC.gold }), R(7, 19, 10, 2.5, 1),
			P('M12 9C13.5 11 14 13 12 15C10 13 10.5 11 12 9Z', { fill: ACC.orange }),
		],
		'mine-cart': [
			L([[2, 6], [22, 6], [19, 16], [5, 16]], {}, true), C(8, 19.5, 2.4), C(16, 19.5, 2.4),
			...[[8, 7.5], [12, 6.5], [16, 7.5]].map(([x, y]) => L(starPts(x, y, 5, 2.4, 1.3), { fill: ACC.gold }, true)),
		],
		pickaxe: [
			G([Ln(0, -10, 0, 12, { stroke: ACC.brown, sw: 3, cap: 'round' }), P('M-11 -5C-6 -11 6 -11 11 -5L9 -3C5 -7 -5 -7 -9 -3Z'), R(-2, -9, 4, 4, 1)], { transform: `${T.translate(12, 12)} ${T.rotate(-40)} ${T.scale(0.9)}` }),
		],
		shovel: [
			Ln(12, 3, 12, 13, { stroke: ACC.brown, sw: 2.6, cap: 'round' }), R(9.5, 1.5, 5, 2.5, 1.2),
			P('M7 13H17V18C17 21 14.5 22.5 12 22.5C9.5 22.5 7 21 7 18Z'),
		],
	};

	return { tokens };
}
