// affected.mjs — run only the specs that could possibly care about what changed.
//
// The map from source file to spec is MEASURED, never written: `npm run test:map` records which
// client modules each spec actually exercises (helpers/coverage.ts) and leaves the answer in
// .coverage/by-spec.json. A hand-kept map would answer this question wrongly, in silence, the first
// time somebody added a module and forgot to update it.
//
// This is a tool for the inner loop, NOT a gate. The pre-push hook and CI still run everything,
// because the day this narrows too far is the day an accessibility regression ships — so every
// rule below fails OPEN: anything it cannot account for means "run the whole suite", and it says
// so rather than quietly running less.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const MAP_FILE = path.join(here, '.coverage', 'by-spec.json');

// ── The one judgement call in here ───────────────────────────────────────────────────────────
//
// Everything else in this file is measured. This is not, and it is the only place that can make
// the selection WRONG rather than merely slow, so it is written out where it can be argued with.
//
// The measured map is honest that 38 of 39 specs exercise the lobby: every scenario creates its
// game through it. But a game spec does not TEST the lobby — it passes through it to reach a
// board. What it genuinely depends on is the handoff: that the game comes out configured the way
// it asked for. So for a change to the pre-game surface ALONE, the selection is narrowed to the
// specs whose subject that surface is, plus one spec per way a game can be set up from it.
//
// That last part is not decoration. When the game picker became a combobox, the spec it broke was
// race.spec — "a taken colour says who holds it" — and not one lobby spec: staging repainted the
// seat list and wiped the seat the test had chosen. Every shape below is here because something
// like that can happen to it, and race is in the list because it is the ONLY spec that picks a
// seat at all.
//
// Rot in these lists is safe by construction: a lobby module nobody added here keeps the measured
// selection, which is the whole suite. Forgetting costs time, never coverage.

/** Modules whose only role is the surface BEFORE a game starts. */
const LOBBY_SURFACE = [
	/^frontend\/src\/lobby\//,
	/^frontend\/src\/comboBox\.ts$/,
	/^frontend\/src\/languageSelector\.ts$/,
	/^frontend\/src\/siteMetrics\.ts$/,
	/^frontend\/src\/siteBranding\.ts$/,
	/^frontend\/src\/privacy(Notice|Page|PageEntry)\.ts$/,
	/^frontend\/src\/tableView\.ts$/,
	/^frontend\/src\/unlockCodes\.ts$/,
];

/** Specs whose SUBJECT is that surface. */
const LOBBY_SUBJECT = [
	'tests/lobby-accessibility.spec.ts',
	'tests/lobby-localization.spec.ts',
	'tests/table.spec.ts',
	'tests/privacy.spec.ts',
	'tests/account.spec.ts',
	'tests/axe-monitor.spec.ts',
];

/**
 * One spec per way a game can be SET UP from the lobby, so a broken handoff is still caught:
 * seats (race is the only spec that picks one), teams and content deck (forbidden does both),
 * house rules (shedding), and a plain create-and-join (trade).
 */
const HANDOFF_REPRESENTATIVES = [
	'tests/race.spec.ts',
	'tests/forbidden.spec.ts',
	'tests/shedding.spec.ts',
	'tests/trade.spec.ts',
];

const LOBBY_SELECTION = new Set([...LOBBY_SUBJECT, ...HANDOFF_REPRESENTATIVES]);

/** Everything the working tree changed against a base (default: what is not yet on main). */
function changedFiles(base) {
	const run = args => spawnSync('git', args, { cwd: repo, encoding: 'utf8' }).stdout ?? '';
	const committed = run(['diff', '--name-only', `${base}...HEAD`]);
	const working = run(['diff', '--name-only', 'HEAD']);
	const untracked = run(['ls-files', '--others', '--exclude-standard']);
	return [...new Set(`${committed}\n${working}\n${untracked}`.split('\n').map(l => l.trim()).filter(Boolean))];
}

function allSpecs() {
	return readdirSync(path.join(here, 'tests'))
		.filter(name => name.endsWith('.spec.ts'))
		.map(name => `tests/${name}`)
		.sort();
}

/** spec → the source files it exercised, as recorded by the last measured run. */
function loadMap() {
	if (!existsSync(MAP_FILE)) return null;
	try {
		const parsed = JSON.parse(readFileSync(MAP_FILE, 'utf8'));
		return parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0 ? parsed : null;
	} catch {
		return null;
	}
}

/**
 * Decide what a single changed file implies. Returns either a list of specs, or the string 'all'
 * — which is also the answer to everything this does not recognise.
 */
