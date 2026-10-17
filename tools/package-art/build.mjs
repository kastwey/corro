#!/usr/bin/env node
// build.mjs — render a scene into a package's assets/{tokens,cards}/<id>.svg files, plus a
// preview sheet that shows tokens on player-colour chips and on light/dark surfaces, and cards on
// their paper with the card's artColor as currentColor.
//
//   node build.mjs scenes/four-colours.mjs                 # preview only (preview/<id>.png)
//   node build.mjs scenes/four-colours.mjs --write         # also write server/Packages/<id>/assets/…
//   node build.mjs scenes/four-colours.mjs --write --out ../../server/Packages/uno
//   node build.mjs ../../../corro-hidden-packages/art/classic-virus.mjs --write
//
// The preview needs the Playwright browser the E2E suite installs (e2e/node_modules); pass
// --no-preview to skip it.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { svgFile, inner } from './draw.mjs';
import { loadScene, CANVAS } from './api.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const args = process.argv.slice(2);
if (!args[0]) {
	console.error('usage: node build.mjs <scene.mjs> [--write] [--out <packageDir>] [--no-preview]');
	process.exit(2);
}
const scene = await loadScene(resolve(args[0]));
const write = args.includes('--write');
const preview = !args.includes('--no-preview');
const outIdx = args.indexOf('--out');
const packageDir = outIdx >= 0 ? resolve(args[outIdx + 1]) : join(repoRoot, 'server', 'Packages', scene.id);

const artColors = {};
const cardsJson = join(packageDir, 'cards.json');
if (existsSync(cardsJson)) {
	const cards = JSON.parse(readFileSync(cardsJson, 'utf8'));
	for (const card of Array.isArray(cards) ? cards : Object.values(cards).flat()) {
		if (card && card.id && card.artColor) artColors[card.id] = card.artColor;
	}
}

const chips = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#00acc1'];
let html = `<!doctype html><meta charset="utf-8"><title>${scene.id} art preview</title><style>
body{font:12px system-ui;margin:16px;background:#fff;color:#111}
h2{margin:16px 0 6px}
.grid{display:flex;flex-wrap:wrap;gap:10px}
.cell{text-align:center;border:1px solid #ddd;padding:4px;border-radius:6px;display:flex;flex-direction:column;align-items:center}
.row{display:flex;align-items:center;gap:6px}
.chip{display:inline-flex;align-items:center;justify-content:center;border-radius:50%;color:#fff}
.chip svg{display:block}
.light{background:#f6f3ea;color:#263238;padding:4px;border-radius:6px}
.darkbg{background:#1f2430;color:#e6e6e6;padding:4px;border-radius:6px}
.paper{width:92px;height:128px;border:3px solid var(--acc);border-radius:10px;background:#fffdf5;display:flex;flex-direction:column;box-sizing:border-box;padding:7px 6px 5px}
.pic{flex:1;display:flex;align-items:center;justify-content:center;background:var(--soft);border-radius:6px 6px 3px 3px;color:var(--acc)}
.pic svg{width:64px;height:64px;overflow:visible}
.big{width:192px;height:192px;background:#eef0f4;color:var(--acc);border-radius:6px}
.cell span{display:block;margin-top:3px;font-size:11px}
</style><body>`;

let written = 0;
const sizes = [];
for (const [kind, size] of Object.entries(CANVAS)) {
	const items = scene[kind];
	const ids = Object.keys(items);
	if (!ids.length) continue;
	html += `<h2>${scene.id} / ${kind}</h2><div class="grid">`;
	ids.forEach((id, i) => {
		const markup = inner(items[id]);
		sizes.push([`${kind}/${id}`, markup.length]);
		const svg = (px, extra = '') => `<svg viewBox="0 0 ${size} ${size}" fill="currentColor"${px ? ` width="${px}" height="${px}"` : ''}${extra}>${markup}</svg>`;
		if (kind === 'tokens') {
			const chip = chips[i % chips.length];
			html += `<div class="cell"><div class="row">`
				+ `<span class="chip" style="background:${chip};width:20px;height:20px">${svg(13)}</span>`
				+ `<span class="chip" style="background:${chip};width:40px;height:40px">${svg(26)}</span>`
				+ `<span class="light">${svg(24)}</span><span class="darkbg">${svg(24)}</span>`
				+ `<span class="light">${svg(64)}</span><span class="darkbg">${svg(64)}</span>`
				+ `</div><span>${id}</span></div>`;
		} else {
			const acc = artColors[id] ?? '#546e7a';
			html += `<div class="cell" style="--acc:${acc};--soft:color-mix(in srgb, ${acc} 18%, #fffdf5)"><div class="row">`
				+ `<div class="paper"><div class="pic">${svg()}</div></div><div class="big">${svg(192)}</div>`
				+ `</div><span>${id}</span></div>`;
		}
		if (write) {
			const dir = join(packageDir, 'assets', kind);
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, `${id}.svg`), svgFile(items[id], size));
			written++;
		}
	});
	html += '</div>';
}

const previewDir = join(here, 'preview');
mkdirSync(previewDir, { recursive: true });
const page = join(previewDir, `${scene.id}.html`);
writeFileSync(page, html);
if (preview) {
	const { chromium } = await import(join(repoRoot, 'e2e', 'node_modules', 'playwright', 'index.mjs'));
	const browser = await chromium.launch();
	const tab = await browser.newPage({ viewport: { width: 1250, height: 800 } });
	await tab.goto('file://' + page);
	await tab.screenshot({ path: join(previewDir, `${scene.id}.png`), fullPage: true });
	await browser.close();
}

const largest = sizes.sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, n]) => `${id} (${n} chars)`).join(', ');
console.log(`${scene.id}: ${sizes.length} drawings, largest ${largest}`);
console.log(preview ? `preview: ${join(previewDir, `${scene.id}.png`)}` : `preview page: ${page}`);
if (write) console.log(`wrote ${written} files under ${packageDir}/assets`);
