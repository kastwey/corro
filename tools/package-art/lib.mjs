// lib.mjs — a tiny vector DSL for package art.
//
// Every shape is a polygon-clipping MultiPolygon (array of polygons; polygon = [outer, ...holes]).
// Curves are flattened finely, shapes are combined with real boolean operations and the result is
// emitted as ONE path whose outer rings and holes have opposite winding, so the engine's `nonzero`
// (tokens) and `evenodd` (cards) fills draw exactly the same picture.
import pc from 'polygon-clipping';

const TAU = Math.PI * 2;
export const deg = (d) => (d * Math.PI) / 180;

// ---- primitives ----------------------------------------------------------------------------

/** Number of segments for a full circle of radius r so the chord error stays below `tol`. */
function circleSegments(r, tol = 0.025) {
	const n = Math.ceil(TAU / Math.acos(Math.max(-1, Math.min(1, 1 - tol / Math.max(r, 1e-6)))));
	return Math.max(12, Math.min(180, n));
}

export function polygon(points) {
	return [[points.map(([x, y]) => [x, y])]];
}

export function circle(cx, cy, r, segs) {
	const n = segs ?? circleSegments(r);
	const pts = [];
	for (let i = 0; i < n; i++) {
		const a = (i / n) * TAU;
		pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
	}
	return polygon(pts);
}

export function ellipse(cx, cy, rx, ry, rotDeg = 0, segs) {
	const n = segs ?? circleSegments(Math.max(rx, ry));
	const c = Math.cos(deg(rotDeg)), s = Math.sin(deg(rotDeg));
	const pts = [];
	for (let i = 0; i < n; i++) {
		const a = (i / n) * TAU;
		const x = rx * Math.cos(a), y = ry * Math.sin(a);
		pts.push([cx + x * c - y * s, cy + x * s + y * c]);
	}
	return polygon(pts);
}

