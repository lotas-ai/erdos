#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function copyDirectoryRecursiveSync(source, destination) {
	if (!fs.existsSync(source)) {
		return;
	}
	fs.mkdirSync(destination, { recursive: true });

	const entries = fs.readdirSync(source, { withFileTypes: true });
	for (const entry of entries) {
		const srcPath = path.join(source, entry.name);
		const destPath = path.join(destination, entry.name);

		if (entry.isDirectory()) {
			copyDirectoryRecursiveSync(srcPath, destPath);
		} else if (entry.isSymbolicLink()) {
			try { fs.unlinkSync(destPath); } catch (error) {
				if (error.code !== 'ENOENT') {
					throw error;
				}
			}
			fs.symlinkSync(fs.readlinkSync(srcPath), destPath);
		} else {
			fs.copyFileSync(srcPath, destPath);
		}
	}
}

const extensionRoot = path.resolve(__dirname, '..');
const outDir = path.join(extensionRoot, 'out');
const distDir = path.join(extensionRoot, 'dist');
const distMain = path.join(distDir, 'src', 'main.js');

if (fs.existsSync(distMain)) {
	console.log('[quarto] dist/ already contains bundled output; leaving as-is.');
	process.exit(0);
}

if (!fs.existsSync(outDir)) {
	console.error('[quarto] Expected build output at', outDir);
	process.exit(1);
}

fs.rmSync(distDir, { recursive: true, force: true });
copyDirectoryRecursiveSync(outDir, distDir);
console.log('[quarto] dist/ missing, copied fallback from out/.');
