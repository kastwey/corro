declare global {
	interface Window {
		LivekitClient?: typeof import('livekit-client');
	}
}

let loading: Promise<boolean> | null = null;

/** Load the no-bundler UMD distribution only when the public deployment capability says
 * voice exists. Games on deployments without LiveKit avoid downloading the media SDK. */
export function loadLiveKitClient(): Promise<boolean> {
	if (window.LivekitClient) return Promise.resolve(true);
	if (loading) return loading;
	loading = new Promise(resolve => {
		const script = document.createElement('script');
		script.src = 'libs/livekit-client.umd.js';
		script.async = true;
		script.addEventListener('load', () => resolve(!!window.LivekitClient), { once: true });
		script.addEventListener('error', () => resolve(false), { once: true });
		document.head.appendChild(script);
	});
	return loading;
}