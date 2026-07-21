import type { Page, TestInfo } from '@playwright/test';

/**
 * Captures a named full-page image in Playwright's managed test output and
 * exposes it through the HTML report without writing into the E2E root.
 */
export async function captureScreenshot(
	page: Page,
	testInfo: TestInfo,
	name: string,
): Promise<void> {
	const outputPath = testInfo.outputPath(name);
	await page.screenshot({ path: outputPath, fullPage: true });
	await testInfo.attach(name, {
		path: outputPath,
		contentType: 'image/png',
	});
}
