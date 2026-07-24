import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';

test('LiveKit UMD is loaded lazily and resolves only after its global exists', async () => {
	setupDom();
	delete (window as any).LivekitClient;
	const { loadLiveKitClient } = await import('../src/liveKitLoader.js');

	const pending = loadLiveKitClient();
	const script = document.querySelector<HTMLScriptElement>('script[src="libs/livekit-client.umd.js"]');
	assert.ok(script, 'the optional SDK is requested only when the loader is called');
	(window as any).LivekitClient = { Room: class {} };
	script.dispatchEvent(new window.Event('load'));

	assert.equal(await pending, true);
	assert.equal(await loadLiveKitClient(), true, 'later calls reuse the loaded global');
	assert.equal(document.querySelectorAll('script[src="libs/livekit-client.umd.js"]').length, 1);
});
