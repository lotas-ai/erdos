/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as erdos from 'erdos';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const platform = os.platform();
const isWindows = platform === 'win32';
const isMac = platform === 'darwin';
const isLinux = platform === 'linux';

function normalizeHomePath(home: string): string {
	const resolved = path.resolve(home);
	return isWindows ? resolved.toLowerCase() : resolved;
}

export interface RInstallation {
	rExecutable: string;
	rHome: string;
	version: string;
	arch?: string;
}

export interface RRuntimeExtraData {
	homepath: string;
	binpath: string;
	scriptpath: string;
}

export async function* rRuntimeDiscoverer(): AsyncGenerator<erdos.LanguageRuntimeMetadata> {
	try {
		const rInstallations = await findRInstallations();
		
		for (const installation of rInstallations) {
			try {
				const metadata = await createRRuntimeMetadata(installation);
				yield metadata;
			} catch (err) {
				// Silently skip installations that fail
			}
		}
	} catch (err) {
		// Silently handle discovery failures
	}
}

async function findRInstallations(): Promise<RInstallation[]> {
	const installations: RInstallation[] = [];

	const seenHomes = new Set<string>();

	const addInstallation = async (candidatePath: string | undefined) => {
		if (!candidatePath) {
			return;
		}

		try {
			const installation = await getRInstallationInfo(candidatePath);
			if (installation) {
				const homeKey = normalizeHomePath(installation.rHome);
				if (!seenHomes.has(homeKey)) {
					installations.push(installation);
					seenHomes.add(homeKey);
				}
			}
		} catch {
			// Ignore invalid candidates
		}
	};

	const scanVersionedInstallations = async (rootPath: string | undefined) => {
		if (!rootPath) {
			return;
		}

		try {
			const stat = await fs.promises.stat(rootPath);
			if (stat.isDirectory()) {
				await addInstallation(rootPath);
				const entries = await fs.promises.readdir(rootPath);
				for (const entry of entries) {
					await addInstallation(path.join(rootPath, entry));
				}
			} else if (stat.isFile()) {
				await addInstallation(rootPath);
			}
		} catch {
			// Ignore missing directories
		}
	};

	// Check custom R binaries from configuration
	const config = vscode.workspace.getConfiguration('erdos.r');
	const customBinaries = config.get<string[]>('customBinaries') || [];

	for (const customPath of customBinaries) {
		await addInstallation(customPath);
	}

	// Try to find R in PATH
	try {
		const whichCommand = isWindows ? 'where R' : 'which R';
		const { stdout } = await execAsync(whichCommand);
		const candidates = stdout
			.split(/\r?\n/)
			.map(line => line.trim())
			.filter(line => line && !line.startsWith('INFO:'));

		for (const candidate of candidates) {
			await addInstallation(candidate);
		}
	} catch (err) {
		// R not in PATH
	}

	// Platform-specific search paths
	if (isMac) {
		// macOS: Check /Library/Frameworks/R.framework
		const frameworkPath = '/Library/Frameworks/R.framework';
		if (fs.existsSync(frameworkPath)) {
			const versionsPath = path.join(frameworkPath, 'Versions');
			if (fs.existsSync(versionsPath)) {
				try {
					const versions = await fs.promises.readdir(versionsPath);
					for (const version of versions) {
						if (version === 'Current') {
							continue;
						}

						await addInstallation(path.join(versionsPath, version));
					}
				} catch {
					// Ignore errors reading framework versions
				}
			}
		}
	} else if (isWindows) {
		// Windows: Check Program Files
		const programFilesRoots = [
			process.env['ProgramFiles'],
			process.env['ProgramFiles(x86)']
		].filter(Boolean) as string[];

		for (const base of programFilesRoots) {
			await scanVersionedInstallations(path.join(base, 'R'));
		}

		const additionalRoots = [
			'C:\\Program Files\\R',
			'C:\\Program Files (x86)\\R'
		];

		for (const root of additionalRoots) {
			await scanVersionedInstallations(root);
		}
	} else if (isLinux) {
		// Linux: Check common locations
		const linuxExecutables = [
			'/usr/bin/R',
			'/usr/local/bin/R'
		];

		for (const executable of linuxExecutables) {
			await addInstallation(executable);
		}

		const linuxRoots = [
			'/opt/R',
			'/usr/lib/R'
		];

		for (const root of linuxRoots) {
			await scanVersionedInstallations(root);
		}
	}

	return installations;
}

