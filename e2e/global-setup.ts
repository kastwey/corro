import { execSync } from 'node:child_process';

// Preflight dependency check, run once before the suite. The E2E suite starts the REAL server with
// `dotnet run` (see playwright.config.ts webServer), so a missing or too-old .NET SDK would otherwise
// surface only as Playwright's 4-minute "web server timed out" — opaque to a newcomer. This is
// synchronous and fails in milliseconds, so it wins the race against the webServer timeout and turns
// a mystery hang into a clear, actionable error.
export default function globalSetup(): void {
	// Node: node:test's --import and Playwright itself need a modern runtime.
	const nodeMajor = Number(process.versions.node.split('.')[0]);
	if (nodeMajor < 20) {
		throw new Error(
			`\n[e2e preflight] Node ${process.versions.node} is too old — this suite needs Node 20 or newer.\n`,
		);
	}

	// .NET SDK: the webServer runs `dotnet run` against a net10.0 project.
	let sdks: string;
	try {
		sdks = execSync('dotnet --list-sdks', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
	} catch {
		throw new Error(
			'\n[e2e preflight] The .NET SDK was not found on PATH. The E2E suite starts the server with ' +
			'`dotnet run`.\nInstall the .NET 10 SDK from https://dot.net/download and re-run.\n',
		);
	}
	if (!/^10\./m.test(sdks)) {
		throw new Error(
			'\n[e2e preflight] No .NET 10 SDK found (the server targets net10.0). Installed SDKs:\n' +
			sdks + 'Install the .NET 10 SDK from https://dot.net/download and re-run.\n',
		);
	}
}