/** Axis-aligned rectangle with optional corner radius (uniform or [tl, tr, br, bl]). */
export function rect(x, y, w, h, radius = 0) {
	const rr = Array.isArray(radius) ? radius : [radius, radius, radius, radius];
	const [tl, tr, br, bl] = rr.map((r) => Math.min(r, w / 2, h / 2));
	if (tl === 0 && tr === 0 && br === 0 && bl === 0) {
		return polygon([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
	}
	const pts = [];
	const corner = (cx, cy, r, from) => {
		const n = Math.max(4, Math.ceil(circleSegments(r) / 4));
		for (let i = 0; i <= n; i++) {
			const a = from + (i / n) * (Math.PI / 2);
			pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
		}
	};
	corner(x + w - tr, y + tr, tr, -Math.PI / 2);
	corner(x + w - br, y + h - br, br, 0);
	corner(x + bl, y + h - bl, bl, Math.PI / 2);
	corner(x + tl, y + tl, tl, Math.PI);
	return polygon(pts);
}

/** Regular polygon (n sides) with its first vertex at `rotDeg` (0 = pointing right; -90 = up). */
export function ngon(cx, cy, r, n, rotDeg = -90) {
	const pts = [];
	for (let i = 0; i < n; i++) {
		const a = deg(rotDeg) + (i / n) * TAU;
		pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
	}
	return polygon(pts);
}

export function star(cx, cy, points, rOuter, rInner, rotDeg = -90) {
	const pts = [];
	for (let i = 0; i < points * 2; i++) {
		const r = i % 2 === 0 ? rOuter : rInner;
		const a = deg(rotDeg) + (i / (points * 2)) * TAU;
		pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
	}
	return polygon(pts);
}

/** Pie slice / sector of a disc, from `fromDeg` to `toDeg` (clockwise on screen). */
export function sector(cx, cy, r, fromDeg, toDeg) {
	const n = Math.max(2, Math.ceil(circleSegments(r) * Math.abs(toDeg - fromDeg) / 360));
	const pts = [[cx, cy]];
	for (let i = 0; i <= n; i++) {
		const a = deg(fromDeg + ((toDeg - fromDeg) * i) / n);
		pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
	}
	return polygon(pts);
}

export function ring(cx, cy, rOuter, rInner) {
	return diff(circle(cx, cy, rOuter), circle(cx, cy, rInner));
}

// ---- strokes --------------------------------------------------------------------------------

function capsule(x1, y1, x2, y2, w) {
	const dx = x2 - x1, dy = y2 - y1;
	const len = Math.hypot(dx, dy);
	const r = w / 2;
	if (len < 1e-9) return circle(x1, y1, r);
	const nx = -dy / len, ny = dx / len;
	const n = Math.max(6, Math.ceil(circleSegments(r) / 2));
	const pts = [];
	// n is u rotated by +90°, so sweeping from -n through +u to +n caps the far end (x2, y2) and
	// sweeping from +n through -u back to -n caps the near end.
	const a0 = Math.atan2(ny, nx);
	for (let i = 0; i <= n; i++) {
		const a = a0 + Math.PI + (i / n) * Math.PI;
		pts.push([x2 + r * Math.cos(a), y2 + r * Math.sin(a)]);
	}
	for (let i = 0; i <= n; i++) {
		const a = a0 + (i / n) * Math.PI;
		pts.push([x1 + r * Math.cos(a), y1 + r * Math.sin(a)]);
	}
	return polygon(pts);
}

function buttSegment(x1, y1, x2, y2, w, extend = 0) {
	const dx = x2 - x1, dy = y2 - y1;
	const len = Math.hypot(dx, dy) || 1;
	const ux = dx / len, uy = dy / len;
	const nx = (-uy * w) / 2, ny = (ux * w) / 2;
	const ax = x1 - ux * extend, ay = y1 - uy * extend;
	const bx = x2 + ux * extend, by = y2 + uy * extend;
	return polygon([[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]]);
}

/**
 * Stroke a polyline. `cap`: 'round' | 'butt' | 'square'. Joins are always round (a disc at each
 * interior vertex), which is what a flattened curve wants. `closed` joins the last point to the first.
 */
export function stroke(points, width, { cap = 'round', closed = false } = {}) {
	const pts = closed ? [...points, points[0]] : points;
	const parts = [];
	for (let i = 0; i + 1 < pts.length; i++) {
		const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
		const isEnd = !closed && (i === 0 || i + 2 === pts.length);
		if (cap === 'round' || !isEnd) parts.push(capsule(x1, y1, x2, y2, width));
		else parts.push(buttSegment(x1, y1, x2, y2, width, cap === 'square' ? width / 2 : 0));
	}
	// Round joins at interior vertices (and all vertices when closed).
	const first = closed ? 0 : 1, last = closed ? pts.length - 1 : pts.length - 1;
	for (let i = first; i < last; i++) parts.push(circle(pts[i][0], pts[i][1], width / 2));
	return union(...parts);
}

export function line(x1, y1, x2, y2, width, cap = 'round') {
	return stroke([[x1, y1], [x2, y2]], width, { cap });
}

/** Sample a cubic bezier into points. */
export function bezier(p0, p1, p2, p3, n = 24) {
	const pts = [];
	for (let i = 0; i <= n; i++) {
		const t = i / n, u = 1 - t;
		pts.push([
			u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
			u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
		]);
	}
	return pts;
}

/** Sample a quadratic bezier into points. */
export function quad(p0, p1, p2, n = 20) {
	const pts = [];
	for (let i = 0; i <= n; i++) {
		const t = i / n, u = 1 - t;
		pts.push([
			u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
			u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
		]);
	}
	return pts;
}

/** Points along a circular arc (degrees, clockwise on screen when to > from). */
export function arcPoints(cx, cy, r, fromDeg, toDeg, n) {
	const steps = n ?? Math.max(4, Math.ceil(circleSegments(r) * Math.abs(toDeg - fromDeg) / 360));
	const pts = [];
	for (let i = 0; i <= steps; i++) {
		const a = deg(fromDeg + ((toDeg - fromDeg) * i) / steps);
		pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
	}
	return pts;
}

/** Stroked circular arc. */
export function arc(cx, cy, r, fromDeg, toDeg, width, cap = 'round') {
	return stroke(arcPoints(cx, cy, r, fromDeg, toDeg), width, { cap });
}

/** Catmull-Rom spline through points (smooth freehand curves), sampled. */
export function spline(points, segs = 10, closed = false) {
	const p = closed ? [points[points.length - 1], ...points, points[0], points[1]] : [points[0], ...points, points[points.length - 1]];
	const out = [];
	for (let i = 1; i + 2 < p.length; i++) {
		const [p0, p1, p2, p3] = [p[i - 1], p[i], p[i + 1], p[i + 2]];
		for (let j = 0; j < segs; j++) {
			const t = j / segs, t2 = t * t, t3 = t2 * t;
			out.push([
				0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
				0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
			]);
		}
	}
	if (!closed) out.push(p[p.length - 2]);
	return out;
}

/** A filled blob through control points (closed smooth spline). */
export function blob(points, segs = 10) {
	return polygon(spline(points, segs, true));
}

// ---- booleans & transforms -------------------------------------------------------------------

// polygon-clipping's sweep line is not robust against near-coincident floating-point vertices, so
// every operand is snapped to a fine grid first (far below our output precision) and a failing
// operation is retried on a slightly coarser grid.
const snap = (shape, g) => shape.map((poly) => poly.map((ring) => ring.map(([x, y]) => [Math.round(x / g) * g, Math.round(y / g) * g])));
function robust(op, shapes) {
	const inputs = shapes.filter((s) => s && s.length);
	if (!inputs.length) return [];
	for (const g of [1e-4, 1e-3, 3e-3, 1e-2]) {
		try { return op(...inputs.map((s) => snap(s, g))); } catch (e) { if (g === 1e-2) throw e; }
	}
}
export const union = (...shapes) => robust(pc.union, shapes);
export const diff = (a, ...b) => (b.some((s) => s && s.length) ? robust(pc.difference, [a, ...b]) : a);
export const inter = (a, ...b) => robust(pc.intersection, [a, ...b]);
export const xor = (a, ...b) => robust(pc.xor, [a, ...b]);

export function transform(shape, fn) {
	return shape.map((poly) => poly.map((ring) => ring.map(([x, y]) => fn(x, y))));
}
export const translate = (shape, dx, dy) => transform(shape, (x, y) => [x + dx, y + dy]);
export const scale = (shape, sx, sy = sx, ox = 0, oy = 0) => transform(shape, (x, y) => [ox + (x - ox) * sx, oy + (y - oy) * sy]);
export function rotate(shape, angleDeg, ox = 0, oy = 0) {
	const c = Math.cos(deg(angleDeg)), s = Math.sin(deg(angleDeg));
	return transform(shape, (x, y) => [ox + (x - ox) * c - (y - oy) * s, oy + (x - ox) * s + (y - oy) * c]);
}
export const mirrorX = (shape, axis) => transform(shape, (x, y) => [2 * axis - x, y]);
export const mirrorY = (shape, axis) => transform(shape, (x, y) => [x, 2 * axis - y]);

export function bounds(shape) {
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const poly of shape) for (const ring of poly) for (const [x, y] of ring) {
		if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
	}
	return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

/** Scale + translate a shape so it fits in a box, centred, keeping aspect. */
export function fit(shape, x, y, w, h) {
	const b = bounds(shape);
	const s = Math.min(w / b.width, h / b.height);
	return translate(scale(shape, s, s, b.cx, b.cy), x + w / 2 - b.cx, y + h / 2 - b.cy);
}

/** Centre a shape on (cx, cy). */
export function centre(shape, cx, cy) {
	const b = bounds(shape);
	return translate(shape, cx - b.cx, cy - b.cy);
}

/**
 * Approximate outline offset: grow (d > 0) or shrink (d < 0) a shape by unioning / subtracting
 * discs along its edges. Used to cut a clean gap around a shape laid on top of another.
 */
export function offset(shape, d) {
	if (d === 0) return shape;
	const r = Math.abs(d);
	const parts = [];
	for (const poly of shape) for (const ring of poly) {
		// Decimate the ring first: a flattened curve has far more vertices than the band needs.
		const thin = [];
		for (const p of ring) {
			const last = thin[thin.length - 1];
			if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= r * 0.6) thin.push(p);
		}
		if (thin.length >= 3) parts.push(stroke(thin, r * 2, { closed: true }));
	}
	const band = union(...parts);
	return d > 0 ? union(shape, band) : diff(shape, band);
}

/** Lay `top` over `base` with a `gap`-wide clear outline between them. */
export function over(base, top, gap = 1.5) {
	return union(diff(base, offset(top, gap)), top);
}

// ---- emit ------------------------------------------------------------------------------------

function fmt(v, precision) {
	const s = v.toFixed(precision);
	return s.replace(/\.?0+$/, '').replace(/^-0$/, '0') || '0';
}

/** Drop collinear and near-duplicate vertices. */
function simplifyRing(ring, eps) {
	const out = [];
	for (const p of ring) {
		const last = out[out.length - 1];
		if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < eps) continue;
		out.push(p);
	}
	if (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < eps) out.pop();
	// Remove points collinear with neighbours.
	const res = [];
	for (let i = 0; i < out.length; i++) {
		const a = out[(i + out.length - 1) % out.length], b = out[i], c = out[(i + 1) % out.length];
		const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
		if (Math.abs(cross) < eps * eps * 0.5) continue;
		res.push(b);
	}
	return res.length >= 3 ? res : out;
}