function specsFor(file, map, specs) {
	// A spec is its own reason to run.
	if (file.startsWith('e2e/tests/') && file.endsWith('.spec.ts')) return [file.slice('e2e/'.length)];
	// The harness itself: helpers, config, runners. Everything depends on these.
	if (file.startsWith('e2e/')) return 'all';

	// Prose changes nothing that runs.
	if (file.startsWith('docs/') || (file.endsWith('.md') && !file.startsWith('server/Packages/'))) return [];

	// A package is DATA every scenario using it reads — its board, its words, its names. Coverage
	// cannot see it, so it is matched by the specs that name the package.
	const pkg = /^server\/Packages\/([^/]+)\//.exec(file);
	if (pkg) {
		const named = specs.filter(spec =>
			readFileSync(path.join(here, spec), 'utf8').includes(pkg[1]));
		return named.length > 0 ? named : 'all';
	}

	// The server is shared by every scenario, and nothing here measures it.
	if (file.startsWith('server/')) return 'all';

	// Client code: the measured map answers, and only for a file it has actually seen. A module
	// nobody exercised — brand new, or only ever imported — is not "affects nothing"; it is
	// "unknown", which means everything.
	if (file.startsWith('frontend/')) {
		const known = Object.values(map).some(files => files.includes(file));
		if (!known) return 'all';
		const measured = specs.filter(spec => (map[spec] ?? []).includes(file));
		// Narrowing only ever REMOVES, so a file whose measured selection is already small keeps
		// it: a change to privacyPage.ts still means privacy.spec, not the whole lobby set.
		return LOBBY_SURFACE.some(pattern => pattern.test(file))
			? measured.filter(spec => LOBBY_SELECTION.has(spec))
			: measured;
	}

	return 'all';
}

const base = process.argv[2] ?? 'origin/main';
const specs = allSpecs();
const map = loadMap();

if (!map) {
	console.log('[e2e] No coverage map yet — run `npm run test:map` once. Running everything.');
	process.exit(runAll());
}

// A spec the map has never seen is the ONE way staleness can narrow instead of widen. Everything
// else fails open on its own: an unmeasured module is unknown and means "everything". But a new
// SPEC is different — it sits on disk, gets filtered against a map entry it has no line in, and is
// silently never selected. Someone adds a spec today, changes a module it covers next week, and it
// does not run.
//
// So the map is checked against the directory rather than trusted. Nothing here is documentation
// somebody has to remember: forgetting to re-measure costs a full run, which is exactly the cost
// it should have.
const unmapped = specs.filter(spec => !(spec in map));
if (unmapped.length > 0) {
	console.log(`[e2e] ${unmapped.length} spec(s) are newer than the coverage map:`);
	for (const spec of unmapped) console.log(`[e2e]   ${spec}`);
	console.log('[e2e] Running everything. `npm run test:map` teaches the map about them.');
	process.exit(runAll());
}

const changed = changedFiles(base);
if (changed.length === 0) {
	console.log(`[e2e] Nothing changed against ${base}.`);
	process.exit(0);
}

const selected = new Set();
const reasons = [];
for (const file of changed) {
	const implied = specsFor(file, map, specs);
	if (implied === 'all') {
		console.log(`[e2e] ${file} is not something the map can account for — running everything.`);
		process.exit(runAll());
	}
	for (const spec of implied) {
		if (!selected.has(spec)) reasons.push(`${spec}  ← ${file}`);
		selected.add(spec);
	}
}

if (selected.size === 0) {
	console.log(`[e2e] ${changed.length} changed file(s), none of which any spec exercises. Nothing to run.`);
	process.exit(0);
}

console.log(`[e2e] ${selected.size} of ${specs.length} specs could care about these changes:`);
for (const reason of reasons) console.log(`[e2e]   ${reason}`);
console.log('[e2e] This is the inner loop, not the gate — the push still runs everything.');
process.exit(runSelected([...selected].sort()));

function runAll() {
	return spawnSync('node', ['run-sharded.mjs'], { cwd: here, stdio: 'inherit', shell: true }).status ?? 1;
}

function runSelected(list) {
	// Through the sharded runner, same as a full run. Measured: ten specs take 118s in one process
	// and 61s across four — the selection was leaving half its own saving on the table. One shard
	// per couple of specs, capped at four, because a lone spec is not worth four servers.
	const shards = Math.min(4, Math.max(1, Math.ceil(list.length / 2)));
	return spawnSync('node', ['run-sharded.mjs', String(shards), ...list], {
		cwd: here, stdio: 'inherit', shell: true,
	}).status ?? 1;
}
