// Every public scene must build and emit only the engine's SVG art subset, for every card and
// token its package declares. The grammar here mirrors SvgArtSanitizer (server) and svgArt.ts
// (client); a drawing that fails it would reject the package at load time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScene } from '../api.mjs';
import { svgFile } from '../draw.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const scenesDir = join(here, '..', 'scenes');
const packagesDir = resolve(here, '..', '..', '..', 'server', 'Packages');

const ELEMENTS = new Set(['g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const ATTRIBUTES = new Set([
	'd', 'x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r', 'x1', 'y1', 'x2', 'y2', 'points',
	'fill', 'fill-rule', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
	'stroke-miterlimit', 'stroke-opacity', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'transform',
]);
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const COLOR = /^(?:#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|none|currentColor)$/;
const TRANSFORM = /^(?:(?:matrix|translate|scale|rotate|skewX|skewY)\([+\-0-9.eE\s]+\)\s*)+$/;

function checkMarkup(markup, label) {
	const tags = markup.match(/<[^>]+>/g) ?? [];
	assert.ok(tags.length > 0, `${label} draws nothing`);
	for (const tag of tags) {
		if (tag.startsWith('</')) { assert.equal(tag, '</g>', `${label}: ${tag}`); continue; }
		const name = /^<([a-z]+)/.exec(tag)?.[1];
		assert.ok(ELEMENTS.has(name), `${label}: element ${tag}`);
		for (const [, attr, value] of tag.matchAll(/\s([a-z-]+[0-9]?)="([^"]*)"/g)) {
			assert.ok(ATTRIBUTES.has(attr), `${label}: attribute ${attr}`);
			if (attr === 'fill' || attr === 'stroke') assert.match(value, COLOR, `${label}: ${attr}="${value}"`);
			else if (attr === 'transform') assert.match(value, TRANSFORM, `${label}: transform="${value}"`);
			else if (attr === 'd') assert.match(value, /^[MmZzLlHhVvCcSsQqTtAa0-9.,+\-eE\s]+$/, `${label}: d`);
			else if (attr === 'points') assert.match(value, /^[0-9.,+\-eE\s]+$/, `${label}: points`);
			else if (!['fill-rule', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray'].includes(attr)) assert.match(value, NUMBER, `${label}: ${attr}="${value}"`);
		}
	}
	assert.ok(!/<\/?[^gpecrl]/.test(markup.replace(/<\/?(g|path|rect|circle|ellipse|line|polyline|polygon)\b/g, '')), `${label}: unexpected markup`);
}

function declaredIds(packageId) {
	const dir = join(packagesDir, packageId);
	const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
	const tokens = (manifest.tokens ?? []).map((t) => t.id);
	let cards = [];
	if (existsSync(join(dir, 'cards.json'))) {
		const json = JSON.parse(readFileSync(join(dir, 'cards.json'), 'utf8'));
		cards = (Array.isArray(json) ? json : Object.values(json).flat()).map((c) => c.id);
	}
	return { tokens, cards };
}

for (const file of readdirSync(scenesDir).filter((f) => f.endsWith('.mjs')).sort()) {
	test(`scene ${file} emits only the engine's SVG art subset`, async () => {
		const scene = await loadScene(join(scenesDir, file));
		for (const [kind, size] of [['tokens', 24], ['cards', 64]]) {
			for (const [id, drawing] of Object.entries(scene[kind])) {
				const svg = svgFile(drawing, size);
				assert.match(svg, new RegExp(`^<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">`));
				checkMarkup(svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, ''), `${scene.id}/${kind}/${id}`);
				assert.ok(svg.length < (kind === 'tokens' ? 16 : 48) * 1024, `${scene.id}/${kind}/${id} is over the engine's size limit`);
			}
		}
	});

	test(`scene ${file} covers what its package declares`, async () => {
		const scene = await loadScene(join(scenesDir, file));
		if (!existsSync(join(packagesDir, scene.id, 'manifest.json'))) return; // a hidden package not linked in this checkout
		const declared = declaredIds(scene.id);
		for (const kind of ['tokens', 'cards']) {
			const drawn = Object.keys(scene[kind]);
			if (!drawn.length) continue; // the scene leaves that kind to the package's existing files
			assert.deepEqual(drawn.sort(), [...declared[kind]].sort(), `${scene.id} ${kind}`);
		}
	});
}
