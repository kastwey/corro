// galactic-race — space-race tokens (currentColor silhouettes with one or two accents).
export const id = 'galactic-race';

/** Build the drawings with the package-art API (lib + draw + pictos helpers). */
export default function (art) {
	const { C, E, R, P, Ln, L, G, Curve, arcD, sectorD, starPts, ngonPts, T, dark } = art;
	const WHITE = '#ffffff';
	const ACC = { red: '#e53935', blue: '#29b6f6', gold: '#fdd835', green: '#43a047', purple: '#ab47bc' };

	const tokens = {
	comet: [
		C(16, 8, 5), P('M12.5 11L2 20L4 22L15 13Z'), P('M9 6L3 10L10 9Z', { fill: ACC.gold }), P('M19.5 13L18 22L16 15Z', { fill: ACC.gold }), C(17, 7, 1.6, { fill: ACC.blue }),
	],
	probe: [
		Ln(12, 10, 12, 21, { stroke: 'currentColor', sw: 2.6, cap: 'round' }), L([[6, 21], [18, 21], [16, 23], [8, 23]], {}, true),
		P('M4 9A8 8 0 0 1 20 9Z'), P('M6 9A6 6 0 0 1 18 9Z', { fill: ACC.blue }), C(12, 9, 1.8, { fill: ACC.red }),
		Ln(12, 4, 12, 9, { stroke: 'currentColor', sw: 1.6 }),
	],
	satellite: [
		R(1.5, 9, 7, 6, 1, { fill: ACC.blue }), R(1.5, 9, 7, 6, 1, { fill: 'none', stroke: 'currentColor', sw: 1.2 }), Ln(5, 9, 5, 15, { stroke: 'currentColor', sw: 1 }),
		R(15.5, 9, 7, 6, 1, { fill: ACC.blue }), R(15.5, 9, 7, 6, 1, { fill: 'none', stroke: 'currentColor', sw: 1.2 }), Ln(19, 9, 19, 15, { stroke: 'currentColor', sw: 1 }),
		R(9, 8, 6, 8, 1.2), P('M12 8A4 4 0 0 1 16 4', { fill: 'none', stroke: 'currentColor', sw: 1.6 }), C(16, 4, 1.4, { fill: ACC.gold }),
	],
	spaceship: [
		L([[12, 2], [20, 20], [12, 16], [4, 20]], {}, true), L([[12, 7], [15.5, 17], [12, 14.5], [8.5, 17]], { fill: ACC.blue }, true),
		C(12, 8, 1.6, { fill: WHITE }), L([[10, 20], [14, 20], [12, 23]], { fill: ACC.red }, true),
	],
	};

	return { tokens };
}
