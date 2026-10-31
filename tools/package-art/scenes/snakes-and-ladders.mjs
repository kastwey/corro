// snakes-and-ladders — simple emblem tokens in currentColor with one accent each.
export const id = 'snakes-and-ladders';

/** Build the drawings with the package-art API (lib + draw + pictos helpers). */
export default function (art) {
	const { C, E, R, P, Ln, L, G, arcD, starPts, T, heartPts } = art;
	const WHITE = '#ffffff';
	const ACC = { red: '#e53935', blue: '#29b6f6', gold: '#fdd835', green: '#43a047', pink: '#f06292' };

	const tokens = {
		bell: [
			P('M6 15C6 9 7 5 12 4C17 5 18 9 18 15L20 18H4Z'), R(11, 2, 2, 2.5, 1), C(12, 20.5, 2, { fill: ACC.gold }),
			E(9, 9, 1, 2.8, 10, { fill: WHITE, fo: 0.45 }),
		],
		diamond: [
			L([[12, 2], [21, 12], [12, 22], [3, 12]], {}, true), L([[12, 5], [18.5, 12], [12, 19], [5.5, 12]], { fill: ACC.blue }, true),
			L([[12, 5], [18.5, 12], [12, 12]], { fill: WHITE, fo: 0.35 }, true),
		],
		flower: [
			...[0, 72, 144, 216, 288].map((a) => E(12 + Math.cos((a - 90) * Math.PI / 180) * 6, 12 + Math.sin((a - 90) * Math.PI / 180) * 6, 4.2, 3, a - 90)),
			...[0, 72, 144, 216, 288].map((a) => E(12 + Math.cos((a - 90) * Math.PI / 180) * 6.2, 12 + Math.sin((a - 90) * Math.PI / 180) * 6.2, 2.6, 1.8, a - 90, { fill: ACC.pink })),
			C(12, 12, 3.2, { fill: ACC.gold }),
		],
		heart: [L(heartPts(12, 12, 20), {}, true), E(8.5, 8.5, 1.6, 2.6, -30, { fill: WHITE, fo: 0.5 }), C(12, 13, 2.2, { fill: ACC.red })],
		lightning: [
			L([[13.5, 2], [5, 13], [11, 13], [9.5, 22], [19, 10], [13, 10]], {}, true),
			L([[13, 5], [8.5, 11.5], [12, 11.5], [11, 17], [15, 11.5], [12, 11.5]], { fill: ACC.gold }, true),
		],
		moon: [
			P('M14 2A10 10 0 1 0 22 16A8 8 0 0 1 14 2Z'), L(starPts(17, 7, 4, 2.6, 1), { fill: ACC.gold }, true), L(starPts(20.5, 11.5, 4, 1.8, 0.7), { fill: ACC.gold }, true),
		],
		star: [L(starPts(12, 12, 5, 11, 4.8), {}, true), L(starPts(12, 12.5, 5, 6, 2.6), { fill: ACC.gold }, true)],
		sun: [
			...[0, 45, 90, 135, 180, 225, 270, 315].map((a) => Ln(12 + Math.cos(a * Math.PI / 180) * 7.5, 12 + Math.sin(a * Math.PI / 180) * 7.5, 12 + Math.cos(a * Math.PI / 180) * 10.5, 12 + Math.sin(a * Math.PI / 180) * 10.5, { stroke: 'currentColor', sw: 2.2, cap: 'round' })),
			C(12, 12, 6), C(12, 12, 4, { fill: ACC.gold }),
		],
	};

	return { tokens };
}
