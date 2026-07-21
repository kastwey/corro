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
		assert.equal(footer.querySelector('strong')?.textContent?.trim(), 'Corro');
		assert.doesNotMatch(footer.textContent ?? '', /imperio/i);

		const repository = footer.querySelector<HTMLAnchorElement>('a[data-i18n="footer.repository"]');
		assert.ok(repository, `${page} must link to the source repository`);
		assert.equal(repository.href, 'https://github.com/kastwey/corro');
		assert.match(repository.textContent ?? '', /GitHub/i);
		assert.equal(repository.closest('ul')?.className, 'app-footer__links');
		assert.doesNotMatch(footer.textContent ?? '', /·/, 'footer links use list semantics, not a spoken separator');
	});
}