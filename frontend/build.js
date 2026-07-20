// build.js - Custom build script that compiles TypeScript and copies assets.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Starting build...');

// 1. Rebuild dist from a clean slate. TypeScript does not delete emitted JS when its source
// disappears, so without this an orphaned module can keep shipping indefinitely.
if (fs.existsSync('dist')) {
	fs.rmSync('dist', { recursive: true, force: true });
}
fs.mkdirSync('dist', { recursive: true });

// 2. Compile TypeScript.
console.log('Compiling TypeScript...');
try {
	execSync('npx tsc', { stdio: 'inherit' });
	console.log('TypeScript compiled successfully.');
} catch (error) {
	console.error('TypeScript compilation failed:', error.message);
	process.exit(1);
}

// 3. Copy files recursively.
function copyRecursive(src, dest) {
	const stats = fs.statSync(src);
	
	if (stats.isDirectory()) {
		// Create the destination directory when needed.
		if (!fs.existsSync(dest)) {
			fs.mkdirSync(dest, { recursive: true });
		}
		
		// Copy the directory contents.
		const files = fs.readdirSync(src);
		files.forEach(file => {
			const srcPath = path.join(src, file);
			const destPath = path.join(dest, file);
			copyRecursive(srcPath, destPath);
		});
	} else {
		// Copy one file.
		const destDir = path.dirname(dest);
		if (!fs.existsSync(destDir)) {
			fs.mkdirSync(destDir, { recursive: true });
		}
		fs.copyFileSync(src, dest);
	}
}

// 4. Copy assets.
console.log('Copying assets...');
try {
	const assetsDir = 'assets';
	const distAssetsDir = path.join('dist', 'assets');
	
	if (fs.existsSync(assetsDir)) {
		copyRecursive(assetsDir, distAssetsDir);
		console.log('Assets copied to dist/assets/.');
		
		// List copied files.
		const files = fs.readdirSync(distAssetsDir, { recursive: true });
		files.forEach(file => {
			console.log(`   ${file}`);
		});
	} else {
		console.log('Assets folder not found; skipping.');
	}
} catch (error) {
	console.error('Failed to copy assets:', error.message);
	process.exit(1);
}

// 5. Copy primary web files (HTML and CSS).
console.log('Copying web files...');
const webFiles = [
	{ src: 'src/index.html', dest: 'dist/index.html' },
	{ src: 'src/board.html', dest: 'dist/board.html' },
	{ src: 'styles.css', dest: 'dist/styles.css' }
];

webFiles.forEach(({ src, dest }) => {
	if (fs.existsSync(src)) {
		try {
			const destDir = path.dirname(dest);
			if (!fs.existsSync(destDir)) {
				fs.mkdirSync(destDir, { recursive: true });
			}
			fs.copyFileSync(src, dest);
			console.log(`   ${src} -> ${dest}`);
		} catch (error) {
			console.log(`   Failed to copy ${src}:`, error.message);
		}
	} else {
		console.log(`   ${src} not found; skipping.`);
	}
});

// 6. Copy JSON configuration files.
console.log('Copying configuration files...');
// keymap.json now lives on the server (served at /api/config/keymap as the single source of truth).
const configFiles = ['gameStatus.json'];
configFiles.forEach(file => {
	if (fs.existsSync(file)) {
		try {
			fs.copyFileSync(file, path.join('dist', file));
			console.log(`   ${file} -> dist/${file}`);
		} catch (error) {
			console.log(`   Failed to copy ${file}:`, error.message);
		}
	} else {
		console.log(`   ${file} not found; skipping.`);
	}
});

// 7. Copy additional directories.
const additionalDirs = ['i18n', 'css'];
additionalDirs.forEach(dir => {
	if (fs.existsSync(dir)) {
		try {
			copyRecursive(dir, path.join('dist', dir));
			console.log(`   ${dir}/ -> dist/${dir}/`);
		} catch (error) {
			console.log(`   Failed to copy ${dir}:`, error.message);
		}
	} else {
		console.log(`   ${dir}/ not found; skipping.`);
	}
});

// 8. Copy browser dependencies from node_modules.
console.log('Copying browser dependencies...');
const libsDir = path.join('dist', 'libs');
if (!fs.existsSync(libsDir)) {
	fs.mkdirSync(libsDir, { recursive: true });
}

// Copy i18next.
const i18nextSrc = path.join('node_modules', 'i18next', 'dist', 'umd', 'i18next.min.js');
const i18nextDest = path.join(libsDir, 'i18next.min.js');
if (fs.existsSync(i18nextSrc)) {
	try {
		fs.copyFileSync(i18nextSrc, i18nextDest);
		console.log(`   i18next -> dist/libs/i18next.min.js`);
	} catch (error) {
		console.log(`   Failed to copy i18next:`, error.message);
	}
} else {
	console.log('   i18next not found in node_modules; skipping.');
}

// Copy SignalR.
const signalRSrc = path.join('node_modules', '@microsoft', 'signalr', 'dist', 'browser', 'signalr.min.js');
const signalRDest = path.join(libsDir, 'signalr.min.js');
if (fs.existsSync(signalRSrc)) {
	try {
		fs.copyFileSync(signalRSrc, signalRDest);
		console.log(`   SignalR -> dist/libs/signalr.min.js`);
	} catch (error) {
		console.log(`   Failed to copy SignalR:`, error.message);
	}
} else {
	console.log('   SignalR not found in node_modules; skipping.');
}

console.log('Build completed successfully.');
console.log('Run "node serve.js" to try the application.');
