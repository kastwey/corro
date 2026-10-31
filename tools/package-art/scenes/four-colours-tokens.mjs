// four-colours / uno — the basic-shape tokens, each with a coloured inset.
export const id = 'four-colours';

/** Build the drawings with the package-art API (lib + draw + pictos helpers). */
export default function (art) {
	const { C, R, L, starPts, ngonPts } = art;
	const WHITE = '#ffffff';
	const ACC = { red: '#e53935', blue: '#29b6f6', gold: '#fdd835', green: '#43a047', purple: '#ab47bc' };

	const tokens = {
		circle: [C(12, 12, 10), C(12, 12, 6.5, { fill: ACC.red }), C(9.5, 9.5, 1.8, { fill: WHITE, fo: 0.6 })],
		diamond: [L([[12, 2], [22, 12], [12, 22], [2, 12]], {}, true), L([[12, 6], [18, 12], [12, 18], [6, 12]], { fill: ACC.blue }, true)],
		square: [R(2.5, 2.5, 19, 19, 3), R(6.5, 6.5, 11, 11, 1.5, { fill: ACC.green })],
		star: [L(starPts(12, 12, 5, 11, 4.8), {}, true), L(starPts(12, 12.5, 5, 6, 2.6), { fill: ACC.gold }, true)],
		triangle: [L(ngonPts(12, 13, 3, 11), {}, true), L(ngonPts(12, 13.5, 3, 6), { fill: ACC.purple }, true)],
	};

	return { tokens };
}
