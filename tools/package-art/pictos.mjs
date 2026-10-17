// pictos.mjs — coloured pictograms shared by the property-family and other scenes.
// Everything is drawn on the 64 canvas in the flat + dark-outline house style.
import { C, E, R, P, Ln, L, S, G, Curve, curveD, Arc, arcD, sectorD, starPts, ngonPts, T, flat, dark, light, shade } from './draw.mjs';
import { number as numberShape } from './motifs.mjs';
import { union, diff, inter, rect, circle, ellipse, polygon, spline, star as starShape, ring } from './lib.mjs';

export const OUT = 2.2;
export const INK = '#37474f';
export const GOLD = '#f2b632';
export const PAPER = '#fff8e1';
export const WHITE = '#ffffff';
export const SKIN = '#f3c89a';

export const outlined = (color, extra = {}) => flat(color, OUT, extra);

/** Bold digits as a filled shape with an outline. */
export function digits(text, cx, cy, h, color = INK, stroke = null, weight = h * 0.2) {
	const shape = numberShape(text, cx, cy, h, weight);
	return S(shape, stroke ? { fill: color, stroke, sw: OUT, join: 'round' } : { fill: color });
}

/** Plus sign with an outline. */
export function plus(cx, cy, size, color = INK, stroke = null, t = size * 0.3) {
	const o = stroke ? { fill: color, stroke, sw: OUT, join: 'round' } : { fill: color };
	return [R(cx - t / 2, cy - size / 2, t, size, t * 0.3, o), R(cx - size / 2, cy - t / 2, size, t, t * 0.3, o), R(cx - t / 2 + 1, cy - size / 2 + 1, t - 2, size - 2, 0, { fill: color }), R(cx - size / 2 + 1, cy - t / 2 + 1, size - 2, t - 2, 0, { fill: color })];
}

/** Euro coin. */
export function coin(cx, cy, r, color = GOLD) {
	const d = dark(color);
	return [
		C(cx, cy, r, { fill: color, stroke: d, sw: OUT }),
		C(cx, cy, r * 0.76, { fill: 'none', stroke: d, sw: 1.4 }),
		P(arcD(cx + r * 0.08, cy, r * 0.4, 45, 315), { stroke: d, sw: r * 0.17, cap: 'round', fill: 'none' }),
		Ln(cx - r * 0.42, cy - r * 0.12, cx + r * 0.1, cy - r * 0.12, { stroke: d, sw: r * 0.14, cap: 'round' }),
		Ln(cx - r * 0.42, cy + r * 0.12, cx + r * 0.1, cy + r * 0.12, { stroke: d, sw: r * 0.14, cap: 'round' }),
	];
}

/** Stack of coins seen from the side. */
export function coinStack(cx, cy, w, n = 3, color = GOLD) {
	const h = w * 0.3, d = dark(color);
	const parts = [];
	for (let i = n - 1; i >= 0; i--) {
		const y = cy + (n / 2 - i - 1) * h;
		parts.push(R(cx - w / 2, y, w, h, h * 0.45, { fill: color, stroke: d, sw: 1.6 }));
		parts.push(Ln(cx - w / 2 + w * 0.15, y + h * 0.48, cx + w / 2 - w * 0.15, y + h * 0.48, { stroke: d, sw: 1.2, cap: 'round' }));
	}
	return parts;
}

/** Banknote with a medallion. */
export function banknote(cx, cy, w, h, color = '#7cb342') {
	const d = dark(color);
	return [
		R(cx - w / 2, cy - h / 2, w, h, h * 0.1, { fill: color, stroke: d, sw: OUT }),
		R(cx - w / 2 + w * 0.08, cy - h / 2 + h * 0.14, w * 0.84, h * 0.72, h * 0.06, { fill: 'none', stroke: d, sw: 1.4 }),
		C(cx, cy, h * 0.28, { fill: light(color), stroke: d, sw: 1.4 }),
		P(arcD(cx + h * 0.03, cy, h * 0.12, 45, 315), { stroke: d, sw: 2, cap: 'round', fill: 'none' }),
		Ln(cx - h * 0.14, cy - h * 0.04, cx + h * 0.02, cy - h * 0.04, { stroke: d, sw: 1.6 }), Ln(cx - h * 0.14, cy + h * 0.04, cx + h * 0.02, cy + h * 0.04, { stroke: d, sw: 1.6 }),
	];
}

/** Classical bank. */
export function bank(cx, cy, w, h, color = '#cfd8dc') {
	const x = cx - w / 2, y = cy - h / 2, d = dark(color);
	const cols = [];
	for (let i = 0; i < 4; i++) {
		const cxx = x + w * 0.14 + (i * w * 0.72) / 3;
		cols.push(R(cxx - w * 0.06, y + h * 0.42, w * 0.12, h * 0.44, 0, { fill: light(color), stroke: d, sw: 1.6 }));
	}
	return [
		L([[x - w * 0.04, y + h * 0.3], [cx, y], [x + w * 1.04, y + h * 0.3]], { fill: color, stroke: d, sw: OUT, join: 'round' }, true),
		R(x, y + h * 0.3, w, h * 0.1, 0, { fill: light(color), stroke: d, sw: 1.6 }),
		...cols,
		R(x - w * 0.02, y + h * 0.86, w * 1.04, h * 0.14, h * 0.03, { fill: color, stroke: d, sw: OUT }),
		C(cx, y + h * 0.17, h * 0.07, { fill: GOLD, stroke: dark(GOLD), sw: 1.2 }),
	];
}

