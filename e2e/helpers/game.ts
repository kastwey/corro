// helpers/game.ts — shared plumbing for the E2E suite.
//
// Three concerns live here:
//  * the server's scripted-dice control (POST /e2e/random / /e2e/reset);
//  * the lobby flow (create / join / start) driven through the real UI;
//  * accessibility-first assertion helpers: announcements are captured from the
//    aria-live regions (what a screen reader hears), and texts are asserted against
//    the PACKAGE's own i18n files, never hardcoded — the suite verifies coherence
//    between what the package declares and what the player sees/hears.

import { expect, type Browser, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { E2E_BASE_URL } from '../playwright.config';
import { installAxeAudit } from './axeAudit';

// ── Server script control ─────────────────────────────────────────────────────

/** Enqueue the next raw random values (a plain roll consumes two: die1, die2). */
export async function scriptDice(...values: number[]): Promise<void> {
	const res = await fetch(`${E2E_BASE_URL}/e2e/random`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ values }),
	});
	if (!res.ok) throw new Error(`scriptDice failed: HTTP ${res.status}`);
}

/** Drop unconsumed values so one test's leftovers cannot leak into the next. */
export async function resetDice(): Promise<void> {
	const res = await fetch(`${E2E_BASE_URL}/e2e/reset`, { method: 'POST' });
	if (!res.ok) throw new Error(`resetDice failed: HTTP ${res.status}`);
}

// ── Package / app i18n (assert against the source of truth, don't hardcode) ──

const REPO_ROOT = path.resolve(__dirname, '..', '..');

