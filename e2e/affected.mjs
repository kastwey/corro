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
		return specs.filter(spec => (map[spec] ?? []).includes(file));
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
	// One shard: a handful of files is not worth four servers, and staying serial keeps the
	// scripted-dice queue sound without any of run-sharded's machinery.
	return spawnSync('npx', ['playwright', 'test', ...list], {
		cwd: here, stdio: 'inherit', shell: true,
	}).status ?? 1;
}
