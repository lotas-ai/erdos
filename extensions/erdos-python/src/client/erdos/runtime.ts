/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as erdos from 'erdos';
import * as vscode from 'vscode';
import * as path from 'path';
import { RuntimeSession } from './session';
import { runtimeDiscoverer } from './discoverer';
import { IDiscoveryAPI } from '../pythonEnvironments/base/locator';
import { EXTENSION_ROOT_DIR } from '../constants';

export class LanguageManager implements erdos.LanguageRuntimeManager {
	private static _sessions: Map<string, RuntimeSession> = new Map();
	
	constructor(private readonly discoveryApi: IDiscoveryAPI) {
	}

	onDidDiscoverRuntime: vscode.Event<erdos.LanguageRuntimeMetadata> = () => ({ dispose: () => {} });
	
	static getSessionById(sessionId: string): RuntimeSession | undefined {
		return LanguageManager._sessions.get(sessionId);
	}

	discoverAllRuntimes(): AsyncGenerator<erdos.LanguageRuntimeMetadata> {
		return runtimeDiscoverer(this.discoveryApi);
	}

	registerLanguageRuntime(_runtime: erdos.LanguageRuntimeMetadata): void {
	}

	async recommendedWorkspaceRuntime(): Promise<erdos.LanguageRuntimeMetadata | undefined> {
		return undefined;
	}

	createSession(
		runtimeMetadata: erdos.LanguageRuntimeMetadata,
		sessionMetadata: erdos.RuntimeSessionMetadata): Thenable<erdos.LanguageRuntimeSession> {
		
		const extraData = runtimeMetadata.extraRuntimeData as any;
		const pythonPath = extraData?.pythonPath || runtimeMetadata.runtimePath;

		const pythonFilesPath = path.join(EXTENSION_ROOT_DIR, 'python_files');
		
		const kernelSpec = {
			argv: [
				pythonPath,
				'-m', 'lotas.erdos_websocket_language_server',
				'--websocket-port', '{websocket_port}',
				'--session-mode', sessionMetadata.sessionMode.toString()
			],
			display_name: runtimeMetadata.runtimeName,
			language: 'Python',
			env: {
				PYTHONPATH: pythonFilesPath
			}
		};
		
		const session = new RuntimeSession(runtimeMetadata, sessionMetadata, undefined, kernelSpec);
		
		// Store session so we can retrieve it later for completions
		LanguageManager._sessions.set(sessionMetadata.sessionId, session);
		
		return Promise.resolve(session);
	}

	async validateMetadata(metadata: erdos.LanguageRuntimeMetadata): Promise<erdos.LanguageRuntimeMetadata> {
		return Promise.resolve(metadata);
	}

	async validateSession(_sessionId: string): Promise<boolean> {
		return true;
	}

	restoreSession(
		runtimeMetadata: erdos.LanguageRuntimeMetadata,
		sessionMetadata: erdos.RuntimeSessionMetadata,
		sessionName: string): Thenable<erdos.LanguageRuntimeSession> {

		const session = new RuntimeSession(runtimeMetadata, sessionMetadata, sessionName);
		
		// Store session so we can retrieve it later for completions
		LanguageManager._sessions.set(sessionMetadata.sessionId, session);
		
		return Promise.resolve(session);
	}
}