/** House with a red roof. */
export function house(cx, cy, w, h, wall = '#ffe0b2', roof = '#d9534f') {
	const x = cx - w / 2, y = cy - h / 2;
	return [
		R(x + w * 0.66, y + h * 0.1, w * 0.14, h * 0.3, 0, { fill: dark(roof), stroke: dark(roof), sw: 1 }),
		R(x + w * 0.1, y + h * 0.42, w * 0.8, h * 0.58, 0, { fill: wall, stroke: dark(wall), sw: OUT }),
		L([[x - w * 0.08, y + h * 0.48], [cx, y], [x + w * 1.08, y + h * 0.48]], { fill: roof, stroke: dark(roof), sw: OUT, join: 'round' }, true),
		R(cx - w * 0.1, y + h * 0.66, w * 0.2, h * 0.34, 0, { fill: '#8d6e63', stroke: dark('#8d6e63'), sw: 1.4 }),
		R(x + w * 0.2, y + h * 0.52, w * 0.16, h * 0.14, 0, { fill: '#81d4fa', stroke: dark(wall), sw: 1.4 }),
		R(x + w * 0.64, y + h * 0.52, w * 0.16, h * 0.14, 0, { fill: '#81d4fa', stroke: dark(wall), sw: 1.4 }),
	];
}

/** Tall building with lit windows. */
export function building(cx, cy, w, h, cols = 3, rows = 4, color = '#90a4ae') {
	const x = cx - w / 2, y = cy - h / 2, d = dark(color);
	const parts = [R(x, y, w, h, w * 0.06, { fill: color, stroke: d, sw: OUT })];
	const ww = (w * 0.7) / cols, wh = (h * 0.68) / rows;
	for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
		parts.push(R(x + w * 0.15 + c * ww + ww * 0.2, y + h * 0.1 + r * wh + wh * 0.18, ww * 0.6, wh * 0.56, 0.6, { fill: (r + c) % 3 === 1 ? '#fff59d' : '#b3e5fc' }));
	}
	parts.push(R(cx - w * 0.12, y + h * 0.8, w * 0.24, h * 0.2, 0, { fill: d }));
	return parts;
}

/** Museum / palace with a dome and columns. */
export function museum(cx, cy, w, h, color = '#e0cda9') {
	const x = cx - w / 2, y = cy - h / 2, d = dark(color);
	const cols = [];
	for (let i = 0; i < 5; i++) {
		const cxx = x + w * 0.1 + (i * w * 0.8) / 4;
		cols.push(R(cxx - w * 0.05, y + h * 0.5, w * 0.1, h * 0.36, 0, { fill: light(color), stroke: d, sw: 1.4 }));
	}
	return [
		P(sectorD(cx, y + h * 0.36, w * 0.2, 180, 360), { fill: '#5d8aa8', stroke: dark('#5d8aa8'), sw: OUT }),
		R(cx - w * 0.03, y + h * 0.08, w * 0.06, h * 0.12, 0, { fill: dark('#5d8aa8') }),
		R(x, y + h * 0.36, w, h * 0.12, 1, { fill: color, stroke: d, sw: OUT }),
		...cols,
		R(x - w * 0.03, y + h * 0.86, w * 1.06, h * 0.14, 1, { fill: color, stroke: d, sw: OUT }),
	];
}

/** Front of a train. */
export function trainFront(cx, cy, w, h, color = '#e53935') {
	const x = cx - w / 2, y = cy - h / 2, d = dark(color);
	return [
		R(x + w * 0.38, y - h * 0.06, w * 0.24, h * 0.1, 1, { fill: INK }),
		R(x, y, w, h * 0.82, [w * 0.3], { fill: color, stroke: d, sw: OUT }),
		P(`M${x + w * 0.3} ${y}H${x + w * 0.7}A${w * 0.3} ${w * 0.3} 0 0 1 ${x + w} ${y + w * 0.3}V${y + h * 0.82}H${x}V${y + w * 0.3}A${w * 0.3} ${w * 0.3} 0 0 1 ${x + w * 0.3} ${y}Z`, { fill: color, stroke: d, sw: OUT, join: 'round' }),
		P(`M${x + w * 0.2} ${y + h * 0.4}V${y + h * 0.18}A${w * 0.12} ${w * 0.12} 0 0 1 ${x + w * 0.32} ${y + h * 0.08}H${x + w * 0.68}A${w * 0.12} ${w * 0.12} 0 0 1 ${x + w * 0.8} ${y + h * 0.18}V${y + h * 0.4}Z`, { fill: '#b3e5fc', stroke: d, sw: 1.6 }),
		C(x + w * 0.22, y + h * 0.62, w * 0.07, { fill: '#fff59d', stroke: d, sw: 1.4 }),
		C(x + w * 0.78, y + h * 0.62, w * 0.07, { fill: '#fff59d', stroke: d, sw: 1.4 }),
		R(x + w * 0.32, y + h * 0.58, w * 0.36, h * 0.08, 1, { fill: light(color), stroke: d, sw: 1.2 }),
		R(x + w * 0.1, y + h * 0.82, w * 0.2, h * 0.18, 1.5, { fill: INK }),
		R(x + w * 0.7, y + h * 0.82, w * 0.2, h * 0.18, 1.5, { fill: INK }),
	];
}

