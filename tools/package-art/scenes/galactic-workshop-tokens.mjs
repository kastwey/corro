// galactic-workshop — workshop tokens in currentColor with one accent each.
export const id = 'galactic-workshop';

/** Build the drawings with the package-art API (lib + draw + pictos helpers). */
export default function (art) {
	const { C, E, R, P, Ln, L, G, starPts, T } = art;
	const WHITE = '#ffffff';
	const ACC = { red: '#e53935', blue: '#29b6f6', gold: '#fdd835', green: '#43a047' };

	const tokens = {
		drone: [
			R(8, 10, 8, 5, 2), Ln(8, 12, 3, 8, { stroke: 'currentColor', sw: 2, cap: 'round' }), Ln(16, 12, 21, 8, { stroke: 'currentColor', sw: 2, cap: 'round' }),
			Ln(8, 13, 3, 17, { stroke: 'currentColor', sw: 2, cap: 'round' }), Ln(16, 13, 21, 17, { stroke: 'currentColor', sw: 2, cap: 'round' }),
			...[[3, 8], [21, 8], [3, 17], [21, 17]].map(([x, y]) => E(x, y, 3, 1.1, 0, { fill: ACC.blue })),
			C(12, 12.5, 1.4, { fill: ACC.red }),
		],
		helmet: [
			P('M3 15A9 9 0 0 1 21 15Z'), R(2, 15, 20, 3, 1.5), R(10.5, 4, 3, 4, 1, { fill: ACC.gold }), R(5, 15.5, 14, 1.4, 0.7, { fill: ACC.gold }),
		],
		magnet: [
			P('M4 3H10V12A2 2 0 0 0 14 12V3H20V12A8 8 0 0 1 4 12Z'), R(4, 3, 6, 4, 0, { fill: ACC.red }), R(14, 3, 6, 4, 0, { fill: ACC.blue }),
			P('M4 12A8 8 0 0 0 20 12', { fill: 'none', stroke: WHITE, sw: 1, opacity: 0.4 }),
		],
		robot: [
			R(5, 6, 14, 12, 3), R(9, 18, 6, 4, 1), Ln(12, 6, 12, 3, { stroke: 'currentColor', sw: 2 }), C(12, 2.5, 1.4, { fill: ACC.red }),
			R(2, 9, 3, 6, 1), R(19, 9, 3, 6, 1),
			C(9, 11, 2, { fill: WHITE }), C(15, 11, 2, { fill: WHITE }), C(9, 11, 0.9, { fill: ACC.blue }), C(15, 11, 0.9, { fill: ACC.blue }),
			R(8.5, 14.5, 7, 1.6, 0.8, { fill: ACC.blue }),
		],
		welder: [
			P('M3 13L12 6L15 9L8 17Z'), R(13, 3, 5, 5, 1.5, { transform: T.rotate(45, 15.5, 5.5) }), R(5, 14, 4, 7, 1.2),
			L(starPts(18.5, 11.5, 6, 4.5, 1.8), { fill: ACC.gold }, true), C(18.5, 11.5, 1.4, { fill: WHITE }),
		],
		wrench: [
			G([
				P('M-14 -3A7 7 0 1 1 -14 3L10 3A2.5 2.5 0 0 1 10 -3Z'), R(-19, -4, 7, 8, 0, { fill: WHITE }),
				R(-6, -1, 14, 2, 1, { fill: ACC.blue }),
			], { transform: `${T.translate(13, 12)} ${T.rotate(-45)} ${T.scale(0.72)}` }),
		],
	};

	return { tokens };
}
