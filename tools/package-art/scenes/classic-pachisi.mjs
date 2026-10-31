// classic-pachisi — classic race tokens (currentColor silhouettes with one or two accents).
export const id = 'classic-pachisi';

/** Build the drawings with the package-art API (lib + draw + pictos helpers). */
export default function (art) {
	const { C, E, R, P, Ln, L, G, Curve, arcD, sectorD, starPts, ngonPts, T, dark } = art;
	const WHITE = '#ffffff';
	const ACC = { red: '#e53935', blue: '#29b6f6', gold: '#fdd835', green: '#43a047', purple: '#ab47bc' };

	const tokens = {
	'dice-cup': [
		P('M5 4H19L17 21H7Z'), R(4, 3, 16, 3, 1.2, { fill: ACC.red }), R(7.5, 17, 9, 2, 0.8, { fill: ACC.red }),
	],
	die: [
		R(3, 3, 18, 18, 4), ...[[8, 8], [16, 8], [12, 12], [8, 16], [16, 16]].map(([x, y]) => C(x, y, 1.8, { fill: WHITE })),
	],
	horse: [
		P('M6 21V13C6 9 9 5 13 4L15 2L18 6C19 7 19 9 18 10L15 10L16 15V21H12V17H10V21Z'),
		P('M13 4C11 5 10 6 9 8L10 9C11 7 12 6 13 5Z', { fill: ACC.gold }), C(15.5, 6.5, 0.9, { fill: WHITE }),
	],
	pawn: [
		C(12, 6, 4), P('M8.5 9H15.5L17 18H7Z'), R(5, 18, 14, 3.5, 1.2),
		R(6, 18.6, 12, 1.2, 0.6, { fill: ACC.gold }), C(12, 6, 1.6, { fill: ACC.gold }),
	],
	};

	return { tokens };
}