/** Lightning bolt. */
export function bolt(cx, cy, h, color = '#ffca28') {
	const k = h / 40;
	const pts = [[4, -20], [-9, 3], [-1, 3], [-6, 20], [10, -5], [2, -5], [8, -20]].map(([x, y]) => [cx + x * k, cy + y * k]);
	return [L(pts, { fill: color, stroke: dark(color), sw: OUT, join: 'round' }, true)];
}

/** Water drop. */
export function drop(cx, cy, h, color = '#42a5f5') {
	const k = h / 40;
	const pts = [[0, -20], [8, -4], [11, 6], [6, 16], [0, 19], [-6, 16], [-11, 6], [-8, -4]].map(([x, y]) => [cx + x * k, cy + y * k]);
	return [Curve(pts, { fill: color, stroke: dark(color), sw: OUT, join: 'round' }, true), E(cx - 4 * k, cy + 2 * k, 2 * k, 4 * k, 15, { fill: WHITE, fo: 0.5 })];
}

/** Classic key. */
export function key(cx, cy, length, angle = -35, color = GOLD) {
	const k = length / 48, d = dark(color);
	return [G([
		R(-9, -2.4, 32, 4.8, 1.5, { fill: color, stroke: d, sw: OUT }),
		R(14, 0, 4, 7, 1, { fill: color, stroke: d, sw: OUT }), R(20, 0, 4, 5, 1, { fill: color, stroke: d, sw: OUT }),
		C(-16, 0, 8, { fill: color, stroke: d, sw: OUT }), C(-16, 0, 3.2, { fill: PAPER, stroke: d, sw: 1.4 }),
	], { transform: `${T.translate(cx, cy)} ${T.rotate(angle)} ${T.scale(k)}` })];
}

/** Spanner. */
export function wrench(cx, cy, length, angle = -45, color = '#90a4ae') {
	const k = length / 48;
	const head = diff(circle(-15, 0, 9), rect(-19, -11, 8, 9), circle(-15, -0.5, 2));
	return [G([S(union(head, rect(-8, -3.2, 30, 6.4, 3.2)), { fill: color, stroke: dark(color), sw: OUT, join: 'round' })],
		{ transform: `${T.translate(cx, cy)} ${T.rotate(angle)} ${T.scale(k)}` })];
}

/** Crossword grid. */
export function crossword(cx, cy, size, n = 5) {
	const cell = size / n, parts = [R(cx - size / 2, cy - size / 2, size, size, 2, { fill: WHITE, stroke: INK, sw: OUT })];
	for (const [r, c] of [[0, 1], [1, 3], [2, 0], [2, 4], [3, 2], [4, 1], [4, 3]]) parts.push(R(cx - size / 2 + c * cell, cy - size / 2 + r * cell, cell, cell, 0, { fill: INK }));
	for (let i = 1; i < n; i++) {
		parts.push(Ln(cx - size / 2 + i * cell, cy - size / 2, cx - size / 2 + i * cell, cy + size / 2, { stroke: INK, sw: 1.4 }));
		parts.push(Ln(cx - size / 2, cy - size / 2 + i * cell, cx + size / 2, cy - size / 2 + i * cell, { stroke: INK, sw: 1.4 }));
	}
	parts.push(R(cx - size / 2 + 2 * cell + 1.5, cy - size / 2 + 1 * cell + 1.5, cell - 3, cell - 3, 0, { fill: '#ffe082' }));
	return parts;
}

/** Barred window. */
export function bars(cx, cy, w, h) {
	const parts = [P(`M${cx - w / 2} ${cy + h / 2}V${cy - h / 2 + w / 2}A${w / 2} ${w / 2} 0 0 1 ${cx + w / 2} ${cy - h / 2 + w / 2}V${cy + h / 2}Z`, { fill: '#455a64', stroke: dark('#455a64'), sw: OUT, join: 'round' })];
	parts.push(P(`M${cx - w / 2 + 4} ${cy + h / 2 - 4}V${cy - h / 2 + w / 2}A${w / 2 - 4} ${w / 2 - 4} 0 0 1 ${cx + w / 2 - 4} ${cy - h / 2 + w / 2}V${cy + h / 2 - 4}Z`, { fill: '#b0bec5' }));
	for (let i = 1; i <= 3; i++) parts.push(Ln(cx - w / 2 + (i * w) / 4, cy - h / 2 + 2, cx - w / 2 + (i * w) / 4, cy + h / 2 - 2, { stroke: '#263238', sw: 3.2, cap: 'round' }));
	parts.push(Ln(cx - w / 2 + 2, cy + h * 0.1, cx + w / 2 - 2, cy + h * 0.1, { stroke: '#263238', sw: 3, cap: 'round' }));
	return parts;
}

