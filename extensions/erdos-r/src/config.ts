/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as erdos from 'erdos';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

interface KernelSpec {
	argv: string[];
	display_name: string;
	language: string;
	interrupt_mode?: string;
	env?: Record<string, string>;
	kernel_protocol_version: string;
}

export function buildKernelSpec(
	rHomePath: string,
	runtimeName: string,
	sessionMode: erdos.LanguageRuntimeSessionMode
): KernelSpec {
	const kernelPath = getArkPath();
	if (!kernelPath) {
		throw new Error('Unable to find R kernel');
	}

	const config = vscode.workspace.getConfiguration('erdos.r');
	const logLevel = config.get<string>('kernel.logLevel') ?? 'warn';
	const logLevelForeign = config.get<string>('kernel.logLevelExternal') ?? 'warn';
	const userEnv = config.get<object>('kernel.env') ?? {};
	const profile = config.get<string>('kernel.profile');

	const env = <Record<string, string>>{
		'RUST_BACKTRACE': '1',
		'RUST_LOG': logLevelForeign + ',ark=' + logLevel,
		'R_HOME': rHomePath,
		...userEnv
	};

	if (profile) {
		env['ARK_PROFILE'] = profile;
	}

	if (process.platform === 'linux') {
		env['LD_LIBRARY_PATH'] = rHomePath + '/lib';
	} else if (process.platform === 'darwin') {
		env['DYLD_LIBRARY_PATH'] = rHomePath + '/lib';
	}

	const argv = [
		kernelPath,
		'--websocket-port', '{websocket_port}',
		'--log', '{log_file}',
		'--session-mode', `${sessionMode}`,
	];

	if (profile) {
		argv.push('--profile', '{profile_file}');
	}

	const defaultRepos = config.get<string>('defaultRepositories') ?? 'auto';
	if (defaultRepos === 'auto') {
		const reposConf = findReposConf();
		if (reposConf) {
			argv.push('--repos-conf', reposConf);
		} else if (vscode.env.uiKind === vscode.UIKind.Web) {
			argv.push('--default-repos', 'posit-ppm');
		}
	} else {
		argv.push('--default-repos', defaultRepos);
	}

	argv.push('--', '--interactive');

	const kernelSpec: KernelSpec = {
		'argv': argv,
		'display_name': runtimeName,
		'language': 'R',
		'env': env,
		'kernel_protocol_version': '5.5'
	};

	if (!config.get<boolean>('restoreWorkspace')) {
		kernelSpec.argv.push('--no-restore-data');
	}

	const extraArgs = config.get<Array<string>>('extraArguments');
	const quietMode = config.get<boolean>('quietMode');
	if (quietMode && extraArgs?.indexOf('--quiet') === -1) {
		extraArgs?.push('--quiet');
	}
	if (extraArgs) {
		kernelSpec.argv.push(...extraArgs);
	}

	return kernelSpec;
}

function getArkPath(): string | undefined {
	const arkConfig = vscode.workspace.getConfiguration('erdos.r');
	const kernelPath = arkConfig.get<string>('kernel.path');
	if (kernelPath) {
		return kernelPath;
	}

	const kernelName = os.platform() === 'win32' ? 'ark.exe' : 'ark';
	const extensionPath = path.join(__dirname, '..');
	
	// Check for development build
	const erdosParent = path.dirname(path.dirname(path.dirname(extensionPath)));
	const devDebugKernel = path.join(erdosParent, 'ark', 'target', 'debug', kernelName);
	const devReleaseKernel = path.join(erdosParent, 'ark', 'target', 'release', kernelName);
	
	let debugModified: Date | null = null;
	let releaseModified: Date | null = null;
	
	try {
		if (fs.existsSync(devDebugKernel)) {
			debugModified = fs.statSync(devDebugKernel).mtime;
		}
	} catch (err) {
		// Ignore
	}
	
	try {
		if (fs.existsSync(devReleaseKernel)) {
			releaseModified = fs.statSync(devReleaseKernel).mtime;
		}
	} catch (err) {
		// Ignore
	}

	let devKernel = undefined;
	if (debugModified && releaseModified) {
		devKernel = releaseModified > debugModified ? devReleaseKernel : devDebugKernel;
	} else if (debugModified) {
		devKernel = devDebugKernel;
	} else if (releaseModified) {
		devKernel = devReleaseKernel;
	}
	
	if (devKernel) {
		return devKernel;
	}

	// Fallback to embedded binary
	const embeddedKernel = path.join(extensionPath, 'resources', 'ark', kernelName);
	if (fs.existsSync(embeddedKernel)) {
		return embeddedKernel;
	}

	return undefined;
}

function findReposConf(): string | undefined {
	const xdg = require('xdg-portable/cjs');
	const configDirs: Array<string> = xdg.configDirs();
	for (const product of ['rstudio', 'erdos']) {
		for (const configDir of configDirs) {
			const reposConf = path.join(configDir, product, 'repos.conf');
			if (fs.existsSync(reposConf)) {
				return reposConf;
			}
		}
	}
	return undefined;
}

