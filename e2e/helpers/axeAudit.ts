import axe from 'axe-core';
import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { E2E_BASE_URL } from '../playwright.config';

const REPORT_BINDING = '__corroReportAxeScan';
const BROWSER_AUDIT_API = '__corroAxeAudit';
const QUIET_PERIOD_MS = 60;
const MAX_RECORDED_VIOLATIONS = 250;

interface BrowserAxeNode {
	target: unknown;
	html: string;
	failureSummary?: string;
}

interface BrowserAxeViolation {
	id: string;
	impact?: string | null;
	description: string;
	help: string;
	helpUrl: string;
	nodes: BrowserAxeNode[];
}

interface BrowserAxeReport {
	url: string;
	title: string;
	state: string;
	sequence: number;
	violations: BrowserAxeViolation[];
	error?: string;
}

interface RecordedViolation extends BrowserAxeNode {
	id: string;
	impact: string;
	description: string;
	help: string;
	helpUrl: string;
	page: string;
	url: string;
	state: string;
	sequence: number;
	occurrences: number;
}

interface PageAudit {
	label: string;
	page: Page;
	lastUrl: string;
	scans: number;
}

interface AuditSession {
	id: number;
	testTitle: string;
	pages: Map<Page, PageAudit>;
	violations: Map<string, RecordedViolation>;
	errors: string[];
}

let nextSessionId = 1;
let activeSession: AuditSession | null = null;
const instrumentedContexts = new WeakSet<BrowserContext>();

/** Reset the per-test audit ledger before any player pages are created. */
export function beginAxeAudit(testInfo: TestInfo): void {
	activeSession = {
		id: nextSessionId++,
		testTitle: testInfo.title,
		pages: new Map(),
		violations: new Map(),
		errors: [],
	};
}

/**
 * Installs Axe before application code and records every settled DOM state.
 * A MutationObserver plus interaction events schedule scans; synchronous mutation
 * batches are coalesced, and a result is discarded if the DOM changes while Axe is
 * reading it. This catches transient dialogs and panels, not only the final test state.
 */
export async function installAxeAudit(context: BrowserContext): Promise<void> {
	if (instrumentedContexts.has(context)) return;
	instrumentedContexts.add(context);

	const sessionId = activeSession?.id;
	if (!sessionId) {
		throw new Error('installAxeAudit() was called outside the automatic Axe test fixture.');
	}

	await context.exposeBinding(REPORT_BINDING, ({ page }, rawReport: BrowserAxeReport) => {
		if (!page || activeSession?.id !== sessionId) return;
		recordReport(page, rawReport);
	});

	const browserInstaller = `\n;(${installBrowserAxeAudit.toString()})(${JSON.stringify({
		apiName: BROWSER_AUDIT_API,
		bindingName: REPORT_BINDING,
		origin: E2E_BASE_URL,
		quietPeriodMs: QUIET_PERIOD_MS,
	})});`;
	await context.addInitScript({ content: `${axe.source}${browserInstaller}` });

	context.on('page', page => registerPage(page, sessionId));
	for (const page of context.pages()) registerPage(page, sessionId);
}

/** Force the current page state through Axe and wait for its Node-side report. */
export async function flushAxeAudit(page: Page): Promise<void> {
	if (page.isClosed()) return;
	await page.evaluate(async apiName => {
		const api = (window as any)[apiName];
		if (api?.flush) await api.flush();
	}, BROWSER_AUDIT_API);
}

/** Read violations recorded for one page; used by the monitor's own regression test. */
export function axeViolationsFor(page: Page): RecordedViolation[] {
	const label = activeSession?.pages.get(page)?.label;
	if (!activeSession || !label) return [];
	return [...activeSession.violations.values()].filter(violation => violation.page === label);
}

/** Remove one page's expected violations after the monitor regression test asserts them. */
export function clearAxeViolationsFor(page: Page): void {
	const label = activeSession?.pages.get(page)?.label;
	if (!activeSession || !label) return;
	for (const [key, violation] of activeSession.violations) {
		if (violation.page === label) activeSession.violations.delete(key);
	}
}

