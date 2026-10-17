// motifs.mjs — reusable drawings shared between scenes (all built on lib.mjs primitives).
import {
	circle, ellipse, rect, polygon, ngon, star, union, diff, stroke, line, arc, arcPoints, bezier, quad,
	spline, blob, translate, scale, rotate, mirrorX, centre, fit, over, deg, sector, ring,
} from './lib.mjs';

/** Triangle arrow head whose tip sits at (x, y) pointing along `angleDeg` (0 = right, 90 = down). */
export function arrowHead(x, y, angleDeg, length, halfWidth = length * 0.6) {
	const tri = polygon([[0, 0], [-length, -halfWidth], [-length, halfWidth]]);
	return translate(rotate(tri, angleDeg), x, y);
}

/** Straight arrow from (x1, y1) to (x2, y2) with a solid head at the end. */
export function arrow(x1, y1, x2, y2, width, headLen = width * 2.4, headHalf = width * 1.5) {
	const a = Math.atan2(y2 - y1, x2 - x1);
	const bx = x2 - Math.cos(a) * headLen * 0.85, by = y2 - Math.sin(a) * headLen * 0.85;
	return union(line(x1, y1, bx, by, width, 'butt'), arrowHead(x2, y2, (a * 180) / Math.PI, headLen, headHalf));
}

/** Curved arrow along a circle from `fromDeg` to `toDeg` with the head at the end. */
export function arcArrow(cx, cy, r, fromDeg, toDeg, width, headLen = width * 2.4, headHalf = width * 1.5) {
	const dir = toDeg > fromDeg ? 1 : -1;
	const headDeg = (headLen * 0.85 * 180) / (Math.PI * r);
	const shaft = arc(cx, cy, r, fromDeg, toDeg - dir * headDeg, width, 'butt');
	const tip = [cx + r * Math.cos(deg(toDeg)), cy + r * Math.sin(deg(toDeg))];
	return union(shaft, arrowHead(tip[0], tip[1], toDeg + dir * 90, headLen, headHalf));
}

/** Two curved arrows chasing each other around (cx, cy): the universal "swap" sign. */
export function swapArrows(cx, cy, r, width, gapDeg = 40) {
	const a = arcArrow(cx, cy, r, 180 + gapDeg / 2, 360 - gapDeg / 2, width);
	const b = arcArrow(cx, cy, r, gapDeg / 2, 180 - gapDeg / 2, width);
	return union(a, b);
}

/** A spiky virus: a disc with knobbed spikes and a few pores. */
export function virus(cx, cy, r, spikes = 8, pores = true, rotDeg = 0) {
	const body = circle(cx, cy, r);
	const parts = [body];
	for (let i = 0; i < spikes; i++) {
		const a = deg(rotDeg + (i / spikes) * 360);
		const x1 = cx + Math.cos(a) * r * 0.7, y1 = cy + Math.sin(a) * r * 0.7;
		const x2 = cx + Math.cos(a) * r * 1.38, y2 = cy + Math.sin(a) * r * 1.38;
		parts.push(line(x1, y1, x2, y2, r * 0.3, 'butt'));
		parts.push(circle(x2, y2, r * 0.22));
	}
	let shape = union(...parts);
	if (pores) {
		shape = diff(shape,
			circle(cx - r * 0.3, cy - r * 0.25, r * 0.22),
			circle(cx + r * 0.3, cy + r * 0.05, r * 0.17),
			circle(cx - r * 0.05, cy + r * 0.4, r * 0.14));
	}
	return shape;
}

/** Capsule pill split in two halves, with a gloss on one half. */
export function pill(cx, cy, length, width, angleDeg = -40) {
	const half = length / 2;
	let p = rect(cx - half, cy - width / 2, length, width, width / 2);
	p = diff(p, rect(cx - width * 0.09, cy - width, width * 0.18, width * 2));
	p = diff(p, rect(cx - half + width * 0.32, cy - width * 0.3, width * 0.42, width * 0.12, width * 0.06));
	return rotate(p, angleDeg, cx, cy);
}