/** A shipped package's i18n table (e.g. squares/groups/terminology names). */
export function packageI18n(packageId: string, lang: string): Record<string, any> {
	const file = path.join(REPO_ROOT, 'server', 'Packages', packageId, 'i18n', `${lang}.json`);
	return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

/** A shipped package's manifest (tokens, groups, rules…). */
export function packageManifest(packageId: string): Record<string, any> {
	const file = path.join(REPO_ROOT, 'server', 'Packages', packageId, 'manifest.json');
	return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

/** The app's own locale table (frontend/i18n/locales/<lang>.json). */
export function appI18n(lang: string): Record<string, any> {
	const file = path.join(REPO_ROOT, 'frontend', 'i18n', 'locales', `${lang}.json`);
	return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

// ── Pages / contexts ──────────────────────────────────────────────────────────

/**
 * A fresh context+page for one player. Contexts are per-player browsers: cookies,
 * storage and the SignalR connection are isolated, exactly like two real devices.
 * Captures every aria-live write into window.__announcements for later assertions.
 */
export async function newPlayerPage(
	browser: Browser,
	locale = 'es-ES',
	options: { reducedMotion?: 'reduce' | 'no-preference' } = {},
): Promise<Page> {
	const context = await browser.newContext({
		baseURL: E2E_BASE_URL,
		locale,
		reducedMotion: options.reducedMotion ?? 'reduce',
	});
	await installAxeAudit(context);
	// Context-level so EVERY page in this player's browser gets the collector —
	// including a page reopened after a disconnect (the reconnection flow).
	await context.addInitScript(() => {
		const log: string[] = [];
		(window as any).__announcements = log;
		const push = (text: string | null | undefined) => {
			const t = text?.trim();
			if (t && log[log.length - 1] !== t) log.push(t);
		};
		// Read the MUTATION RECORDS, not the region's current text: the announcer CLEARS the
		// live region ~300ms after writing, and observer callbacks can batch the write and the
		// clear together — reading textContent then would miss the line entirely. The added
		// nodes in each record keep their text even after removal, so nothing transient is lost.
		const observer = new MutationObserver(records => {
			for (const r of records) {
				const el = r.target instanceof Element ? r.target : r.target.parentElement;
				// Match by the aria-live ATTRIBUTE: the board's static polite region carries
				// no class (only announcer-created ones do), and the attribute is what matters.
				if (!el?.closest?.('[aria-live]')) continue;
				if (r.type === 'characterData') push(r.target.textContent);
				else r.addedNodes.forEach(n => push(n.textContent));
			}
		});
		// The regions move between <body> and open modals (setAnnouncerHost), so observe
		// the whole document.
		document.addEventListener('DOMContentLoaded', () => {
			observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
		});
	});
	return await context.newPage();
}

/**
 * Waits until an announcement matching the pattern has been voiced on this page
 * (i.e. written into an aria-live region — what a screen reader would read).
 */
export async function expectAnnouncement(page: Page, pattern: RegExp): Promise<void> {
	// A bounded wait (NOT the whole test timeout): a missed announcement must fail fast
	// enough to still dump what WAS heard before the runner tears the page down.
	await page.waitForFunction(
		({ source, flags }) => {
			const log: string[] = (window as any).__announcements ?? [];
			return log.some(line => new RegExp(source, flags).test(line));
		},
		{ source: pattern.source, flags: pattern.flags },
		{ timeout: 15_000 },
	).catch(async (e) => {
		const log = await page.evaluate(() => (window as any).__announcements ?? []);
		throw new Error(`No announcement matched ${pattern}.\nHeard so far:\n- ${log.join('\n- ')}\n${e}`);
	});
}

// ── Lobby flow (through the real UI) ─────────────────────────────────────────

/**
 * Loads the lobby and waits until its init() has fully finished. The init ends with
 * showView('view-home') + refreshSavedGames(), so a click issued mid-init would be
 * undone by that final view switch; the "your games" content (empty hint or list)
 * renders strictly AFTER it, making it the reliable readiness anchor.
 */
export async function gotoLobbyHome(page: Page): Promise<void> {
	await page.goto('/');
	await expect(page.locator('#your-games-empty, #your-games-list li').first()).toBeVisible();
}

/** Creates a game on the given shipped board and returns the invite code. */
export async function createGame(
	page: Page,
	hostName: string,
	boardId: string,
	opts: { houseRules?: Record<string, boolean>; seat?: string; maxPlayers?: number; teamCount?: number } = {},
): Promise<string> {
	await gotoLobbyHome(page);
	await page.click('#go-create-btn');
	await page.selectOption('#board-selector', boardId);
	// Staging the package re-renders the token list with the BOARD's own pieces
	// (from its manifest); waiting for the first of them proves the package is
	// active before submitting — a generic label could still be a built-in piece.
	const firstPackageToken = packageManifest(boardId).tokens[0].id as string;
	const tokenList = page.locator('.token-list:not(#join-token-list)');
	await expect(tokenList.locator(`input[value="${firstPackageToken}"]`)).toBeAttached();
	// Player count first: the journey team-count options depend on it.
	if (opts.maxPlayers) await page.selectOption('#max-players', String(opts.maxPlayers));
	if (opts.teamCount) await page.selectOption('#team-count', String(opts.teamCount));
	await page.fill('#host-name', hostName);
	// The real control is an invisible radio absolutely positioned inside the label (the
	// label is the visual), so its own geometry is useless to Playwright's hit testing.
	// Dispatch the click as an event: same app-visible behaviour (checked + change), no geometry.
	await tokenList.locator('input.token-radio').first().dispatchEvent('click');
	// Race boards: pick a specific seat (squadron colour); default = the first one.
	if (opts.seat) {
		await page.locator(`#seat-list input[value="${opts.seat}"]`).dispatchEvent('click');
	}
	// Flip declared toggle house rules in the package rules panel before creating.
	// The long create form defeats Playwright's scroll-into-view inside this lobby (same as
	// the token radios), so drive the controls by events rather than positional clicks.
	const houseRules = Object.entries(opts.houseRules ?? {});
	if (houseRules.length > 0) {
		await page.locator('#rules-details').evaluate(el => { (el as HTMLDetailsElement).open = true; });
		for (const [ruleId, value] of houseRules) {
			const box = page.locator(`#package-rules [data-rule-id="${ruleId}"]`);
			if (await box.isChecked() !== value) await box.dispatchEvent('click');
		}
	}
	// Flake forensics: creating has failed intermittently under machine load with
	// #lobby-code just staying empty, which the bare assertion reports as nothing but a
	// timeout. Capture the page's console around the click so the NEXT occurrence tells
	// us WHAT broke (a surfaced lobby error, a SignalR drop, an unhandled rejection…).
	const consoleLog: string[] = [];
	const onConsole = (msg: { type(): string; text(): string }) =>
		consoleLog.push(`[${msg.type()}] ${msg.text()}`);
	const onPageError = (err: Error) => consoleLog.push(`[pageerror] ${err.message}`);
	page.on('console', onConsole);
	page.on('pageerror', onPageError);
	try {
		await page.click('#create-button');
		// Package-authored notices deliberately pause creation in a native confirmation
		// dialog. The helper already knows the selected shipped package, so acknowledge its
		// notice through the real UI before waiting for the lobby code.
		if (packageManifest(boardId).warning) {
			const notice = page.locator('.game-dialog.dialog-confirm');
			await expect(notice).toBeVisible();
			await notice.locator('.btn-primary').click();
		}
		const codeEl = page.locator('#lobby-code');
		try {
			await expect(codeEl).not.toBeEmpty();
		} catch (e) {
			const visibleError = (await page.locator('#error-message').textContent().catch(() => null))?.trim();
			throw new Error(
				`createGame: #lobby-code stayed empty after clicking create.\n`
				+ `Visible lobby error: ${visibleError || '(none)'}\n`
				+ `Console tail:\n- ${consoleLog.slice(-15).join('\n- ') || '(silent)'}\n${e}`);
		}
		return (await codeEl.textContent())!.trim();
	} finally {
		page.off('console', onConsole);
		page.off('pageerror', onPageError);
	}
}

/** Opens the join form for a code and fills the name — everything but the final submit. */
export async function openJoinForm(page: Page, code: string, playerName: string): Promise<void> {
	await gotoLobbyHome(page);
	await page.click('#go-join-btn');
	await page.fill('#lobby-code-input', code);
	await page.click('#validate-code-button');
	await expect(page.locator('#join-step2')).toBeVisible();
	await page.fill('#player-name-step2', playerName);
}

/** Joins an existing game by invite code (second browser context). */
export async function joinGame(
	page: Page, code: string, playerName: string, opts: { seat?: string } = {},
): Promise<void> {
	await openJoinForm(page, code, playerName);
	// Taken tokens are aria-disabled + data-taken (never `disabled`): pick the first free.
	await page.locator('#join-token-list input.token-radio:not([data-taken])').first().dispatchEvent('click');
	if (opts.seat) {
		await page.locator(`#join-seat-list input[value="${opts.seat}"]`).dispatchEvent('click');
	}
	await page.click('#join-final-button');
	await expect(page.locator('#lobby-joined')).toBeVisible();
}

/**
 * Host starts the game; every page lands on the board with its action bar live.
 * In the E2E environment the turn order is the JOIN order, so the host moves first.
 */
export async function startGame(host: Page, allPages: Page[]): Promise<void> {
	await host.click('#start-game-btn');
	for (const page of allPages) {
		await page.waitForURL(/board\.html/);
		// Family-agnostic readiness: property boards render .square cells, race boards
		// .race-cell, track boards .track-cell, trivia the wheel's .trivia-cell, journey
		// boards the hand's .hand-card rows.
		await expect(page.locator('#board .square, #board .race-cell, #board .track-cell, #board .trivia-cell, #board .hand-card').first()).toBeVisible();
	}
}

// ── Board actions ─────────────────────────────────────────────────────────────

/** An action-bar button by its stable action id (rollDice, buyProperty, endTurn…). */
export function actionButton(page: Page, actionId: string) {
	return page.locator(`.action-bar-button[data-action-id="${actionId}"]`);
}

/** A board square's accessible node (its aria-label is what a screen reader speaks). */
export function square(page: Page, index: number) {
	return page.locator(`#board .square[data-index="${index}"]`);
}

/** Scripts the two dice and rolls from this player's action bar. */
export async function roll(page: Page, die1: number, die2: number): Promise<void> {
	await scriptDice(die1, die2);
	await actionButton(page, 'rollDice').click();
}

/** Confirms the pending purchase through the buy dialog. */
export async function buyPendingProperty(page: Page): Promise<void> {
	await actionButton(page, 'buyProperty').click();
	const dialog = page.locator('.game-dialog.dialog-purchase');
	await expect(dialog).toBeVisible();
	await dialog.locator('.btn-primary').click();
}

/**
 * Declines the property you're standing on by ENDING the turn — clicking through the
 * "you could still buy this" forfeit confirmation (auction or discard, per the house rule).
 * Use wherever a test deliberately passes on a buyable it just landed on; a plain
 * `actionButton(page, 'endTurn').click()` would only open the confirm and stall.
 */
export async function declineByEndingTurn(page: Page): Promise<void> {
	await actionButton(page, 'endTurn').click();
	const confirm = page.locator('.game-dialog.dialog-confirm');
	await expect(confirm).toBeVisible();
	await confirm.locator('.btn-primary').click();
}