/** Birthday cake. */
export function cake(cx, cy, w, h) {
	const x = cx - w / 2, y = cy - h / 2;
	const parts = [R(x - w * 0.08, y + h * 0.9, w * 1.16, h * 0.1, 2, { fill: '#b0bec5', stroke: dark('#b0bec5'), sw: 1.6 })];
	parts.push(R(x, y + h * 0.45, w, h * 0.45, 2, { fill: '#f8bbd0', stroke: dark('#f8bbd0'), sw: OUT }));
	parts.push(R(x, y + h * 0.66, w, h * 0.05, 0, { fill: dark('#f8bbd0') }));
	parts.push(P(`M${x} ${y + h * 0.5}` + [0, 1, 2, 3, 4].map((i) => `A${w * 0.1} ${w * 0.1} 0 0 0 ${x + (i + 1) * w * 0.2} ${y + h * 0.5}`).join('') + `V${y + h * 0.45}H${x}Z`, { fill: '#ffecb3', stroke: dark('#ffecb3'), sw: 1.4 }));
	for (let i = 0; i < 3; i++) {
		const cxx = x + w * 0.25 + (i * w * 0.5) / 2;
		parts.push(R(cxx - w * 0.035, y + h * 0.16, w * 0.07, h * 0.32, 1, { fill: ['#ef5350', '#42a5f5', '#66bb6a'][i], stroke: INK, sw: 1 }));
		parts.push(E(cxx, y + h * 0.08, w * 0.04, h * 0.08, 0, { fill: '#ffb300' }));
		parts.push(E(cxx, y + h * 0.1, w * 0.02, h * 0.04, 0, { fill: '#fff59d' }));
	}
	return parts;
}

/** Shield. */
export function shield(cx, cy, w, h, color = '#1976d2') {
	const x = cx - w / 2, y = cy - h / 2;
	return [Curve([[cx, y], [x + w, y + h * 0.15], [x + w, y + h * 0.5], [x + w * 0.8, y + h * 0.82], [cx, y + h], [x + w * 0.2, y + h * 0.82], [x, y + h * 0.5], [x, y + h * 0.15]], { fill: color, stroke: dark(color), sw: OUT, join: 'round' }, true, 0.8)];
}