/** Anatomical cartoon heart with two vessel stubs on top. */
export function heart(cx, cy, size) {
	const pts = [];
	for (let i = 0; i < 72; i++) {
		const t = (i / 72) * Math.PI * 2;
		const x = 16 * Math.pow(Math.sin(t), 3);
		const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
		pts.push([x, y]);
	}
	const k = size / 34;
	let h = scale(polygon(pts), k, k);
	// Aorta (a thick tube rising from the notch, open at the top) and a thinner vessel beside it.
	const aorta = diff(
		stroke(quad([-1 * k, -4 * k], [-1 * k, -21 * k], [-12 * k, -22 * k], 12), 7.5 * k),
		circle(-12 * k, -22 * k, 1.8 * k));
	const vessels = line(7 * k, -11 * k, 8.5 * k, -17.5 * k, 5 * k);
	h = union(h, aorta, vessels);
	return translate(h, cx, cy + 1.5 * k);
}

/** Plain love heart (no vessels). */
export function loveHeart(cx, cy, size) {
	const pts = [];
	for (let i = 0; i < 72; i++) {
		const t = (i / 72) * Math.PI * 2;
		pts.push([16 * Math.pow(Math.sin(t), 3), -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))]);
	}
	const k = size / 34;
	return translate(scale(polygon(pts), k, k), cx, cy + 1.5 * k);
}

/** Stomach: oesophagus, bag and duodenum as one smooth blob. */
export function stomach(cx, cy, size) {
	const k = size / 56;
	const outline = spline([
		[-16, -28], [-7, -28], [-6, -18], [4, -16], [18, -10], [26, 4], [22, 18], [10, 26], [-6, 26],
		[-18, 20], [-22, 26], [-28, 26], [-30, 18], [-24, 12], [-18, 10], [-15, 2], [-16, -12],
	], 8, true);
	// A hint of the folds inside the bag.
	const folds = union(stroke(quad([-4, -2], [4, 2], [2, 12]), 2.4), stroke(quad([8, -4], [14, 2], [12, 12]), 2.4));
	return translate(scale(diff(polygon(outline), folds), k, k), cx, cy);
}

/** Brain: two hemispheres, cerebellum and stem with grooves cut in. */
export function brain(cx, cy, size) {
	const k = size / 56;
	const lobes = union(
		circle(-12, -8, 13), circle(2, -14, 13), circle(14, -6, 12), circle(18, 6, 9),
		circle(-16, 4, 11), circle(-4, 6, 13), circle(8, 10, 10),
		ellipse(12, 18, 9, 6, -10), // cerebellum
		rect(-6, 16, 10, 10, 3), // stem
	);
	const grooves = union(
		stroke(quad([-1, -26], [2, -12], [-2, 2], 10), 2.6, { cap: 'round' }), // central fissure
		stroke(quad([-20, -6], [-12, -2], [-14, 10]), 2.2), stroke(quad([-10, -18], [-6, -12], [-12, -8]), 2.2),
		stroke(quad([8, -20], [12, -14], [6, -8]), 2.2), stroke(quad([10, 0], [16, 4], [10, 12]), 2.2),
		stroke(quad([-6, 8], [0, 12], [-8, 16]), 2.2),
		line(2, 16, 20, 14, 2.2), // cerebellum separation
	);
	return translate(scale(diff(lobes, grooves), k, k), cx, cy);
}

/** Dog bone. */
export function bone(cx, cy, length, angleDeg = -40) {
	const w = length * 0.24, r = length * 0.13, half = length / 2 - r * 0.6;
	let b = union(
		rect(-half, -w / 2, half * 2, w, w / 2),
		circle(-half, -r * 0.8, r), circle(-half, r * 0.8, r), circle(half, -r * 0.8, r), circle(half, r * 0.8, r),
	);
	return translate(rotate(b, angleDeg), cx, cy);
}