/** Flush every live page, attach a machine-readable report, and fail on any Axe violation. */
export async function finishAxeAudit(testInfo: TestInfo): Promise<void> {
	const session = activeSession;
	if (!session) return;

	for (const audit of session.pages.values()) {
		if (audit.page.isClosed()) continue;
		try {
			await flushAxeAudit(audit.page);
		} catch (error) {
			// A test may deliberately close or navigate a page while teardown starts.
			if (!audit.page.isClosed() && isApplicationUrl(audit.page.url())) {
				session.errors.push(`${audit.label}: Axe flush failed: ${errorMessage(error)}`);
			}
		}
	}

	for (const audit of session.pages.values()) {
		if (isApplicationUrl(audit.lastUrl) && audit.scans === 0) {
			session.errors.push(`${audit.label}: no Axe scan completed for ${audit.lastUrl}`);
		}
	}

	const violations = [...session.violations.values()];
	if (violations.length || session.errors.length) {
		const report = JSON.stringify({
			test: session.testTitle,
			pages: [...session.pages.values()].map(({ label, lastUrl, scans }) => ({ label, lastUrl, scans })),
			violations,
			errors: session.errors,
		}, null, 2);
		const reportPath = testInfo.outputPath('axe-accessibility-report.json');
		await writeFile(reportPath, report, 'utf8');
		await testInfo.attach('axe-accessibility-report', {
			path: reportPath,
			contentType: 'application/json',
		});
		activeSession = null;
		throw new Error(formatAuditFailure(violations, session.errors));
	}

	activeSession = null;
}

function registerPage(page: Page, sessionId: number): void {
	if (activeSession?.id !== sessionId || activeSession.pages.has(page)) return;
	const audit: PageAudit = {
		label: `page ${activeSession.pages.size + 1}`,
		page,
		lastUrl: page.url(),
		scans: 0,
	};
	activeSession.pages.set(page, audit);
	page.on('framenavigated', frame => {
		if (frame === page.mainFrame()) audit.lastUrl = frame.url();
	});
}

function recordReport(page: Page, report: BrowserAxeReport): void {
	const session = activeSession;
	if (!session) return;
	let pageAudit = session.pages.get(page);
	if (!pageAudit) {
		registerPage(page, session.id);
		pageAudit = session.pages.get(page);
	}
	if (!pageAudit) return;

	pageAudit.lastUrl = report.url;
	pageAudit.scans++;
	if (report.error) {
		session.errors.push(`${pageAudit.label} (${report.url}, ${report.state}): ${report.error}`);
		return;
	}

	for (const violation of report.violations ?? []) {
		const nodes = violation.nodes.length ? violation.nodes : [{ target: [], html: '' }];
		for (const node of nodes) {
			const key = `${pageAudit.label}\u0000${violation.id}\u0000${JSON.stringify(node.target)}\u0000${node.html}`;
			const existing = session.violations.get(key);
			if (existing) {
				existing.occurrences++;
				continue;
			}
			if (session.violations.size >= MAX_RECORDED_VIOLATIONS) continue;
			session.violations.set(key, {
				id: violation.id,
				impact: violation.impact ?? 'unknown',
				description: violation.description,
				help: violation.help,
				helpUrl: violation.helpUrl,
				target: node.target,
				html: node.html,
				failureSummary: node.failureSummary,
				page: pageAudit.label,
				url: report.url,
				state: report.state,
				sequence: report.sequence,
				occurrences: 1,
			});
		}
	}
}

