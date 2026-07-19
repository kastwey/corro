import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Frontend root (this file lives in frontend/test/).
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LOCALES_DIR = join(ROOT, 'i18n', 'locales');
const SRC_DIR = join(ROOT, 'src');
// Repository root and the .NET server project (sibling of frontend/). The server
// is the single source of truth for the spoken voice of game events, so its
// `context.Announce("game.x")` keys must also exist (and carry `_self` variants).
const REPO_ROOT = join(ROOT, '..');
const SERVER_DIR = join(REPO_ROOT, 'server');

const LANGS = ['en', 'es'] as const;

/** Flatten a nested locale object into a set of dot-separated leaf keys. */
function flattenKeys(obj: unknown, prefix = '', out = new Set<string>()): Set<string> {
	if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
		for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
			const key = prefix ? `${prefix}.${k}` : k;
			if (v && typeof v === 'object' && !Array.isArray(v)) {
				flattenKeys(v, key, out);
			} else {
				out.add(key);
			}
		}
	}
	return out;
}

function loadLocale(lang: string): Set<string> {
	const raw = readFileSync(join(LOCALES_DIR, `${lang}.json`), 'utf8');
	return flattenKeys(JSON.parse(raw));
}

/** Recursively collect files under dir whose name matches one of the extensions. */
function collectFiles(dir: string, exts: string[], out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			collectFiles(full, exts, out);
		} else if (exts.some(e => entry.endsWith(e))) {
			out.push(full);
		}
	}
	return out;
}

/**
 * Extract i18n keys that are statically resolvable from source.
 *
 * Only literal single-quoted keys followed by a comma or closing paren are
 * captured, so dynamic keys (`t('token_' + p.token)`, template literals) are
 * intentionally skipped — they can't be checked statically.
 */
function extractCodeKeys(): Map<string, string> {
	// key -> first file it was seen in (for nicer failure messages)
	const keys = new Map<string, string>();
	const addKey = (key: string, file: string) => {
		if (!keys.has(key)) keys.set(key, file);
	};

	// Full, already-namespaced keys.
	const fullKeyPatterns = [
		/createAnnouncement\(\s*'([^']+)'\s*[,)]/g,
		/\btSync\(\s*'([^']+)'\s*[,)]/g,
	];
	// Bare keys passed to the local `t()` helper (always prefixed with `game.`).
	const gameKeyPattern = /\bt\(\s*'([^']+)'\s*[,)]/g;

	for (const file of collectFiles(SRC_DIR, ['.ts'])) {
		const content = readFileSync(file, 'utf8');
		const rel = file.slice(ROOT.length);

		for (const pattern of fullKeyPatterns) {
			for (const m of content.matchAll(pattern)) {
				const key = m[1];
				if (key === '_raw') continue; // already-translated passthrough
				addKey(key, rel);
			}
		}

		for (const m of content.matchAll(gameKeyPattern)) {
			const key = m[1];
			// Skip dynamic concatenation fragments that slipped through.
			if (key.includes('${') || key.endsWith('_')) continue;
			// A `t('...')` helper is only `game.`-prefixed when the key is a bare
			// (dot-less) game key. Keys that already carry a namespace
			// (`lobby.*`, `notifications.*`, ...) come from helpers that pass the
			// full key through, so treat them as-is.
			addKey(key.includes('.') ? key : `game.${key}`, rel);
		}
	}

	return keys;
}

/** Extract data-i18n keys from the HTML templates (full, namespaced keys). */
function extractHtmlKeys(): Map<string, string> {
	const keys = new Map<string, string>();
	const patterns = [
		/data-i18n="([^"]+)"/g,
		/data-i18n-attr:[\w-]+="([^"]+)"/g,
		/data-i18n-attr-[\w-]+="([^"]+)"/g,
	];
	for (const file of collectFiles(SRC_DIR, ['.html'])) {
		const content = readFileSync(file, 'utf8');
		const rel = file.slice(ROOT.length);
		for (const pattern of patterns) {
			for (const m of content.matchAll(pattern)) {
				if (!keys.has(m[1])) keys.set(m[1], rel);
			}
		}
	}
	return keys;
}

