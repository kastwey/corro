// run-coverage.mjs — measure the map affected.mjs selects with.
//
// One full run with V8 coverage on, folded into .coverage/by-spec.json: for every spec, which
// client modules it actually exercised. Slower than an ordinary run (coverage instruments every
// page), which is exactly why it is its own command and not something `npm test` pays for.
//
// Re-run it after adding a spec or a module, and whenever the selection starts looking wrong.
// It is measured data, so it goes stale like any measurement — affected.mjs fails open on anything
// the map has not seen, so a stale map costs time, never coverage.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, '.coverage');

// Start clean: a spec deleted since the last measurement must not linger in the map.
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

console.log('[e2e] Measuring which modules each spec exercises. This run is slower than usual.');
const run = spawnSync('node', ['run-sharded.mjs', ...process.argv.slice(2)], {
	cwd: here,
	stdio: 'inherit',
	shell: true,
	env: { ...process.env, E2E_COVERAGE: '1' },
});

const bySpec = {};
if (existsSync(dir)) {
	for (const name of readdirSync(dir)) {
		if (!name.endsWith('.jsonl')) continue;
		for (const line of readFileSync(path.join(dir, name), 'utf8').split('\n')) {
			if (!line.trim()) continue;
			try {
				const { spec, files } = JSON.parse(line);
				(bySpec[spec] ??= new Set());
				for (const file of files) bySpec[spec].add(file);
			} catch {
				// A shard killed mid-write leaves a partial line; the rest still counts.
			}
		}
		rmSync(path.join(dir, name), { force: true });
	}
}

const entries = Object.entries(bySpec)
	.sort(([a], [b]) => a.localeCompare(b))
	.map(([spec, files]) => [spec, [...files].sort()]);

if (entries.length === 0) {
	console.error('[e2e] No coverage was recorded — the map was not written.');
	process.exit(run.status ?? 1);
}

writeFileSync(
	path.join(dir, 'by-spec.json'),
	`${JSON.stringify(Object.fromEntries(entries), null, '\t')}\n`,
	'utf8',
);

const modules = new Set(entries.flatMap(([, files]) => files));
console.log(`\n[e2e] Map written: ${entries.length} specs over ${modules.size} client modules.`);
console.log('[e2e]   e2e/.coverage/by-spec.json — used by `npm run test:affected`.');
if (run.status !== 0) {
	console.error('[e2e] The run itself had failures; the map covers whatever did run.');
}
process.exit(run.status ?? 0);