/** Open hand seen from the palm: palm, four fingers and a thumb. (cx, cy) is the palm centre. */
export function hand(cx, cy, size, { fingers = 4 } = {}) {
	const k = size / 40;
	const palm = rect(-13, -7, 26, 21, 8);
	const fingerParts = [];
	const xs = [-9.6, -3.2, 3.2, 9.6];
	const lens = [13, 17, 16, 12];
	for (let i = 0; i < fingers; i++) fingerParts.push(line(xs[i], -5, xs[i] + (i - 1.5) * 0.5, -5 - lens[i], 4.6));
	const thumb = line(-12, 2, -21, -8, 5.4);
	const h = union(palm, ...fingerParts, thumb);
	return translate(scale(h, k, k), cx, cy);
}

/** Head and shoulders. */
export function bust(cx, cy, size) {
	const k = size / 40;
	const b = union(circle(0, -10, 8), rect(-16, 2, 32, 18, [12, 12, 3, 3]));
	return translate(scale(diff(b, rect(-3, -3.5, 6, 6)), k, k), cx, cy);
}

/** Round "forbidden" sign: ring with a diagonal bar. */
export function forbidden(cx, cy, r, width) {
	const a = deg(45);
	return union(ring(cx, cy, r, r - width), line(cx - Math.cos(a) * (r - width * 0.3), cy - Math.sin(a) * (r - width * 0.3), cx + Math.cos(a) * (r - width * 0.3), cy + Math.sin(a) * (r - width * 0.3), width, 'butt'));
}

/** Plus / cross sign. */
export function cross(cx, cy, size, thickness) {
	return union(rect(cx - size / 2, cy - thickness / 2, size, thickness, thickness * 0.2), rect(cx - thickness / 2, cy - size / 2, thickness, size, thickness * 0.2));
}

/** Four-point sparkle. */
export function sparkle(cx, cy, r, inner = 0.3) {
	return star(cx, cy, 4, r, r * inner);
}

/** Simple syringe laid horizontally, needle to the right, centred on (cx, cy); `length` ≈ total length. */
export function syringe(cx, cy, length, angleDeg = -45) {
	const k = length / 24;
	const barrel = rect(-7, -3.2, 12, 6.4, 1.2);
	const flangeBack = rect(-8.4, -4.2, 2, 8.4, 0.6);
	const rod = rect(-12, -1.2, 5, 2.4, 0.6);
	const thumb = rect(-13.2, -3, 1.8, 6, 0.6);
	const hub = rect(5, -1.6, 2.6, 3.2, 0.4);
	const needle = rect(7.4, -0.65, 5.6, 1.3, 0.3);
	let s = union(barrel, flangeBack, rod, thumb, hub, needle);
	s = diff(s, rect(-2.5, -3.2, 0.9, 2.6), rect(0.5, -3.2, 0.9, 2.6), rect(3.5, -3.2, 0.9, 2.6));
	return translate(rotate(scale(s, k, k), angleDeg), cx, cy);
}

/** Plain six-sided die face (holes for pips) — `pips` from 1 to 6. */
export function die(cx, cy, size, pips = 5) {
	const k = size / 24;
	const face = rect(-11, -11, 22, 22, 4);
	const pos = {
		1: [[0, 0]], 2: [[-5.5, -5.5], [5.5, 5.5]], 3: [[-5.5, -5.5], [0, 0], [5.5, 5.5]],
		4: [[-5.5, -5.5], [5.5, -5.5], [-5.5, 5.5], [5.5, 5.5]],
		5: [[-5.5, -5.5], [5.5, -5.5], [0, 0], [-5.5, 5.5], [5.5, 5.5]],
		6: [[-5.5, -6], [5.5, -6], [-5.5, 0], [5.5, 0], [-5.5, 6], [5.5, 6]],
	}[pips];
	return translate(scale(diff(face, ...pos.map(([x, y]) => circle(x, y, 2.1))), k, k), cx, cy);
}