function ringArea(ring) {
	let a = 0;
	for (let i = 0; i < ring.length; i++) {
		const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
		a += x1 * y2 - x2 * y1;
	}
	return a / 2;
}

/** Emit a MultiPolygon as compact SVG path data (outers one winding, holes the other). */
export function toPath(shape, precision = 1, minArea = 0.02) {
	const eps = Math.pow(10, -precision) * 0.6;
	const chunks = [];
	for (const poly of shape) {
		for (let k = 0; k < poly.length; k++) {
			const ring = simplifyRing(poly[k], eps);
			if (ring.length < 3 || Math.abs(ringArea(ring)) < minArea) continue;
			// Normalise winding: outer rings clockwise on screen (positive area in y-down coords), holes the opposite.
			const area = ringArea(ring);
			const ordered = (k === 0) === (area > 0) ? ring : [...ring].reverse();
			let d = 'M' + fmt(ordered[0][0], precision) + ' ' + fmt(ordered[0][1], precision);
			for (let i = 1; i < ordered.length; i++) d += 'L' + fmt(ordered[i][0], precision) + ' ' + fmt(ordered[i][1], precision);
			chunks.push(d + 'Z');
		}
	}
	return chunks.join('');
}

export function svg(shape, size, precision) {
	const p = precision ?? (size <= 24 ? 2 : 1);
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><path d="${toPath(shape, p)}"/></svg>\n`;
}
