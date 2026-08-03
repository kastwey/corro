// coverage.ts — which client modules each spec actually EXERCISES.
//
// This exists to answer one question: "I changed frontend/src/comboBox.ts — which of the 39 specs
// could possibly care?" A hand-written map of file → spec answers it too, right up until somebody
// adds a module and forgets the map, at which point it answers it WRONGLY and in silence. So the
// map is not written: it is measured, from the same run that would have caught the regression.
//
// The measure is V8 function coverage, not which scripts loaded. Loading is useless here: every
// spec goes through the lobby, and the lobby statically imports nearly everything, so "loaded"
// would map every frontend change to every spec and save nothing. What separates a spec that
// merely has comboBox.js in memory from one that OPERATES the combobox is whether its functions
// ever ran — so a file counts as exercised only when something inside it beyond the module's own
// top level actually executed.
//
// Recording is off unless E2E_COVERAGE is set (run-coverage.mjs sets it): it slows every page down
// and nothing about an ordinary run should pay for it.

import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export const COVERAGE_DIR = path.resolve(__dirname, '..', '.coverage');

/** Whether this run is measuring. Everything below is a no-op when it is not. */
export function coverageEnabled(): boolean {
	return process.env.E2E_COVERAGE === '1';
}

const started = new WeakSet<Page>();
/** Source files exercised by the test currently running. */
let exercised = new Set<string>();
let activeSpec: string | null = null;

/** Begin a test's ledger. */
export function beginCoverage(testInfo: TestInfo): void {
	if (!coverageEnabled()) return;
	exercised = new Set<string>();
	activeSpec = path.relative(path.resolve(__dirname, '..'), testInfo.file).replace(/\\/g, '/');
}

/**
 * Start collecting on every page of a context, including pages opened later (the reconnection
 * flows open a second one). Chromium-only, which is the browser this suite runs.
 */
export async function installCoverage(context: BrowserContext): Promise<void> {
	if (!coverageEnabled()) return;
	const start = async (page: Page) => {
		if (started.has(page)) return;
		started.add(page);
		// resetOnNavigation off: a spec that reloads (rejoin, language switch) would otherwise
		// throw away everything it exercised before the reload.
		await page.coverage.startJSCoverage({ resetOnNavigation: false }).catch(() => { /* closed */ });
	};
	context.on('page', page => void start(page));
	await Promise.all(context.pages().map(start));
}

/**
 * Read a page's coverage and fold it into this test's ledger. Called before the page is closed,
 * because coverage dies with it.
 */
export async function collectCoverage(page: Page): Promise<void> {
	if (!coverageEnabled() || page.isClosed() || !started.has(page)) return;
	try {
		for (const entry of await page.coverage.stopJSCoverage()) {
			const source = sourceFileFor(entry.url);
			if (source && wasExercised(entry)) exercised.add(source);
		}
	} catch {
		// A page torn down mid-collection has nothing left to say; the others still report.
	}
	started.delete(page);
}

/** Append this test's ledger to the shard's file. Merged into the map by run-coverage.mjs. */
export async function finishCoverage(): Promise<void> {
	if (!coverageEnabled() || !activeSpec || exercised.size === 0) return;
	await mkdir(COVERAGE_DIR, { recursive: true });
	const shard = process.env.E2E_SHARD_ID ?? 'serial';
	await appendFile(
		path.join(COVERAGE_DIR, `run-${shard}.jsonl`),
		`${JSON.stringify({ spec: activeSpec, files: [...exercised].sort() })}\n`,
		'utf8',
	);
	activeSpec = null;
}

/**
 * Did anything in this file actually RUN, beyond the module being evaluated?
 *
 * Every ES module executes its own top level on import, so a file that was merely imported always
 * shows one covered function. What tells the two apart is a second one: a named function, a class
 * method, an arrow handler — something the spec's own actions reached.
 */
function wasExercised(entry: { functions: { functionName: string; ranges: { count: number }[] }[] }): boolean {
	return entry.functions.some(fn =>
		fn.functionName !== '' && fn.ranges.some(range => range.count > 0));
}

/**
 * Map a served URL back to the file in the repository it was built from:
 * `http://localhost:5599/lobby/index.js` → `frontend/src/lobby/index.ts`.
 *
 * Returns null for anything that is not ours — the libraries, the injected Axe, inline scripts —
 * because a change to those is not something this map is being asked about.
 */
export function sourceFileFor(url: string): string | null {
	let pathname: string;
	try {
		pathname = new URL(url).pathname;
	} catch {
		return null;
	}
	if (!pathname.endsWith('.js')) return null;
	// Bundled third-party code is served from /libs/ and has no source of ours behind it.
	if (pathname.startsWith('/libs/')) return null;
	// Localized pages are served from /es/…; the module paths under them are the same files.
	const withoutLocale = pathname.replace(/^\/(?:es)\//, '/');
	return `frontend/src${withoutLocale.replace(/\.js$/, '.ts')}`;
}
