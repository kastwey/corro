// run-sharded.mjs — the whole E2E suite, several servers at a time.
//
// The suite is serial for one reason: the scripted dice queue lives in the SERVER process and is
// shared by every game in it, so two tests rolling at once eat each other's script. That is a
// property of one server, not of the suite — so instead of making the queue safe to share, this
// gives each slice of the work its OWN server on its own port. Every shard stays exactly as
// deterministic as the serial run it replaces: one worker, files in order, its own dice queue,
// its own in-memory persistence.
//
// The build happens ONCE here, before any shard starts. Four `dotnet run`s left to build
// themselves would race four `npm run build`s into the same frontend/dist and four MSBuilds into
// the same obj/, and the client under test would be whatever survived; E2E_PREBUILT tells the
// Playwright config to launch with --no-build instead.

import { spawn, spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE_PORT = Number(process.env.E2E_PORT ?? 5599);
const DURATIONS_DIR = path.join(here, '.durations');
const DURATIONS_FILE = path.join(DURATIONS_DIR, 'by-file.json');

/**
 * How many servers to run at once — chosen for STABILITY, not for the best stopwatch reading.
 *
 * Measured on a 16-core machine: serial 6.3 min, 4 shards 3.6, 6 shards 2.8, 8 shards 2.9. The
 * curve turns over because the work is CPU-bound — Chromium plus the Axe scan on every settled
 * DOM state — not because of the servers, which listen in under two seconds.
 *
 * Six was the fastest and is NOT the default: at that level the machine saturates and tests start
 * losing races they win every time on their own — an announcement that never arrives inside the
 * window, a dialog that paints too late, a navigation that has not settled. Widening the deadlines
 * moved those failures around rather than removing them. A flaky accessibility gate is worth less
 * than a slow one, so the default leaves a core per shard spare; `npm test 6` is there for anyone
 * who wants the last 40 seconds and will read a red shard sceptically.
 */
function defaultShards() {
	return Math.max(1, Math.min(4, Math.round(cpus().length / 4)));
}

const shardCount = Number(process.env.E2E_SHARDS ?? process.argv[2] ?? defaultShards());
if (!Number.isInteger(shardCount) || shardCount < 1) {
	console.error(`[e2e] Invalid shard count: ${process.argv[2] ?? process.env.E2E_SHARDS}`);
	process.exit(2);
}

// Everything after the shard count is handed to every shard (e.g. --grep, --headed).
const passthrough = process.argv.slice(3).filter(arg => arg !== String(shardCount));

if (shardCount === 1) {
	console.log('[e2e] One shard: running the suite directly.');
	const single = spawnSync('npx', ['playwright', 'test', ...passthrough], {
		cwd: here, stdio: 'inherit', shell: true,
	});
	recordDurations();
	process.exit(single.status ?? 1);
}

console.log(`[e2e] Building once for ${shardCount} shards…`);
const build = spawnSync(
	'dotnet',
	['build', '../server/CorroServer.csproj', '--nologo'],
	{ cwd: here, stdio: 'inherit', shell: true },
);
if (build.status !== 0) {
	console.error('[e2e] Build failed — not starting any shard.');
	process.exit(build.status ?? 1);
}

// ── Balancing ────────────────────────────────────────────────────────────────────────────────
//
// `--shard` splits by test COUNT, and these files are nowhere near equal: a lobby check is under
// a second, a full property game with two browsers is half a minute. Counting them evenly left
// one shard running long after the rest had finished, and the slowest shard IS the wall clock.
// So each run records how long every file took, and the next one packs the slices by time.

/** Every spec file in the suite, as Playwright would address it. */
function allSpecFiles() {
	return readdirSync(path.join(here, 'tests'))
		.filter(name => name.endsWith('.spec.ts'))
		.map(name => `tests/${name}`)
		.sort();
}

/** Per-file seconds from previous runs, or null when nothing has been recorded yet. */
function recordedDurations() {
	if (!existsSync(DURATIONS_FILE)) return null;
	try {
		const parsed = JSON.parse(readFileSync(DURATIONS_FILE, 'utf8'));
		return parsed && typeof parsed === 'object' ? parsed : null;
	} catch {
		// A half-written ledger is not worth a failed test run: fall back to plain sharding.
		return null;
	}
}

/**
 * Greedy longest-processing-time bin packing: hand the heaviest file to whichever shard is
 * currently lightest. Simple, and for a set like this it lands within a few per cent of optimal.
 */
function balancedSlices(files, durations, count) {
	const known = Object.values(durations).filter(value => typeof value === 'number' && value > 0);
	if (known.length === 0) return null;
	// A file nobody has measured yet (somebody just added it) is assumed average rather than free,
	// so a new heavy spec cannot quietly pile onto an already-full shard.
	const average = known.reduce((sum, value) => sum + value, 0) / known.length;
	const weighted = files
		.map(file => ({ file, weight: durations[file] ?? average }))
		.sort((a, b) => b.weight - a.weight);

	const slices = Array.from({ length: count }, () => ({ files: [], total: 0 }));
	for (const { file, weight } of weighted) {
		const lightest = slices.reduce((min, slice) => (slice.total < min.total ? slice : min));
		lightest.files.push(file);
		lightest.total += weight;
	}
	// A shard with no files at all would still pay for a server it never uses.
	return slices.every(slice => slice.files.length > 0) ? slices : null;
}

/** Sum every test's duration per file out of the shards' JSON reports, and keep it for next time. */
function recordDurations() {
	if (!existsSync(DURATIONS_DIR)) return;
	const totals = { ...(recordedDurations() ?? {}) };
	let sawAnything = false;
	for (const name of readdirSync(DURATIONS_DIR)) {
		if (!name.startsWith('run') || !name.endsWith('.json')) continue;
		const runPath = path.join(DURATIONS_DIR, name);
		try {
			const report = JSON.parse(readFileSync(runPath, 'utf8'));
			for (const [file, seconds] of Object.entries(durationsFromReport(report))) {
				totals[file] = seconds;
				sawAnything = true;
			}
		} catch {
			// An interrupted shard leaves a truncated report. Keep whatever the others measured.
		}
		rmSync(runPath, { force: true });
	}
	if (sawAnything) writeFileSync(DURATIONS_FILE, `${JSON.stringify(totals, null, '\t')}\n`, 'utf8');
}

/** Walk Playwright's JSON report, attributing every result's duration to its spec file. */
function durationsFromReport(report) {
	const totals = {};
	const visit = (node, file) => {
		if (!node || typeof node !== 'object') return;
		const current = typeof node.file === 'string' ? `tests/${path.basename(node.file)}` : file;
		if (Array.isArray(node.results) && current) {
			for (const result of node.results) {
				if (typeof result?.duration === 'number') {
					totals[current] = (totals[current] ?? 0) + result.duration / 1000;
				}
			}
		}
		for (const value of Object.values(node)) {
			if (Array.isArray(value)) for (const item of value) visit(item, current);
			else if (value && typeof value === 'object') visit(value, current);
		}
	};
	visit(report, null);
	return totals;
}

// A caller who named their own files ("npm test 4 tests/race.spec.ts") means exactly those, so
// the balancer stands down and Playwright's own split decides who runs what.
const callerChoseFiles = passthrough.some(arg => !arg.startsWith('-'));
const durations = callerChoseFiles ? null : recordedDurations();
const slices = durations ? balancedSlices(allSpecFiles(), durations, shardCount) : null;
if (slices) {
	const spread = slices.map(slice => `${slice.total.toFixed(0)}s`).join(', ');
	console.log(`[e2e] Balancing by measured duration (${spread}).`);
} else {
	console.log('[e2e] No timings recorded yet — splitting by file count; the next run balances.');
}

const started = Date.now();
console.log(`[e2e] Running ${shardCount} shards on ports ${BASE_PORT}–${BASE_PORT + shardCount - 1}.`);

/** Prefix every line so four interleaved outputs stay readable. */
function pipeWithPrefix(stream, prefix, sink) {
	let carry = '';
	stream.on('data', chunk => {
		const lines = (carry + chunk.toString()).split('\n');
		carry = lines.pop() ?? '';
		for (const line of lines) sink.write(`${prefix} ${line}\n`);
	});
	stream.on('end', () => { if (carry) sink.write(`${prefix} ${carry}\n`); });
}

const shards = Array.from({ length: shardCount }, (_, index) => {
	const id = index + 1;
	// Either an explicit, time-balanced list of files, or Playwright's own count-based split.
	const selection = slices ? slices[index].files : [`--shard=${id}/${shardCount}`];
	const child = spawn(
		'npx',
		['playwright', 'test', ...selection, ...passthrough],
		{
			cwd: here,
			shell: true,
			stdio: ['ignore', 'pipe', 'pipe'],
			env: {
				...process.env,
				E2E_PORT: String(BASE_PORT + index),
				E2E_SHARD_ID: String(id),
				// The config widens its deadlines with this: a shared machine is a slower one.
				E2E_SHARD_COUNT: String(shardCount),
				E2E_PREBUILT: '1',
				// Each shard owns its server, so it must always start a fresh one rather than
				// adopting a stray process left on that port by an earlier run.
				CI: process.env.CI ?? '',
			},
		},
	);
	pipeWithPrefix(child.stdout, `[${id}/${shardCount}]`, process.stdout);
	pipeWithPrefix(child.stderr, `[${id}/${shardCount}]`, process.stderr);
	return new Promise(resolve => child.on('close', code => resolve({ id, code: code ?? 1 })));
});

const results = await Promise.all(shards);
recordDurations();
const failed = results.filter(result => result.code !== 0);
const seconds = ((Date.now() - started) / 1000).toFixed(1);

console.log(`\n[e2e] ${shardCount} shards finished in ${seconds}s.`);
for (const { id, code } of results) {
	console.log(`[e2e]   shard ${id}/${shardCount}: ${code === 0 ? 'passed' : `FAILED (exit ${code})`}`);
}
if (failed.length > 0) {
	console.error(
		`[e2e] ${failed.length} shard(s) failed. Reports: e2e/playwright-report-<shard>/index.html`);
}
process.exit(failed.length > 0 ? 1 : 0);
