// affected.mjs — should the screen-reader suite run for THIS change?
//
// The NVDA suite is minutes of a Windows runner per run, and most pull requests touch nothing a
// screen reader could hear differently: a server rule, a package, a doc. So on a pull request it
// runs only when the change reaches what the suite listens to — and what it listens to is
// DERIVED, never written down by hand, for the same reason e2e/affected.mjs refuses a hand-kept
// map: the first module somebody forgets to list is the regression that ships.
//
// The gallery page is a closed world: no SignalR, no game state, nothing fetched but the locale
// files. What it exercises is therefore exactly the import graph under its entry module, plus
// the stylesheets the page links (contrast and focus rings are heard as well as seen) and the
// locale files (the dialog says "Confirm" and "Cancel" from them). This script walks that graph
// from the sources as they are NOW, so a story that gains an import gains its trigger with it.
//
// Everything else that could change what is heard is the suite itself and the workflow that
// runs it. And every rule fails OPEN: a file the walk cannot account for, a graph it cannot read,
// an argument it does not understand, all mean "run".

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(here, '..');

/** Where the gallery starts, relative to the repository root. */
export const GALLERY_ENTRY = 'frontend/src/gallery/index.ts';
export const GALLERY_PAGE = 'frontend/src/gallery.html';
/** Paths (prefixes) that are the suite's own and always count as heard. */
export const ALWAYS = ['screen-reader/', '.github/workflows/screen-reader.yml', 'frontend/i18n/locales/'];

/**
 * The relative module specifiers a TypeScript source imports at RUNTIME: static `import … from`,
 * `export … from` and dynamic `import('…')`, skipping `import type` (erased by the compiler, so a
 * change behind one cannot change behaviour) and bare specifiers (packages, not our files).
 */
export function runtimeImports(source) {
	const specifiers = new Set();
	const staticImport = /(?:^|;)\s*(?:import|export)\s+(?!type\s)[^'"]*?\bfrom\s+['"](\.[^'"]+)['"]/gm;
	const sideEffectImport = /\bimport\s+['"](\.[^'"]+)['"]/g;
	const dynamicImport = /\bimport\(\s*['"](\.[^'"]+)['"]\s*\)/g;
	for (const pattern of [staticImport, sideEffectImport, dynamicImport]) {
		for (const match of source.matchAll(pattern)) specifiers.add(match[1]);
	}
	return [...specifiers];
}

/** `./comboBox.js` next to `frontend/src/gallery/stories/x.ts` → `frontend/src/comboBox.ts`. */
export function resolveImport(fromFile, specifier) {
	const resolved = path.posix.join(path.posix.dirname(fromFile), specifier);
	return resolved.replace(/\.js$/, '.ts');
}

/**
 * Every source file reachable from `entry` through runtime imports, `entry` included. `read`
 * returns a file's text or null when it does not exist; a missing file is kept in the result (it
 * is still a file whose change would matter) and simply has no children.
 */
export function importGraph(entry, read) {
	const seen = new Set();
	const queue = [entry];
	while (queue.length > 0) {
		const file = queue.shift();
		if (seen.has(file)) continue;
		seen.add(file);
		const source = read(file);
		if (source === null) continue;
		for (const specifier of runtimeImports(source)) {
			const child = resolveImport(file, specifier);
			if (!seen.has(child)) queue.push(child);
		}
	}
	return [...seen].sort();
}

/**
 * The stylesheets a page links, as repository paths. A page's hrefs are relative to the BUILT
 * site root, where build.js copies `frontend/css/` to `dist/css/`, so `css/theme.css` on the page
 * is `frontend/css/theme.css` in the repository.
 */
export function linkedStylesheets(html) {
	const sheets = [];
	for (const [tag] of html.matchAll(/<link\b[^>]*>/g)) {
		if (!/\brel=["']stylesheet["']/.test(tag)) continue;
		const href = /\bhref=["']([^"']+)["']/.exec(tag)?.[1];
		if (href) sheets.push(`frontend/${href}`);
	}
	return sheets;
}

/** Everything the suite listens to, computed from the repository as it is now. */
export function listenedFiles(read) {
	const graph = importGraph(GALLERY_ENTRY, read);
	const page = read(GALLERY_PAGE);
	const sheets = page === null ? [] : linkedStylesheets(page);
	return [...new Set([GALLERY_PAGE, ...graph, ...sheets])].sort();
}

/**
 * The decision. `{ run, reasons }`: `run` is true when any changed file is listened to, and
 * `reasons` names the files that decided it — so the workflow log says WHY the Windows runner
 * was woken, or why it was not.
 */
export function decide(changedFiles, listened) {
	const listenedSet = new Set(listened);
	const reasons = changedFiles.filter(file =>
		listenedSet.has(file) || ALWAYS.some(prefix => file.startsWith(prefix)));
	return { run: reasons.length > 0, reasons };
}

function readFromRepo(file) {
	const absolute = path.join(REPO, file);
	return existsSync(absolute) ? readFileSync(absolute, 'utf8') : null;
}

/** The files a range of commits changed, as repository paths. */
function changedBetween(base, head) {
	const result = spawnSync('git', ['diff', '--name-only', `${base}...${head}`], { cwd: REPO, encoding: 'utf8' });
	if (result.status !== 0) throw new Error(`git diff failed: ${result.stderr}`);
	return result.stdout.split('\n').map(line => line.trim()).filter(Boolean);
}

function parseArgs(argv) {
	const args = {};
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--base') args.base = argv[++i];
		else if (argv[i] === '--head') args.head = argv[++i];
		else if (argv[i] === '--list') args.list = true;
		else throw new Error(`unknown argument: ${argv[i]}`);
	}
	return args;
}

/**
 * CLI. `--list` prints what the suite listens to; `--base <ref> --head <ref>` decides for that
 * range and prints `run=true|false` (what the workflow reads) plus the reasons as comments.
 * Anything that goes wrong prints `run=true`: the suite running for nothing costs minutes, the
 * suite not running for a regression costs a player.
 */
function main() {
	let args;
	try {
		args = parseArgs(process.argv.slice(2));
		const listened = listenedFiles(readFromRepo);
		if (args.list) {
			for (const file of listened) console.log(file);
			return;
		}
		if (!args.base || !args.head) throw new Error('--base and --head are required');
		const { run, reasons } = decide(changedBetween(args.base, args.head), listened);
		for (const reason of reasons) console.error(`heard: ${reason}`);
		if (!run) console.error('nothing this change touches reaches the screen-reader suite');
		console.log(`run=${run}`);
	} catch (error) {
		console.error(`screen-reader/affected.mjs could not decide (${error.message}); running the suite`);
		console.log('run=true');
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
