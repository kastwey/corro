// draw.mjs — element-level drawing API that emits the engine's SVG art subset in colour.
//
// A drawing is an array of elements. Each helper returns one element (or a group); `svgFile`
// serialises them. Geometry helpers from lib.mjs (booleans on MultiPolygons) plug in via `S()`.
import { toPath, spline, arcPoints, deg } from './lib.mjs';

const fmt = (v, p = 2) => {
	const s = Number(v).toFixed(p);
	return s.replace(/\.?0+$/, '').replace(/^-0$/, '0') || '0';
};

function attrs(o, defaults = {}) {
	const map = {
		fill: 'fill', stroke: 'stroke', sw: 'stroke-width', cap: 'stroke-linecap', join: 'stroke-linejoin',
		opacity: 'opacity', fo: 'fill-opacity', so: 'stroke-opacity', dash: 'stroke-dasharray', rule: 'fill-rule',
		transform: 'transform',
	};
	const merged = { ...defaults, ...o };
	let out = '';
	for (const [k, v] of Object.entries(merged)) {
		if (v === undefined || v === null || !(k in map)) continue;
		out += ` ${map[k]}="${v}"`;
	}
	return out;
}

/** Circle. */
export const C = (cx, cy, r, o = {}) => ({ tag: 'circle', a: ` cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}"` + attrs(o) });
/** Ellipse (rot in degrees about its centre). */
export const E = (cx, cy, rx, ry, rot = 0, o = {}) => ({
	tag: 'ellipse',
	a: ` cx="${fmt(cx)}" cy="${fmt(cy)}" rx="${fmt(rx)}" ry="${fmt(ry)}"` + attrs(rot ? { ...o, transform: `rotate(${fmt(rot)} ${fmt(cx)} ${fmt(cy)})${o.transform ? ' ' + o.transform : ''}` } : o),
});
/** Rectangle with optional corner radius. */
export const R = (x, y, w, h, r = 0, o = {}) => ({ tag: 'rect', a: ` x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}"` + (r ? ` rx="${fmt(r)}"` : '') + attrs(o) });
/** Raw path data (write arcs and curves by hand). */
export const P = (d, o = {}) => ({ tag: 'path', a: ` d="${d.replace(/\s+/g, ' ').trim()}"` + attrs(o) });
/** Straight line. */
export const Ln = (x1, y1, x2, y2, o = {}) => ({ tag: 'line', a: ` x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}"` + attrs(o, { fill: 'none' }) });
/** Polyline / polygon from points. `closed` makes it a polygon. */
export const L = (points, o = {}, closed = false) => {
	const pts = points.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(' ');
	return { tag: closed ? 'polygon' : 'polyline', a: ` points="${pts}"` + attrs(o, closed ? {} : { fill: 'none' }) };
};
/** A boolean-built MultiPolygon (lib.mjs) as one path. */
export const S = (shape, o = {}, precision = 1) => ({ tag: 'path', a: ` d="${toPath(shape, precision)}"` + attrs(o) });
/** Group. */
export const G = (children, o = {}) => ({ tag: 'g', a: attrs(o), children: children.flat(Infinity).filter(Boolean) });

/** Smooth closed or open curve through points as a cubic path (Catmull-Rom → Bézier). */
export function curveD(points, closed = false, tension = 1) {
	const p = closed ? [points[points.length - 1], ...points, points[0], points[1]] : [points[0], ...points, points[points.length - 1]];
	let d = `M${fmt(p[1][0])} ${fmt(p[1][1])}`;
	for (let i = 1; i + 2 < p.length; i++) {
		const [p0, p1, p2, p3] = [p[i - 1], p[i], p[i + 1], p[i + 2]];
		const c1 = [p1[0] + ((p2[0] - p0[0]) / 6) * tension, p1[1] + ((p2[1] - p0[1]) / 6) * tension];
		const c2 = [p2[0] - ((p3[0] - p1[0]) / 6) * tension, p2[1] - ((p3[1] - p1[1]) / 6) * tension];
		d += `C${fmt(c1[0])} ${fmt(c1[1])} ${fmt(c2[0])} ${fmt(c2[1])} ${fmt(p2[0])} ${fmt(p2[1])}`;
	}
	return closed ? d + 'Z' : d;
}
export const Curve = (points, o = {}, closed = false, tension = 1) => P(curveD(points, closed, tension), closed ? o : { fill: 'none', ...o });

