/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as erdos from 'erdos';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { PythonEnvInfo, PythonEnvKind } from '../pythonEnvironments/base/info';
import { IDiscoveryAPI } from '../pythonEnvironments/base/locator';
import { EXTENSION_ROOT_DIR } from '../constants';

interface IpykernelBundle {
	disabledReason?: string;
	paths?: string[];
}

export interface RuntimeExtraData {
	pythonPath: string;
	ipykernelBundle: IpykernelBundle;
	supported: boolean;
	environmentType: string;
	environmentName?: string;
	environmentPath?: string;
	sysPrefix?: string;
}

export async function* runtimeDiscoverer(
	discoveryApi: IDiscoveryAPI
): AsyncGenerator<erdos.LanguageRuntimeMetadata> {
	try {
		await discoveryApi.triggerRefresh();
		
		const pythonEnvs = discoveryApi.getEnvs();
		
		for (const env of pythonEnvs) {
			try {
				const metadata = await createRuntimeMetadata(env);
				yield metadata;
			} catch (err) {
				console.error(`[DISCOVERER] Failed to create runtime for Python at ${env.executable.filename}:`, err);
			}
		}
	} catch (err) {
		console.error('[DISCOVERER] Discovery failed:', err);
	}
}

async function createRuntimeMetadata(env: PythonEnvInfo): Promise<erdos.LanguageRuntimeMetadata> {
	const executable = env.executable.filename;
	const sysPrefix = env.executable.sysPrefix || path.dirname(path.dirname(executable));
	
	const fullSysVersion = env.version?.sysVersion || '';
	const versionNumber = `${env.version?.major || 0}.${env.version?.minor || 0}.${env.version?.micro || 0}`;
	
	const digest = crypto.createHash('sha256');
	digest.update(executable);
	digest.update(fullSysVersion || versionNumber);
	const runtimeId = digest.digest('hex').substring(0, 32);
	
	const envKindStr = getEnvKindDisplayName(env.kind);
	let runtimeShortName = versionNumber;
	if (env.name) {
		runtimeShortName += ` (${env.name})`;
	} else if (envKindStr && envKindStr !== 'Unknown') {
		runtimeShortName += ` (${envKindStr})`;
	}
	
	const runtimeName = `Python ${runtimeShortName}`;
	
	const homedir = os.homedir();
	const runtimePath = os.platform() !== 'win32' && sysPrefix.startsWith(homedir)
		? path.join('~', sysPrefix.substring(homedir.length))
		: sysPrefix;
	
	const extensionRoot = EXTENSION_ROOT_DIR;
	const arch = os.arch();
	const cpxSpecifier = `cp${env.version?.major || 3}${env.version?.minor || 11}`;
	const ipykernelBundlePaths = [
		path.join(extensionRoot, 'python_files', 'lib', 'ipykernel', arch, cpxSpecifier),
		path.join(extensionRoot, 'python_files', 'lib', 'ipykernel', arch, 'cp3'),
		path.join(extensionRoot, 'python_files', 'lib', 'ipykernel', 'py3'),
	];
	
	const extraRuntimeData: RuntimeExtraData = {
		pythonPath: executable,
		ipykernelBundle: {
			paths: ipykernelBundlePaths
		},
		supported: true,
		environmentType: getEnvKindDisplayName(env.kind),
		environmentName: env.name,
		environmentPath: env.location,
		sysPrefix: sysPrefix
	};
	
	const metadata: erdos.LanguageRuntimeMetadata = {
		runtimeId,
		runtimeName,
		runtimeShortName,
		runtimePath,
		runtimeVersion: versionNumber,
		runtimeSource: getRuntimeSource(env.kind),
		languageId: 'python',
		languageName: 'Python',
		languageVersion: versionNumber,
		startupBehavior: erdos.LanguageRuntimeStartupBehavior.Implicit,
		sessionLocation: erdos.LanguageRuntimeSessionLocation.Workspace,
		extraRuntimeData
	};
	
	return metadata;
}

function getEnvKindDisplayName(kind: PythonEnvKind): string {
	switch (kind) {
		case PythonEnvKind.Conda:
			return 'Conda';
		case PythonEnvKind.Venv:
		case PythonEnvKind.VirtualEnv:
		case PythonEnvKind.VirtualEnvWrapper:
		case PythonEnvKind.Pipenv:
		case PythonEnvKind.Poetry:
		case PythonEnvKind.Pyenv:
		case PythonEnvKind.Hatch:
		case PythonEnvKind.Pixi:
		case PythonEnvKind.ActiveState:
			return 'VirtualEnvironment';
		case PythonEnvKind.MicrosoftStore:
		case PythonEnvKind.System:
		case PythonEnvKind.OtherGlobal:
		default:
			return 'Unknown';
	}
}

function getRuntimeSource(kind: PythonEnvKind): string {
	switch (kind) {
		case PythonEnvKind.Conda:
			return 'Conda';
		case PythonEnvKind.Venv:
		case PythonEnvKind.VirtualEnv:
		case PythonEnvKind.VirtualEnvWrapper:
			return 'Venv';
		case PythonEnvKind.Pipenv:
			return 'Pipenv';
		case PythonEnvKind.Poetry:
			return 'Poetry';
		case PythonEnvKind.Pyenv:
			return 'Pyenv';
		case PythonEnvKind.Hatch:
			return 'Hatch';
		case PythonEnvKind.Pixi:
			return 'Pixi';
		case PythonEnvKind.ActiveState:
			return 'ActiveState';
		case PythonEnvKind.MicrosoftStore:
			return 'Microsoft Store';
		case PythonEnvKind.System:
		case PythonEnvKind.OtherGlobal:
		default:
			return 'System';
	}
}
