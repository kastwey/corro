import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const SRC_DIR = fileURLToPath(new URL('../src/', import.meta.url));

for (const page of ['index.html', 'board.html']) {
	test(`${page} footer identifies Corro as the platform`, () => {
		const html = readFileSync(`${SRC_DIR}${page}`, 'utf8');
		const document = new JSDOM(html).window.document;
		const footer = document.querySelector('.app-footer');

		assert.ok(footer, `${page} must include the application footer`);
		const corro = footer.querySelector<HTMLAnchorElement>('a[data-footer-link="corro"]');
		assert.ok(corro, `${page} must make Corro itself the source link`);
		assert.equal(corro.querySelector('strong')?.textContent?.trim(), 'Corro');
		assert.equal(corro.href, 'https://github.com/kastwey/corro');
		assert.doesNotMatch(footer.textContent ?? '', /imperio/i);

		assert.equal(footer.querySelector('a[data-footer-link="repository"]'), null,
			'the repository is no longer repeated as a separate footer link');

		const license = footer.querySelector<HTMLAnchorElement>('a[data-footer-link="license"]');
		assert.ok(license, `${page} must link to the project license`);
		assert.equal(license.href, 'https://www.gnu.org/licenses/agpl-3.0.html');

		for (const link of [corro, license]) {
			assert.equal(link.target, '_blank');
			assert.match(link.rel, /\bnoopener\b/);
			assert.match(link.rel, /\bnoreferrer\b/);
			assert.match(link.getAttribute('aria-label') ?? '', /, opens in a new window$/);

			const icon = link.querySelector<SVGElement>('svg.app-footer__external-icon');
			assert.ok(icon, 'new-window icon must be present');
			assert.equal(icon.getAttribute('aria-hidden'), 'true');
			assert.equal(icon.getAttribute('focusable'), 'false');
			assert.equal(link.lastElementChild, icon, 'new-window icon must suffix the visible label');
		}

		assert.doesNotMatch(footer.textContent ?? '', /·/, 'footer links use list semantics, not a spoken separator');
	});
}