// four-colours / uno — number and action cards. Each card's artColor is its suit, so the drawing
// uses currentColor for the suit and works for every colour; wild cards carry all four.

export const id = 'four-colours';

/** Build the drawings with the package-art API (lib + draw + pictos helpers). */
export default function (art) {
	const { C, E, R, P, Ln, L, S, G, Curve, arcD, sectorD, T, dark, OUT, INK, WHITE, digits, plus, arcArrow } = art;

const SUITS = ['#c62828', '#a66f00', '#137a43', '#1769aa'];
const OUTLINE = '#263238';

/** The tilted white ellipse every suit card carries. */
const badge = () => E(32, 32, 20, 28, -28, { fill: WHITE, stroke: OUTLINE, sw: OUT });
/** Four-sector ellipse for the wild cards. */
const wildBadge = () => [
	G([
		P(sectorD(0, 0, 1, 180, 270), { fill: SUITS[0] }), P(sectorD(0, 0, 1, 270, 360), { fill: SUITS[1] }),
		P(sectorD(0, 0, 1, 0, 90), { fill: SUITS[2] }), P(sectorD(0, 0, 1, 90, 180), { fill: SUITS[3] }),
	], { transform: `${T.translate(32, 32)} ${T.rotate(-28)} ${T.scale(20, 28)}` }),
	E(32, 32, 20, 28, -28, { fill: 'none', stroke: OUTLINE, sw: OUT }),
];

const numberCard = (n) => [badge(), digits(String(n), 32, 32, 34, 'currentColor', OUTLINE, 7)];
const skip = () => [badge(), C(32, 32, 13, { fill: 'none', stroke: 'currentColor', sw: 5 }), Ln(23, 23, 41, 41, { stroke: 'currentColor', sw: 5, cap: 'round' }), C(32, 32, 13, { fill: 'none', stroke: OUTLINE, sw: 1.2 })];
const reverse = () => [badge(), arcArrow(32, 32, 13, 200, 340, 5, 'currentColor'), arcArrow(32, 32, 13, 20, 160, 5, 'currentColor')];
const miniCards = (cx, cy, n, color) => Array.from({ length: n }, (_, i) => R(cx - 7 + i * 5, cy - 9 - i * 2.5, 12, 17, 2, { fill: color, stroke: OUTLINE, sw: 1.6, transform: T.rotate(-15, cx, cy) }));
const drawTwo = () => [badge(), ...miniCards(24, 38, 2, 'currentColor'), ...plus(40, 20, 10, 'currentColor', OUTLINE), digits('2', 51, 21, 20, 'currentColor', OUTLINE, 4.2)];
const wild = () => [...wildBadge()];
const wildDrawFour = () => [...wildBadge(), ...miniCards(22, 40, 4, WHITE), ...plus(40, 19, 10, WHITE, OUTLINE), digits('4', 51, 20, 20, WHITE, OUTLINE, 4.2)];

const cards = {};
for (const suit of ['red', 'yellow', 'green', 'blue']) {
	for (let n = 0; n <= 9; n++) cards[`${suit}-${n}`] = numberCard(n);
	cards[`${suit}-skip`] = skip();
	cards[`${suit}-reverse`] = reverse();
	cards[`${suit}-draw-two`] = drawTwo();
}
cards.wild = wild();
cards['wild-draw-four'] = wildDrawFour();

	return { cards };
}