function isApplicationUrl(url: string): boolean {
	return url.startsWith(E2E_BASE_URL);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function formatAuditFailure(violations: RecordedViolation[], errors: string[]): string {
	const lines = [
		`Axe found ${violations.length} unique accessibility violation(s) across settled E2E UI states.`,
	];
	for (const error of errors) lines.push(`\n[AUDIT ERROR] ${error}`);
	for (const violation of violations.slice(0, 60)) {
		lines.push(
			`\n[${violation.impact}] ${violation.id}: ${violation.help}`,
			`  ${violation.page}, state ${violation.sequence} (${violation.state})`,
			`  ${violation.url}`,
			`  target: ${JSON.stringify(violation.target)}`,
			`  html: ${violation.html}`,
			`  ${violation.failureSummary ?? violation.description}`,
			`  ${violation.helpUrl}`,
			violation.occurrences > 1 ? `  repeated in ${violation.occurrences} scans` : '',
		);
	}
	if (violations.length > 60) {
		lines.push(`\n${violations.length - 60} more violation(s); see the attached axe-accessibility-report JSON.`);
	}
	return lines.filter(Boolean).join('\n');
}

/** Runs inside every document before application scripts. Keep it self-contained. */
function installBrowserAxeAudit(config: {
	apiName: string;
	bindingName: string;
	origin: string;
	quietPeriodMs: number;
}): void {
	const auditWindow = window as any;
	let observer: MutationObserver | null = null;
	let timer: number | null = null;
	let running = false;
	let dirty = false;
	let revision = 0;
	let sequence = 0;
	let started = false;
	const idleWaiters: Array<() => void> = [];

	const isAuditableDocument = () => location.origin === config.origin;
	const stateDescription = () => {
		const dialog = document.querySelector('dialog[open]');
		if (dialog) {
			const label = dialog.getAttribute('aria-label')
				?? (dialog.getAttribute('aria-labelledby')
					? document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent
					: null)
				?? dialog.querySelector('h1, h2, .dialog-title')?.textContent;
			return `dialog: ${(label ?? '(unnamed)').trim()}`;
		}
		const heading = document.querySelector('h1')?.textContent?.trim();
		return `page: ${heading || document.title || '(untitled)'}`;
	};

	const resolveIdle = () => {
		if (running || timer !== null || dirty) return;
		for (const resolve of idleWaiters.splice(0)) resolve();
	};

	const report = async (payload: BrowserAxeReport) => {
		const binding = auditWindow[config.bindingName];
		if (typeof binding === 'function') await binding(payload);
	};

	const run = async () => {
		if (!isAuditableDocument()) {
			dirty = false;
			resolveIdle();
			return;
		}
		if (running) {
			dirty = true;
			return;
		}
		running = true;
		dirty = false;
		const startRevision = revision;
		const currentSequence = ++sequence;
		try {
			const results = await auditWindow.axe.run(document, { resultTypes: ['violations'] });
			// A changing tree is not a stable UI state. Discard it and scan the settled tree next.
			if (revision === startRevision) {
				await report({
					url: location.href,
					title: document.title,
					state: stateDescription(),
					sequence: currentSequence,
					violations: results.violations.map((violation: any) => ({
						id: violation.id,
						impact: violation.impact,
						description: violation.description,
						help: violation.help,
						helpUrl: violation.helpUrl,
						nodes: violation.nodes.map((node: any) => ({
							target: node.target,
							html: node.html,
							failureSummary: node.failureSummary,
						})),
					})),
				});
			}
		} catch (error) {
			await report({
				url: location.href,
				title: document.title,
				state: stateDescription(),
				sequence: currentSequence,
				violations: [],
				error: error instanceof Error ? error.message : String(error),
			});
		} finally {
			running = false;
			if (dirty || revision !== startRevision) schedule();
			else resolveIdle();
		}
	};

	const schedule = () => {
		dirty = true;
		if (!isAuditableDocument() || running) return;
		if (timer !== null) window.clearTimeout(timer);
		timer = window.setTimeout(() => {
			timer = null;
			void run();
		}, config.quietPeriodMs);
	};

	const changed = () => {
		revision++;
		schedule();
	};

	const start = () => {
		if (started || !document.documentElement) return;
		started = true;
		observer = new MutationObserver(changed);
		observer.observe(document.documentElement, {
			subtree: true,
			childList: true,
			characterData: true,
			attributes: true,
		});
		for (const eventName of ['click', 'input', 'change', 'focusin', 'focusout']) {
			document.addEventListener(eventName, changed, true);
		}
		changed();
	};

	auditWindow[config.apiName] = {
		flush: () => new Promise<void>(resolve => {
			idleWaiters.push(resolve);
			dirty = true;
			if (timer !== null) {
				window.clearTimeout(timer);
				timer = null;
			}
			if (!running) void run();
		}),
	};

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', start, { once: true });
	} else {
		start();
	}
}