const locales: Record<string, Set<string>> = Object.fromEntries(
	LANGS.map(l => [l, loadLocale(l)])
);

test('en.json and es.json define exactly the same keys', () => {
	const en = locales.en;
	const es = locales.es;
	const onlyInEn = [...en].filter(k => !es.has(k) && !k.endsWith('_comment')).sort();
	const onlyInEs = [...es].filter(k => !en.has(k) && !k.endsWith('_comment')).sort();

	assert.deepEqual(
		{ onlyInEn, onlyInEs },
		{ onlyInEn: [], onlyInEs: [] },
		`Locale key sets differ.\n` +
		(onlyInEn.length ? `  Missing in es.json: ${onlyInEn.join(', ')}\n` : '') +
		(onlyInEs.length ? `  Missing in en.json: ${onlyInEs.join(', ')}\n` : '')
	);
});

test('every translation key used in code exists in all locales', () => {
	const used = extractCodeKeys();
	const missing: string[] = [];
	for (const [key, file] of used) {
		for (const lang of LANGS) {
			if (!locales[lang].has(key)) {
				missing.push(`"${key}" (used in ${file}) missing in ${lang}.json`);
			}
		}
	}
	assert.equal(missing.length, 0, `Missing translations:\n  ${missing.sort().join('\n  ')}`);
});

test('every data-i18n key used in HTML exists in all locales', () => {
	const used = extractHtmlKeys();
	const missing: string[] = [];
	for (const [key, file] of used) {
		for (const lang of LANGS) {
			if (!locales[lang].has(key)) {
				missing.push(`"${key}" (used in ${file}) missing in ${lang}.json`);
			}
		}
	}
	assert.equal(missing.length, 0, `Missing translations:\n  ${missing.sort().join('\n  ')}`);
});

// ────────────────────────────────────────────────────────────────────────────
// Server-announced keys
//
// The .NET server owns the spoken voice of game events: rules call
// `context.Announce("game.x", vars)`. When `vars` carries `["actorId"]`, the
// announcer sends the base key (3rd person) to everyone and the `_self` key
// (1st person) to the actor. The frontend test above never sees these C# keys,
// so a refactor can silently wipe them (raw `game.x` read aloud) or drop a
// `_self` variant (the actor hears 3rd person). These tests close that gap.
// ────────────────────────────────────────────────────────────────────────────

/** Return the balanced argument string of a call, given the index of its '('. */
function balancedArgs(content: string, openParenIdx: number): string {
	let depth = 0;
	for (let i = openParenIdx; i < content.length; i++) {
		const c = content[i];
		if (c === '(') depth++;
		else if (c === ')') {
			depth--;
			if (depth === 0) return content.slice(openParenIdx + 1, i);
		}
	}
	return content.slice(openParenIdx + 1);
}

/**
 * Scan the server for `game.*` announcement keys.
 *  - `announced`: every `"game.x"` literal (covers direct keys AND the dice
 *    `switch` arms whose result is passed as a variable). All must exist as a
 *    base key in both locales.
 *  - `actor`: keys whose `Announce(...)` call also passes `actorId`. These must
 *    additionally define a `_self` variant in both locales.
 */
