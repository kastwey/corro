// Text enlargement and the no-sideways-scrolling rule.
//
// Enlarging TEXT is not zooming. Zoom shrinks the viewport's CSS pixel count, so media queries
// fire and a responsive layout rearranges itself; raising the root font size leaves the viewport
// exactly as wide as it was and grows everything measured in rem inside boxes that did not move.
// A layout that only reflows through breakpoints therefore looks fine zoomed and bursts its
// container enlarged — which is how a fixed four-column token picker survived every scan until
// somebody measured it (issue #14).

import { expect, type Page } from '@playwright/test';

/**
 * Set the root font size to `percent` of the 16px default, for this page and for anything it
 * navigates to afterwards — the lobby's language switch is a real navigation, and a style tag
 * would not survive it.
 */
export async function enlargeText(page: Page, percent: number): Promise<void> {
	const css = `html { font-size: ${(16 * percent) / 100}px; }`;
	await page.addInitScript(style => {
		const apply = () => {
			const tag = document.createElement('style');
			tag.dataset.e2eTextSize = 'yes';
			tag.textContent = style;
			document.head.appendChild(tag);
		};
		if (document.head) apply();
		else document.addEventListener('DOMContentLoaded', apply, { once: true });
	}, css);
	// The init script covers every FUTURE document; this covers the one already loaded.
	if (!page.url().startsWith('about:')) await page.addStyleTag({ content: css });
}

/**
 * Assert the rule the repository states for every page: wide content scrolls inside its own
 * container, the body never scrolls sideways (WCAG 1.4.10 Reflow). A player who enlarges the
 * text to read at all should not then have to scroll right to reach a control — and in the
 * lobby the controls on the right are not optional, since a game cannot be created without
 * choosing a piece.
 *
 * The verdict is the document's own scroll width, which cannot produce a false positive from a
 * deliberately off-screen node; the element list exists only so a failure names the offender
 * instead of leaving two numbers to interpret.
 */
export async function expectNoSidewaysScroll(page: Page, where: string): Promise<void> {
	const seen = await page.evaluate(() => {
		const root = document.documentElement;
		const limit = root.clientWidth;
		const offenders: string[] = [];
		for (const node of Array.from(document.querySelectorAll('*'))) {
			const box = (node as HTMLElement).getBoundingClientRect();
			if (box.width === 0 && box.height === 0) continue;
			if (box.right <= limit + 0.5) continue;
			const el = node as HTMLElement;
			const name = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}`
				+ (el.classList.length ? `.${[...el.classList].join('.')}` : '');
			offenders.push(`${name} — left ${Math.round(box.left)}, right ${Math.round(box.right)}`);
		}
		return { limit, scrollWidth: root.scrollWidth, offenders };
	});
	expect(seen.scrollWidth, `${where}: the page scrolls sideways `
		+ `(${seen.scrollWidth}px of content in ${seen.limit}px). Sticking out:\n- `
		+ (seen.offenders.join('\n- ') || '(nothing measurable — check a negative margin or a transform)'),
	).toBeLessThanOrEqual(seen.limit);
}