/** Circular arc path data from `fromDeg` to `toDeg` (clockwise on screen when increasing). */
export function arcD(cx, cy, r, fromDeg, toDeg) {
	const a0 = deg(fromDeg), a1 = deg(toDeg);
	const sweep = toDeg - fromDeg;
	const large = Math.abs(sweep) > 180 ? 1 : 0;
	const dir = sweep > 0 ? 1 : 0;
	return `M${fmt(cx + r * Math.cos(a0))} ${fmt(cy + r * Math.sin(a0))}A${fmt(r)} ${fmt(r)} 0 ${large} ${dir} ${fmt(cx + r * Math.cos(a1))} ${fmt(cy + r * Math.sin(a1))}`;
}
export const Arc = (cx, cy, r, fromDeg, toDeg, o = {}) => P(arcD(cx, cy, r, fromDeg, toDeg), { fill: 'none', ...o });

/** Pie sector path. */
export function sectorD(cx, cy, r, fromDeg, toDeg) {
	const a0 = deg(fromDeg), a1 = deg(toDeg);
	const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
	return `M${fmt(cx)} ${fmt(cy)}L${fmt(cx + r * Math.cos(a0))} ${fmt(cy + r * Math.sin(a0))}A${fmt(r)} ${fmt(r)} 0 ${large} 1 ${fmt(cx + r * Math.cos(a1))} ${fmt(cy + r * Math.sin(a1))}Z`;
}

/** Regular polygon / star points. */
export function starPts(cx, cy, n, rOuter, rInner, rotDeg = -90) {
	const pts = [];
	for (let i = 0; i < n * 2; i++) {
		const r = i % 2 === 0 ? rOuter : rInner;
		const a = deg(rotDeg + (i / (n * 2)) * 360);
		pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
	}
	return pts;
}
export function ngonPts(cx, cy, n, r, rotDeg = -90) {
	const pts = [];
	for (let i = 0; i < n; i++) {
		const a = deg(rotDeg + (i / n) * 360);
		pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
	}
	return pts;
}

/** Transform helpers (string builders). */
export const T = {
	rotate: (a, cx = 0, cy = 0) => `rotate(${fmt(a)} ${fmt(cx)} ${fmt(cy)})`,
	translate: (x, y = 0) => `translate(${fmt(x)} ${fmt(y)})`,
	scale: (s, t = s) => `scale(${fmt(s, 4)} ${fmt(t, 4)})`,
	/** Fit a drawing designed on a `size`-wide box centred at origin into the box (x, y, w, h). */
	fitCentred: (size, x, y, w, h) => {
		const s = Math.min(w, h) / size;
		return `translate(${fmt(x + w / 2)} ${fmt(y + h / 2)}) scale(${fmt(s, 4)})`;
	},
};

function serialise(el) {
	if (el.tag === 'g') return `<g${el.a}>${el.children.map(serialise).join('')}</g>`;
	return `<${el.tag}${el.a}/>`;
}

/** Full SVG file text for a drawing (array of elements, nested arrays allowed). */
export function svgFile(drawing, size) {
	const body = drawing.flat(Infinity).filter(Boolean).map(serialise).join('\n  ');
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">\n  ${body}\n</svg>\n`;
}

/** Inner markup only (for previews). */
export function inner(drawing) {
	return drawing.flat(Infinity).filter(Boolean).map(serialise).join('');
}

// ---- colour helpers ----
export function hex(h) { return h; }
/** Darken/lighten a hex colour by a factor (0.8 darker, 1.2 lighter). */
export function shade(h, f) {
	const n = parseInt(h.slice(1), 16);
	const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(f >= 1 ? v + (255 - v) * (f - 1) : v * f))));
	return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}
export const dark = (h) => shade(h, 0.62);
export const light = (h) => shade(h, 1.45);

/** Standard outlined flat style: fill + darker outline. */
export const flat = (color, sw = 2, extra = {}) => ({ fill: color, stroke: dark(color), sw, join: 'round', ...extra });
