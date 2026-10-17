// letter-rush — word-game tokens: desk and voyage objects in currentColor with one accent each.
export const id = 'letter-rush';

/** Build the drawings with the package-art API (lib + draw + pictos helpers). */
export default function (art) {
	const { C, E, R, P, Ln, L, G, arcD, starPts, T } = art;
	const WHITE = '#ffffff';
	const ACC = { red: '#e53935', blue: '#29b6f6', gold: '#fdd835', green: '#43a047', brown: '#8d6e63' };

	const tokens = {
		anchor: [
			C(12, 4.5, 2.6, { fill: 'none', stroke: 'currentColor', sw: 2 }), Ln(12, 7, 12, 21, { stroke: 'currentColor', sw: 2.4, cap: 'round' }),
			Ln(7, 10, 17, 10, { stroke: 'currentColor', sw: 2.2, cap: 'round' }),
			P('M3 13C3 19 7 22 12 22C17 22 21 19 21 13L18.5 14C18.5 18 15.5 20 12 20C8.5 20 5.5 18 5.5 14Z'),
			L([[3, 13], [2, 11], [5.5, 11.5]], { fill: ACC.gold }, true), L([[21, 13], [22, 11], [18.5, 11.5]], { fill: ACC.gold }, true),
		],
		bell: [
			P('M6 15C6 9 7 5 12 4C17 5 18 9 18 15L20 18H4Z'), R(11, 2, 2, 2.5, 1), C(12, 20.5, 2, { fill: ACC.gold }),
			E(9, 9, 1, 2.8, 10, { fill: WHITE, fo: 0.45 }),
		],
		clock: [
			C(12, 12, 10.5), C(12, 12, 8.3, { fill: WHITE }),
			Ln(12, 12, 12, 6.5, { stroke: '#222222', sw: 1.8, cap: 'round' }), Ln(12, 12, 16, 14.5, { stroke: '#222222', sw: 1.8, cap: 'round' }),
			C(12, 12, 1.2, { fill: ACC.red }), ...[0, 90, 180, 270].map((a) => C(12 + Math.cos(a * Math.PI / 180) * 6.6, 12 + Math.sin(a * Math.PI / 180) * 6.6, 0.7, { fill: '#222222' })),
		],
		compass: [
			L(starPts(12, 12, 4, 11, 4), {}, true), C(12, 12, 6.5, { fill: WHITE }),
			L([[12, 6.5], [13.8, 12], [12, 13.5], [10.2, 12]], { fill: ACC.red }, true), L([[12, 17.5], [13.8, 12], [12, 10.5], [10.2, 12]], { fill: '#222222' }, true),
		],
		inkwell: [
			P('M5 21V11C5 9 7 8 9 8H15C17 8 19 9 19 11V21Z'), R(9, 4, 6, 4.5, 1), R(8, 3, 8, 2, 1, { fill: ACC.blue }),
			R(7, 14, 10, 5, 1, { fill: ACC.blue }), E(10, 11.5, 1.6, 0.8, 0, { fill: WHITE, fo: 0.5 }),
		],
		kite: [
			L([[12, 2], [20, 9], [12, 18], [4, 9]], {}, true), L([[12, 4], [18, 9], [12, 16], [6, 9]], { fill: ACC.red }, true),
			Ln(12, 4, 12, 16, { stroke: 'currentColor', sw: 1 }), Ln(6, 9, 18, 9, { stroke: 'currentColor', sw: 1 }),
			P('M12 18C10 20 14 21 12 23', { fill: 'none', stroke: 'currentColor', sw: 1.6, cap: 'round' }), C(11.5, 20.5, 1.1, { fill: ACC.gold }), C(12.5, 22.5, 1.1, { fill: ACC.gold }),
		],
		lantern: [
			R(8, 2.5, 8, 2.5, 1), Ln(12, 1, 12, 2.5, { stroke: 'currentColor', sw: 2, cap: 'round' }),
			P('M7 5H17L18 19H6Z'), R(8.5, 7, 7, 10, 1, { fill: ACC.gold }), R(7, 19, 10, 2.5, 1),
			P('M12 9C13.5 11 14 13 12 15C10 13 10.5 11 12 9Z', { fill: ACC.red }),
		],
		quill: [
			P('M21 3C14 3 8 8 6 16L8 18C13 15 18 10 21 3Z'), P('M6 16L3 21', { fill: 'none', stroke: 'currentColor', sw: 2.2, cap: 'round' }),
			P('M19 5C15 7 12 10 8 16', { fill: 'none', stroke: WHITE, sw: 1, cap: 'round', opacity: 0.6 }), C(3, 21.5, 1.3, { fill: ACC.blue }),
		],
	};

	return { tokens };
}