function extractServerKeys(): { announced: Map<string, string>; actor: Map<string, string> } {
	const announced = new Map<string, string>();
	const actor = new Map<string, string>();
	const keyLiteral = /"(game\.[a-z_]+)"/g;
	const announceCall = /\.Announce\s*\(/g;
	// Switch-arm / assignment literals used for the variable-key (dice) case.
	const arrowLiteral = /=>?\s*"(game\.[a-z_]+)"/g;
	const methodStart = /\b(private|public|protected|internal)\b[^;]*\(/;

	for (const file of collectFiles(SERVER_DIR, ['.cs'])) {
		const content = readFileSync(file, 'utf8');
		const rel = file.slice(REPO_ROOT.length);
		const lines = content.split('\n');

		// (1) Every game.* literal must resolve to a base translation.
		for (const m of content.matchAll(keyLiteral)) {
			if (!announced.has(m[1])) announced.set(m[1], rel);
		}

		// (2) Announce(...) calls carrying actorId need a _self variant.
		for (const call of content.matchAll(announceCall)) {
			const openIdx = call.index! + call[0].length - 1;
			const args = balancedArgs(content, openIdx);
			if (!/actorId/.test(args)) continue;

			const direct = args.match(/^\s*"(game\.[a-z_]+)"/);
			if (direct) {
				if (!actor.has(direct[1])) actor.set(direct[1], rel);
				continue;
			}

			// Variable key (e.g. the dice `switch`): collect literal arms from the
			// enclosing method, scanning backwards until the method signature.
			const lineNo = content.slice(0, call.index!).split('\n').length - 1;
			for (let k = lineNo; k >= Math.max(0, lineNo - 25); k--) {
				for (const arm of lines[k].matchAll(arrowLiteral)) {
					if (!actor.has(arm[1])) actor.set(arm[1], rel);
				}
				if (k !== lineNo && methodStart.test(lines[k])) break;
			}
		}
	}
	return { announced, actor };
}

const serverKeys = extractServerKeys();

test('every server-announced game.* key exists in all locales', () => {
	const missing: string[] = [];
	for (const [key, file] of serverKeys.announced) {
		for (const lang of LANGS) {
			if (!locales[lang].has(key)) {
				missing.push(`"${key}" (announced in ${file}) missing in ${lang}.json`);
			}
		}
	}
	assert.equal(missing.length, 0, `Missing server announcement keys:\n  ${missing.sort().join('\n  ')}`);
});

test('every server announcement with actorId defines a _self variant in all locales', () => {
	const missing: string[] = [];
	for (const [key, file] of serverKeys.actor) {
		for (const lang of LANGS) {
			if (!locales[lang].has(`${key}_self`)) {
				missing.push(`"${key}_self" (actor announcement in ${file}) missing in ${lang}.json`);
			}
		}
	}
	assert.equal(missing.length, 0, `Missing first-person (_self) variants:\n  ${missing.sort().join('\n  ')}`);
});

// ────────────────────────────────────────────────────────────────────────────
// Server error codes
//
// Every `ErrorResponse` the server returns carries a machine `Code` (or a rule
// `ErrorCode`) that the frontend reads aloud / shows via `serverErrors.<CODE>`.
// A handler can add a new code without a matching translation, in which case the
// user hears the raw code. This test extracts every literal error code from the
// .NET sources and asserts a `serverErrors.<CODE>` entry exists in both locales.
// ────────────────────────────────────────────────────────────────────────────

/** Scan the server for literal `Code`/`ErrorCode = "UPPER_SNAKE"` values. */
function extractServerErrorCodes(): Map<string, string> {
	const codes = new Map<string, string>();
	const codeLiteral = /\b(?:ErrorCode|Code)\s*=\s*"([A-Z][A-Z0-9_]*)"/g;
	for (const file of collectFiles(SERVER_DIR, ['.cs'])) {
		const content = readFileSync(file, 'utf8');
		const rel = file.slice(REPO_ROOT.length);
		for (const m of content.matchAll(codeLiteral)) {
			if (!codes.has(m[1])) codes.set(m[1], rel);
		}
	}
	return codes;
}

const serverErrorCodes = extractServerErrorCodes();

test('every server error Code has a serverErrors translation in all locales', () => {
	const missing: string[] = [];
	for (const [code, file] of serverErrorCodes) {
		for (const lang of LANGS) {
			if (!locales[lang].has(`serverErrors.${code}`)) {
				missing.push(`"serverErrors.${code}" (returned in ${file}) missing in ${lang}.json`);
			}
		}
	}
	assert.equal(missing.length, 0, `Missing server error translations:\n  ${missing.sort().join('\n  ')}`);
});

// Player token names now live in each board's package i18n (boards ship their own tokens), so
// there are no app-level token strings to parity-check here.