/** Love heart shape (plain). */
export function heartPts(cx, cy, size) {
	const k = size / 34, pts = [];
	for (let i = 0; i < 40; i++) {
		const t = (i / 40) * Math.PI * 2;
		pts.push([cx + 16 * Math.pow(Math.sin(t), 3) * k, cy + 1.5 * k - (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * k]);
	}
	return pts;
}
export const heart = (cx, cy, size, color = '#e53935') => Curve(heartPts(cx, cy, size), { fill: color, stroke: dark(color), sw: OUT, join: 'round' }, true);

/** Prize rosette. */
export function rosette(cx, cy, r, color = '#42a5f5', ribbon = '#ef5350') {
	return [
		L([[cx - r * 0.5, cy + r * 0.5], [cx - r * 0.1, cy + r * 0.5], [cx - r * 0.2, cy + r * 1.9], [cx - r * 0.45, cy + r * 1.65], [cx - r * 0.75, cy + r * 1.9]], { fill: ribbon, stroke: dark(ribbon), sw: 1.6, join: 'round' }, true),
		L([[cx + r * 0.1, cy + r * 0.5], [cx + r * 0.5, cy + r * 0.5], [cx + r * 0.75, cy + r * 1.9], [cx + r * 0.45, cy + r * 1.65], [cx + r * 0.2, cy + r * 1.9]], { fill: ribbon, stroke: dark(ribbon), sw: 1.6, join: 'round' }, true),
		L(starPts(cx, cy, 12, r, r * 0.84), { fill: color, stroke: dark(color), sw: OUT, join: 'round' }, true),
		C(cx, cy, r * 0.66, { fill: light(color), stroke: dark(color), sw: 1.6 }),
		L(starPts(cx, cy, 5, r * 0.4, r * 0.17), { fill: GOLD, stroke: dark(GOLD), sw: 1.2, join: 'round' }, true),
	];
}

/** Mortarboard. */
export function mortarboard(cx, cy, w, color = '#263238') {
	return [
		E(cx, cy + w * 0.08, w * 0.3, w * 0.16, 0, { fill: color, stroke: dark(color), sw: OUT }),
		E(cx, cy + w * 0.02, w * 0.3, w * 0.16, 0, { fill: '#546e7a' }),
		L([[cx, cy - w * 0.28], [cx + w / 2, cy - w * 0.04], [cx, cy + w * 0.2], [cx - w / 2, cy - w * 0.04]], { fill: color, stroke: dark(color), sw: OUT, join: 'round' }, true),
		Ln(cx + w * 0.42, cy - w * 0.06, cx + w * 0.46, cy + w * 0.3, { stroke: GOLD, sw: 2, cap: 'round' }),
		C(cx + w * 0.46, cy + w * 0.33, w * 0.06, { fill: GOLD, stroke: dark(GOLD), sw: 1.2 }),
	];
}

/** Briefcase. */
export function briefcase(cx, cy, w, h, color = '#8d6e63') {
	const x = cx - w / 2, y = cy - h / 2, d = dark(color);
	return [
		P(`M${cx - w * 0.14} ${y + h * 0.26}V${y + h * 0.1}A${h * 0.08} ${h * 0.08} 0 0 1 ${cx - w * 0.06} ${y + h * 0.02}H${cx + w * 0.06}A${h * 0.08} ${h * 0.08} 0 0 1 ${cx + w * 0.14} ${y + h * 0.1}V${y + h * 0.26}`, { fill: 'none', stroke: d, sw: 4 }),
		R(x, y + h * 0.22, w, h * 0.78, h * 0.08, { fill: color, stroke: d, sw: OUT }),
		Ln(x, y + h * 0.55, x + w, y + h * 0.55, { stroke: d, sw: 2 }),
		R(cx - w * 0.08, y + h * 0.48, w * 0.16, h * 0.14, 1, { fill: GOLD, stroke: dark(GOLD), sw: 1.2 }),
	];
}

/** Document with lines and an optional seal. */
export function document(cx, cy, w, h, seal = false) {
	const x = cx - w / 2, y = cy - h / 2, fold = w * 0.28;
	const parts = [
		L([[x, y], [x + w - fold, y], [x + w, y + fold], [x + w, y + h], [x, y + h]], { fill: WHITE, stroke: INK, sw: OUT, join: 'round' }, true),
		L([[x + w - fold, y], [x + w - fold, y + fold], [x + w, y + fold]], { fill: '#eceff1', stroke: INK, sw: OUT, join: 'round' }, true),
	];
	for (let i = 0; i < 4; i++) parts.push(Ln(x + w * 0.16, y + h * (0.4 + i * 0.13), x + w * (i === 3 ? 0.56 : 0.84), y + h * (0.4 + i * 0.13), { stroke: '#90a4ae', sw: h * 0.045, cap: 'round' }));
	if (seal) parts.push(C(x + w * 0.74, y + h * 0.78, w * 0.17, { fill: '#ef5350', stroke: dark('#ef5350'), sw: 1.4 }), L(starPts(x + w * 0.74, y + h * 0.78, 5, w * 0.09, w * 0.04), { fill: '#ffcdd2' }, true));
	return parts;
}

/** Bar chart with a rising arrow. */
export function chartUp(cx, cy, w, h) {
	const x = cx - w / 2, y = cy - h / 2;
	return [
		Ln(x, y, x, y + h, { stroke: INK, sw: 3, cap: 'round' }), Ln(x, y + h, x + w, y + h, { stroke: INK, sw: 3, cap: 'round' }),
		R(x + w * 0.16, y + h * 0.6, w * 0.16, h * 0.4, 1, { fill: '#ef5350', stroke: dark('#ef5350'), sw: 1.4 }),
		R(x + w * 0.4, y + h * 0.42, w * 0.16, h * 0.58, 1, { fill: '#ffca28', stroke: dark('#ffca28'), sw: 1.4 }),
		R(x + w * 0.64, y + h * 0.24, w * 0.16, h * 0.76, 1, { fill: '#66bb6a', stroke: dark('#66bb6a'), sw: 1.4 }),
		arrow(x + w * 0.12, y + h * 0.5, x + w * 0.92, y + h * 0.06, 3.4, '#1e88e5'),
	];
}

/** Straight arrow with head. */
export function arrow(x1, y1, x2, y2, sw, color = INK, head = sw * 2.2) {
	const a = Math.atan2(y2 - y1, x2 - x1), deg = (a * 180) / Math.PI;
	const bx = x2 - Math.cos(a) * head * 0.9, by = y2 - Math.sin(a) * head * 0.9;
	return G([
		Ln(x1, y1, bx, by, { stroke: color, sw, cap: 'round' }),
		G([L([[head * 0.2, 0], [-head, -head * 0.7], [-head, head * 0.7]], { fill: color, stroke: color, sw: 1, join: 'round' }, true)], { transform: `${T.translate(x2, y2)} ${T.rotate(deg)}` }),
	]);
}

/** Curved arrow along a circle (clockwise on screen when to > from), head at the end. */
export function arcArrow(cx, cy, r, fromDeg, toDeg, sw, color = INK, head = sw * 2.2) {
	const dir = toDeg > fromDeg ? 1 : -1;
	const headDeg = (head * 0.9 * 180) / (Math.PI * r);
	const end = toDeg - dir * headDeg;
	const tipA = (toDeg * Math.PI) / 180;
	return G([
		P(arcD(cx, cy, r, fromDeg, end), { stroke: color, sw, cap: 'round', fill: 'none' }),
		G([L([[head * 0.2, 0], [-head, -head * 0.7], [-head, head * 0.7]], { fill: color, stroke: color, sw: 1, join: 'round' }, true)],
			{ transform: `${T.translate(cx + r * Math.cos(tipA), cy + r * Math.sin(tipA))} ${T.rotate(toDeg + dir * 90)}` }),
	]);
}

/** Beach umbrella and sun. */
export function holiday(cx, cy, w) {
	const ux = cx - w * 0.12;
	return [
		L(starPts(cx + w * 0.3, cy - w * 0.28, 10, w * 0.2, w * 0.13), { fill: '#ffca28', stroke: dark('#ffca28'), sw: 1.6, join: 'round' }, true),
		C(cx + w * 0.3, cy - w * 0.28, w * 0.1, { fill: '#ffe082' }),
		R(cx - w * 0.5, cy + w * 0.4, w, w * 0.1, 2, { fill: '#ffe0b2', stroke: dark('#ffe0b2'), sw: 1.6 }),
		Ln(ux, cy, ux + w * 0.06, cy + w * 0.46, { stroke: '#8d6e63', sw: 3, cap: 'round' }),
		P(sectorD(ux, cy + w * 0.02, w * 0.38, 180, 360), { fill: '#ef5350', stroke: dark('#ef5350'), sw: OUT }),
		P(sectorD(ux, cy + w * 0.02, w * 0.38, 210, 240), { fill: WHITE }), P(sectorD(ux, cy + w * 0.02, w * 0.38, 270, 300), { fill: WHITE }), P(sectorD(ux, cy + w * 0.02, w * 0.38, 330, 360), { fill: WHITE }),
		P(sectorD(ux, cy + w * 0.02, w * 0.38, 180, 360), { fill: 'none', stroke: dark('#ef5350'), sw: OUT }),
	];
}

/** Traffic cone. */
export function cone(cx, cy, h) {
	const w = h * 0.6;
	return [
		R(cx - w * 0.6, cy + h * 0.36, w * 1.2, h * 0.14, 2, { fill: '#ff7043', stroke: dark('#ff7043'), sw: OUT }),
		L([[cx - w * 0.18, cy - h / 2], [cx + w * 0.18, cy - h / 2], [cx + w * 0.42, cy + h * 0.4], [cx - w * 0.42, cy + h * 0.4]], { fill: '#ff7043', stroke: dark('#ff7043'), sw: OUT, join: 'round' }, true),
		L([[cx - w * 0.25, cy - h * 0.15], [cx + w * 0.25, cy - h * 0.15], [cx + w * 0.29, cy - h * 0.02], [cx - w * 0.29, cy - h * 0.02]], { fill: WHITE }, true),
		L([[cx - w * 0.33, cy + h * 0.1], [cx + w * 0.33, cy + h * 0.1], [cx + w * 0.37, cy + h * 0.23], [cx - w * 0.37, cy + h * 0.23]], { fill: WHITE }, true),
	];
}

/** Shirt collar with a tie. */
export function necktie(cx, cy, h, tie = '#c62828') {
	const w = h * 0.62;
	return [
		L([[cx - w / 2, cy - h / 2], [cx - w * 0.08, cy - h * 0.1], [cx, cy - h * 0.2], [cx + w * 0.08, cy - h * 0.1], [cx + w / 2, cy - h / 2], [cx + w * 0.3, cy - h * 0.02], [cx - w * 0.3, cy - h * 0.02]], { fill: WHITE, stroke: INK, sw: OUT, join: 'round' }, true),
		L([[cx - w * 0.1, cy], [cx + w * 0.1, cy], [cx + w * 0.2, cy + h * 0.38], [cx, cy + h / 2], [cx - w * 0.2, cy + h * 0.38]], { fill: tie, stroke: dark(tie), sw: OUT, join: 'round' }, true),
		L([[cx - w * 0.12, cy - h * 0.18], [cx + w * 0.12, cy - h * 0.18], [cx + w * 0.14, cy - h * 0.02], [cx - w * 0.14, cy - h * 0.02]], { fill: tie, stroke: dark(tie), sw: OUT, join: 'round' }, true),
	];
}

/** Doctor's bag. */
export function medicalBag(cx, cy, w, h, color = '#5d4037') {
	const x = cx - w / 2, y = cy - h / 2, d = dark(color);
	return [
		P(`M${cx - w * 0.16} ${y + h * 0.26}V${y + h * 0.12}A${h * 0.1} ${h * 0.1} 0 0 1 ${cx - w * 0.06} ${y + h * 0.02}H${cx + w * 0.06}A${h * 0.1} ${h * 0.1} 0 0 1 ${cx + w * 0.16} ${y + h * 0.12}V${y + h * 0.26}`, { fill: 'none', stroke: d, sw: 4 }),
		R(x, y + h * 0.22, w, h * 0.78, h * 0.18, { fill: color, stroke: d, sw: OUT }),
		Ln(x, y + h * 0.36, x + w, y + h * 0.36, { stroke: d, sw: 2 }),
		R(cx - h * 0.07, cy - h * 0.1, h * 0.14, h * 0.42, 1, { fill: WHITE }), R(cx - h * 0.21, cy + h * 0.04, h * 0.42, h * 0.14, 1, { fill: WHITE }),
	];
}

/** Hospital. */
export function hospital(cx, cy, w, h) {
	const x = cx - w / 2, y = cy - h / 2;
	const parts = [
		R(cx - w * 0.2, y, w * 0.4, h * 0.2, 1, { fill: '#eceff1', stroke: INK, sw: OUT }),
		R(x, y + h * 0.12, w, h * 0.88, 1, { fill: '#eceff1', stroke: INK, sw: OUT }),
	];
	for (const wx of [0.12, 0.72]) for (const wy of [0.3, 0.52, 0.74]) parts.push(R(x + w * wx, y + h * wy, w * 0.16, h * 0.14, 0.6, { fill: '#81d4fa', stroke: INK, sw: 1.2 }));
	parts.push(R(cx - h * 0.06, y + h * 0.32, h * 0.12, h * 0.36, 1, { fill: '#e53935' }), R(cx - h * 0.18, y + h * 0.44, h * 0.36, h * 0.12, 1, { fill: '#e53935' }));
	parts.push(R(cx - w * 0.1, y + h * 0.8, w * 0.2, h * 0.2, 0, { fill: INK }));
	return parts;
}

/** Start flag. */
export function startFlag(cx, cy, h) {
	return [
		Ln(cx - h * 0.26, cy - h / 2, cx - h * 0.26, cy + h / 2, { stroke: INK, sw: 3.2, cap: 'round' }),
		L([[cx - h * 0.22, cy - h / 2], [cx + h * 0.36, cy - h * 0.38], [cx + h * 0.22, cy - h * 0.2], [cx + h * 0.36, cy - h * 0.02], [cx - h * 0.22, cy + h * 0.1]], { fill: '#43a047', stroke: dark('#43a047'), sw: OUT, join: 'round' }, true),
	];
}

/** Piggy bank. */
export function piggy(cx, cy, w, color = '#f48fb1') {
	const d = dark(color);
	return [
		R(cx - w * 0.3, cy + w * 0.22, w * 0.12, w * 0.16, 2, { fill: color, stroke: d, sw: 1.6 }), R(cx + w * 0.14, cy + w * 0.22, w * 0.12, w * 0.16, 2, { fill: color, stroke: d, sw: 1.6 }),
		L([[cx + w * 0.28, cy - w * 0.16], [cx + w * 0.36, cy - w * 0.32], [cx + w * 0.44, cy - w * 0.14]], { fill: color, stroke: d, sw: 1.6, join: 'round' }, true),
		E(cx, cy, w * 0.42, w * 0.32, 0, { fill: color, stroke: d, sw: OUT }),
		C(cx + w * 0.34, cy + w * 0.02, w * 0.2, { fill: color, stroke: d, sw: OUT }),
		E(cx + w * 0.5, cy + w * 0.06, w * 0.09, w * 0.12, 0, { fill: light(color), stroke: d, sw: 1.6 }),
		C(cx + w * 0.48, cy + w * 0.02, w * 0.02, { fill: d }), C(cx + w * 0.48, cy + w * 0.1, w * 0.02, { fill: d }),
		C(cx + w * 0.36, cy - w * 0.04, w * 0.03, { fill: INK }),
		R(cx - w * 0.12, cy - w * 0.34, w * 0.24, w * 0.05, 1, { fill: d }),
		C(cx, cy - w * 0.44, w * 0.09, { fill: GOLD, stroke: dark(GOLD), sw: 1.4 }),
	];
}

/** Gem / crystal. */
export function gem(cx, cy, w, color = '#26c6da') {
	const h = w * 0.9, d = dark(color);
	return [
		L([[cx - w / 2, cy - h * 0.15], [cx - w * 0.28, cy - h / 2], [cx + w * 0.28, cy - h / 2], [cx + w / 2, cy - h * 0.15], [cx, cy + h / 2]], { fill: color, stroke: d, sw: OUT, join: 'round' }, true),
		L([[cx - w / 2, cy - h * 0.15], [cx + w / 2, cy - h * 0.15]], { stroke: d, sw: 1.4 }),
		L([[cx - w * 0.28, cy - h / 2], [cx - w * 0.16, cy - h * 0.15], [cx, cy + h / 2]], { stroke: d, sw: 1.4 }),
		L([[cx + w * 0.28, cy - h / 2], [cx + w * 0.16, cy - h * 0.15], [cx, cy + h / 2]], { stroke: d, sw: 1.4 }),
		L([[cx - w * 0.16, cy - h * 0.15], [cx + w * 0.16, cy - h * 0.15]], { stroke: light(color), sw: 1.4 }),
	];
}

/** Pickaxe: wooden handle and a curved steel head, diagonal. */
export function pickaxe(cx, cy, length, angle = -40) {
	const k = length / 56;
	return [G([
		R(-3, -22, 6, 48, 2, { fill: '#8d6e63', stroke: dark('#8d6e63'), sw: OUT / k }),
		P('M-24 -14C-12 -26 12 -26 24 -14L20 -11C10 -19 -10 -19 -20 -11Z', { fill: '#90a4ae', stroke: dark('#90a4ae'), sw: OUT / k, join: 'round' }),
		R(-4, -20, 8, 7, 1.5, { fill: '#546e7a' }),
	], { transform: `${T.translate(cx, cy)} ${T.rotate(angle)} ${T.scale(k)}` })];
}

/** Star (five points). */
export const star5 = (cx, cy, r, color = GOLD) => L(starPts(cx, cy, 5, r, r * 0.45), { fill: color, stroke: dark(color), sw: OUT, join: 'round' }, true);

/** Simple planet with a ring. */
export function planet(cx, cy, r, color = '#ab47bc', ringColor = '#ffca28') {
	return [
		E(cx, cy, r * 1.7, r * 0.45, -20, { fill: 'none', stroke: ringColor, sw: r * 0.22 }),
		C(cx, cy, r, { fill: color, stroke: dark(color), sw: OUT }),
		C(cx - r * 0.3, cy - r * 0.3, r * 0.3, { fill: light(color), fo: 0.7 }),
		C(cx + r * 0.35, cy + r * 0.2, r * 0.18, { fill: dark(color), fo: 0.5 }),
		G([P(arcD(0, 0, r * 1.7, 15, 165), { fill: 'none', stroke: ringColor, sw: r * 0.22 })], { transform: `${T.translate(cx, cy)} ${T.rotate(-20)} ${T.scale(1, 0.265)}` }),
	];
}

/** Rocket pointing up-right. */
export function rocket(cx, cy, h, color = '#eceff1', accent = '#ef5350', angle = -45) {
	const k = h / 48;
	return [G([
		L([[-5, 14], [-12, 22], [-7, 22]], { fill: accent, stroke: dark(accent), sw: OUT / k, join: 'round' }, true),
		L([[5, 14], [12, 22], [7, 22]], { fill: accent, stroke: dark(accent), sw: OUT / k, join: 'round' }, true),
		P('M0 -24C8 -12 8 6 6 18H-6C-8 6 -8 -12 0 -24Z', { fill: color, stroke: dark('#b0bec5'), sw: OUT / k, join: 'round' }),
		P('M0 -24C4 -18 5 -14 5.5 -10H-5.5C-5 -14 -4 -18 0 -24Z', { fill: accent }),
		C(0, 0, 3.6, { fill: '#81d4fa', stroke: dark('#81d4fa'), sw: 1.4 / k }),
		L([[-4, 19], [4, 19], [0, 30]], { fill: '#ffb300' }, true),
		L([[-2, 19], [2, 19], [0, 25]], { fill: '#fff176' }, true),
	], { transform: `${T.translate(cx, cy)} ${T.rotate(angle)} ${T.scale(k)}` })];
}

/** Warning triangle with a mark. */
export function warning(cx, cy, size, color = '#ffca28') {
	return [
		L([[cx, cy - size / 2], [cx + size / 2, cy + size * 0.42], [cx - size / 2, cy + size * 0.42]], { fill: color, stroke: dark(color), sw: OUT, join: 'round' }, true),
		R(cx - size * 0.05, cy - size * 0.16, size * 0.1, size * 0.34, 1, { fill: INK }), C(cx, cy + size * 0.3, size * 0.06, { fill: INK }),
	];
}

/** Gear. */
export function gear(cx, cy, r, color = '#90a4ae', teeth = 8) {
	const shape = diff(union(circle(cx, cy, r * 0.78), ...Array.from({ length: teeth }, (_, i) => {
		const a = (i / teeth) * 360;
		return rotate(rect(cx - r * 0.18, cy - r, r * 0.36, r * 0.45, r * 0.08), a, cx, cy);
	})), circle(cx, cy, r * 0.3));
	return [S(shape, { fill: color, stroke: dark(color), sw: OUT, join: 'round' })];
}
import { rotate } from './lib.mjs';

/** Robot head. */
export function robotHead(cx, cy, w, color = '#90caf9') {
	const h = w * 0.9, x = cx - w / 2, y = cy - h / 2, d = dark(color);
	return [
		Ln(cx, y, cx, y - h * 0.18, { stroke: d, sw: 2.4 }), C(cx, y - h * 0.22, w * 0.07, { fill: '#ef5350', stroke: d, sw: 1.4 }),
		R(x - w * 0.1, cy - h * 0.15, w * 0.1, h * 0.3, 1, { fill: d }), R(x + w, cy - h * 0.15, w * 0.1, h * 0.3, 1, { fill: d }),
		R(x, y, w, h, w * 0.14, { fill: color, stroke: d, sw: OUT }),
		C(cx - w * 0.22, cy - h * 0.12, w * 0.12, { fill: WHITE, stroke: d, sw: 1.6 }), C(cx + w * 0.22, cy - h * 0.12, w * 0.12, { fill: WHITE, stroke: d, sw: 1.6 }),
		C(cx - w * 0.22, cy - h * 0.12, w * 0.05, { fill: INK }), C(cx + w * 0.22, cy - h * 0.12, w * 0.05, { fill: INK }),
		R(cx - w * 0.25, cy + h * 0.18, w * 0.5, h * 0.14, 2, { fill: d }),
		...[0, 1, 2].map((i) => R(cx - w * 0.2 + i * w * 0.16, cy + h * 0.21, w * 0.08, h * 0.08, 0.6, { fill: light(color) })),
	];
}

/** Flat ring (torus) seen at an angle: a space station / portal. */
export function portal(cx, cy, r, color = '#7e57c2') {
	return [
		E(cx, cy, r, r * 0.55, 0, { fill: 'none', stroke: dark(color), sw: r * 0.34 + OUT }),
		E(cx, cy, r, r * 0.55, 0, { fill: 'none', stroke: color, sw: r * 0.34 }),
		E(cx, cy, r * 0.62, r * 0.3, 0, { fill: light(color), fo: 0.5 }),
	];
}