/** Bold geometric digit glyphs 0-9 built from strokes; height `h`, centred at (cx, cy). */
export function digit(ch, cx, cy, h, weight = h * 0.2) {
	const w = weight;
	const H = 40, W = 24; // design grid; stroke centre-line coordinates
	const r = (W / 2) - w * (40 / h) / 2; // not used directly
	const s = h / H;
	const out = [];
	const L = (pts, cap = 'round') => out.push(stroke(pts, w / s, { cap }));
	const A = (cx2, cy2, rr, from, to, cap = 'round') => out.push(stroke(arcPoints(cx2, cy2, rr, from, to), w / s, { cap }));
	const ww = w / s; // stroke width on the grid
	const half = (W - ww) / 2; // horizontal centreline half-width
	const top = -H / 2 + ww / 2, bot = H / 2 - ww / 2;
	switch (String(ch)) {
		case '0': {
			const rr = half;
			A(0, top + rr, rr, 180, 360); A(0, bot - rr, rr, 0, 180);
			L([[-rr, top + rr], [-rr, bot - rr]], 'butt'); L([[rr, top + rr], [rr, bot - rr]], 'butt');
			break;
		}
		case '1': L([[-half * 0.7, top + half * 0.75], [0, top], [0, bot]]); break;
		case '2': {
			const rr = half;
			A(0, top + rr, rr, 190, 400);
			L([[rr * 0.985, top + rr + rr * 0.17], [-half, bot], [half, bot]]);
			break;
		}
		case '3': {
			const rr = half * 0.98, cyu = top + rr, cyl = bot - rr;
			A(0, cyu, rr, 190, 450); A(0, cyl, rr, -90, 170);
			break;
		}
		case '4': {
			L([[half * 0.45, bot], [half * 0.45, top], [-half, bot - H * 0.32], [half, bot - H * 0.32]]);
			break;
		}
		case '5': {
			// Top bar, a short stem down the left, then a bowl that opens towards the upper left.
			const rr = half * 1.02, cyl = bot - rr;
			const shoulder = [rr * Math.cos(deg(-110)), cyl + rr * Math.sin(deg(-110))];
			L([[half * 0.95, top], [-half * 0.8, top], [-half * 0.8, shoulder[1]], shoulder]);
			A(0, cyl, rr, -110, 160);
			break;
		}
		case '6': {
			const rr = half, cyl = bot - rr;
			A(0, cyl, rr, 0, 360);
			out.push(stroke(quad([-rr, cyl], [-rr, top + rr * 0.3], [half * 0.7, top]), ww, { cap: 'round' }));
			break;
		}
		case '7': L([[-half, top], [half, top], [-half * 0.4, bot]]); break;
		case '8': {
			const ru = half * 0.88, rl = half, cyu = top + ru, cyl = bot - rl;
			A(0, cyu, ru, 0, 360); A(0, cyl, rl, 0, 360);
			break;
		}
		case '9': {
			const rr = half, cyu = top + rr;
			A(0, cyu, rr, 0, 360);
			out.push(stroke(quad([rr, cyu], [rr, bot - rr * 0.3], [-half * 0.7, bot]), ww, { cap: 'round' }));
			break;
		}
		default: throw new Error('digit ' + ch);
	}
	return translate(scale(union(...out), s, s), cx, cy);
}

/** A row of digits, centred, with `gap` between glyph boxes (in canvas units). */
export function number(text, cx, cy, h, weight = h * 0.2, gap = h * 0.12) {
	const chars = String(text).split('');
	const glyphW = h * 0.6;
	const narrow = (c) => (c === '1' ? 0.55 : 1);
	const widths = chars.map((c) => glyphW * narrow(c));
	const total = widths.reduce((a, b) => a + b, 0) + gap * (chars.length - 1);
	let x = cx - total / 2;
	const parts = [];
	for (let i = 0; i < chars.length; i++) {
		parts.push(digit(chars[i], x + widths[i] / 2, cy, h, weight));
		x += widths[i] + gap;
	}
	return union(...parts);
}