async function getRInstallationInfo(rExecutable: string): Promise<RInstallation | null> {
	try {
		const executablePath = await resolveRExecutable(rExecutable);
		if (!executablePath) {
			return null;
		}

		// Get R_HOME
		const { stdout: rHomeOutput } = await execAsync(`"${executablePath}" RHOME`);
		const rHome = rHomeOutput.trim();
		
		if (!rHome || !fs.existsSync(rHome)) {
			return null;
		}
		
		// Get R version
		const { stdout: versionOutput } = await execAsync(`"${executablePath}" --version`);
		const versionMatch = versionOutput.match(/R version ([0-9]+\.[0-9]+\.[0-9]+)/);
		const version = versionMatch ? versionMatch[1] : 'Unknown';
		
		// Get architecture if available
		const { stdout: archOutput } = await execAsync(`"${executablePath}" --slave -e "cat(R.version$arch)"`).catch(() => ({ stdout: '' }));
		const arch = archOutput.trim() || undefined;
		
		return {
			rExecutable: executablePath,
			rHome,
			version,
			arch
		};
	} catch (err) {
		return null;
	}
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		const stat = await fs.promises.stat(filePath);
		return stat.isFile();
	} catch {
		return false;
	}
}

async function resolveRExecutable(candidatePath: string): Promise<string | null> {
	if (!candidatePath) {
		return null;
	}

	const normalized = path.resolve(candidatePath);

	try {
		const stat = await fs.promises.stat(normalized);

		if (stat.isFile()) {
			const baseName = path.basename(normalized).toLowerCase();

			if ((isWindows && baseName === 'r.exe') || (!isWindows && baseName === 'r')) {
				return normalized;
			}

			if ((isWindows && baseName === 'rscript.exe') || (!isWindows && baseName === 'rscript')) {
				const sibling = path.join(path.dirname(normalized), isWindows ? 'R.exe' : 'R');
				if (await fileExists(sibling)) {
					return sibling;
				}
			}

			return null;
		}

		if (!stat.isDirectory()) {
			return null;
		}

		const candidateDirectories = new Set<string>();
		candidateDirectories.add(normalized);

		let current = normalized;
		for (let i = 0; i < 3; i++) {
			const parent = path.dirname(current);
			if (!parent || parent === current) {
				break;
			}
			candidateDirectories.add(parent);
			current = parent;
		}

		const suffixes = [
			'',
			'bin',
			path.join('bin', 'x64'),
			path.join('bin', 'x86_64'),
			path.join('bin', 'amd64'),
			'bin64',
			path.join('lib', 'R', 'bin'),
			path.join('Resources', 'bin'),
			path.join('R', 'bin')
		];

		const executableName = isWindows ? 'R.exe' : 'R';

		for (const baseDir of candidateDirectories) {
			for (const suffix of suffixes) {
				const dirToCheck = suffix ? path.join(baseDir, suffix) : baseDir;
				const executableCandidate = path.join(dirToCheck, executableName);
				if (await fileExists(executableCandidate)) {
					return executableCandidate;
				}
			}
		}
	} catch {
		// Ignore invalid paths
	}

	return null;
}

async function createRRuntimeMetadata(installation: RInstallation): Promise<erdos.LanguageRuntimeMetadata> {
	const { rExecutable, rHome, version, arch } = installation;
	
	// Create runtime ID from R_HOME and version
	const digest = crypto.createHash('sha256');
	digest.update(rHome);
	digest.update(version);
	const runtimeId = digest.digest('hex').substring(0, 32);
	
	// Create display name
	let runtimeShortName = version;
	if (arch) {
		runtimeShortName += ` (${arch})`;
	}
	const runtimeName = `R ${runtimeShortName}`;
	
	// Simplify path for display
	const homedir = os.homedir();
	const runtimePath = os.platform() !== 'win32' && rHome.startsWith(homedir)
		? path.join('~', rHome.substring(homedir.length))
		: rHome;
	
	const extraRuntimeData: RRuntimeExtraData = {
		homepath: rHome,
		binpath: path.dirname(rExecutable),
		scriptpath: rExecutable
	};
	
	const metadata: erdos.LanguageRuntimeMetadata = {
		runtimeId,
		runtimeName,
		runtimeShortName,
		runtimePath,
		runtimeVersion: version,
		runtimeSource: 'System',
		languageId: 'r',
		languageName: 'R',
		languageVersion: version,
		startupBehavior: erdos.LanguageRuntimeStartupBehavior.Implicit,
		sessionLocation: erdos.LanguageRuntimeSessionLocation.Workspace,
		extraRuntimeData
	};
	
	return metadata;
}
