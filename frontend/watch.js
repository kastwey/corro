// watch.js — complete frontend development watcher.
//
// TypeScript's watch API emits JS into dist/ in this process. Chokidar mirrors the static
// inputs (HTML, CSS, i18n, config and assets), including deletions. Development serves
// frontend/dist directly, so a browser refresh sees every frontend source change without
// rebuilding or restarting the .NET server.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const chokidar = require('chokidar');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const STATIC_INPUTS = [
	'src',
	'styles.css',
	'gameStatus.json',
	'assets',
	'css',
	'i18n',
];

/** Map one workspace-relative static source path to its dist-relative destination. */
function destinationFor(sourcePath) {
	const relative = sourcePath.replaceAll('\\', '/').replace(/^\.\//, '');
	if (/^src\/[^/]+\.html$/i.test(relative)) return path.posix.basename(relative);
	if (relative === 'styles.css' || relative === 'gameStatus.json') return relative;
	if (/^(assets|css|i18n)\//.test(relative)) return relative;
	return null;
}

function destinationPath(sourcePath) {
	const relative = destinationFor(sourcePath);
	return relative ? path.join(DIST, ...relative.split('/')) : null;
}

function mirrorFile(sourcePath) {
	const dest = destinationPath(sourcePath);
	if (!dest) return;
	fs.mkdirSync(path.dirname(dest), { recursive: true });
	fs.copyFileSync(path.join(ROOT, sourcePath), dest);
	console.log(`[frontend:watch] ${sourcePath} -> dist/${destinationFor(sourcePath)}`);
}

function removeOutput(sourcePath, recursive = false) {
	const dest = destinationPath(sourcePath);
	if (!dest) return;
	fs.rmSync(dest, { recursive, force: true });
	console.log(`[frontend:watch] removed dist/${destinationFor(sourcePath)}`);
}

function runInitialBuild() {
	console.log('[frontend:watch] Running initial frontend build...');
	const result = spawnSync(process.execPath, [path.join(ROOT, 'build.js')], {
		cwd: ROOT,
		stdio: 'inherit',
	});
	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}

function formatDiagnostic(diagnostic) {
	return ts.formatDiagnostic(diagnostic, {
		getCanonicalFileName: file => file,
		getCurrentDirectory: () => ROOT,
		getNewLine: () => ts.sys.newLine,
	});
}

function startTypeScriptWatch() {
	const configPath = ts.findConfigFile(ROOT, ts.sys.fileExists, 'tsconfig.json');
	if (!configPath) throw new Error('frontend/tsconfig.json was not found.');
	const host = ts.createWatchCompilerHost(
		configPath,
		{},
		ts.sys,
		ts.createEmitAndSemanticDiagnosticsBuilderProgram,
		diagnostic => console.error(formatDiagnostic(diagnostic)),
		diagnostic => console.log(formatDiagnostic(diagnostic).trim()),
	);
	return ts.createWatchProgram(host);
}

async function start() {
	if (!process.argv.includes('--skip-initial-build')) runInitialBuild();

	const tsWatcher = startTypeScriptWatch();
	const staticWatcher = chokidar.watch(STATIC_INPUTS, {
		cwd: ROOT,
		ignoreInitial: true,
		awaitWriteFinish: { stabilityThreshold: 75, pollInterval: 15 },
	});
	staticWatcher
		.on('add', mirrorFile)
		.on('change', mirrorFile)
		.on('unlink', source => removeOutput(source))
		.on('addDir', source => {
			const dest = destinationPath(source);
			if (dest) fs.mkdirSync(dest, { recursive: true });
		})
		.on('unlinkDir', source => removeOutput(source, true))
		.on('error', error => console.error('[frontend:watch] Static watcher error:', error));

	console.log('[frontend:watch] Watching TypeScript, HTML, CSS, i18n, config and assets. Refresh the browser after a change.');

	let closing = false;
	const close = async () => {
		if (closing) return;
		closing = true;
		tsWatcher.close();
		await staticWatcher.close();
		process.exit(0);
	};
	process.once('SIGINT', () => void close());
	process.once('SIGTERM', () => void close());
}

if (require.main === module) {
	start().catch(error => {
		console.error('[frontend:watch] Failed to start:', error);
		process.exit(1);
	});
}

module.exports = { destinationFor };
