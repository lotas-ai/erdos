/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as erdos from 'erdos';
import * as vscode from 'vscode';
import { RSession } from './session';
import { buildKernelSpec } from './config';
import { rRuntimeDiscoverer } from './discoverer';

export interface RMetadataExtra {
	readonly homepath: string;
	readonly binpath: string;
	readonly scriptpath: string;
}

export class RLanguageManager implements erdos.LanguageRuntimeManager {
	private static _sessions: Map<string, RSession> = new Map();

	constructor() {
	}

	static getSessionById(sessionId: string): RSession | undefined {
		return RLanguageManager._sessions.get(sessionId);
	}

	onDidDiscoverRuntime: vscode.Event<erdos.LanguageRuntimeMetadata> = () => ({ dispose: () => {} });

	discoverAllRuntimes(): AsyncGenerator<erdos.LanguageRuntimeMetadata> {
		return rRuntimeDiscoverer();
	}

	registerLanguageRuntime(_runtime: erdos.LanguageRuntimeMetadata): void {
	}

	async recommendedWorkspaceRuntime(): Promise<erdos.LanguageRuntimeMetadata | undefined> {
		return undefined;
	}

	createSession(
		runtimeMetadata: erdos.LanguageRuntimeMetadata,
		sessionMetadata: erdos.RuntimeSessionMetadata): Thenable<erdos.LanguageRuntimeSession> {

		const metadataExtra = runtimeMetadata.extraRuntimeData as RMetadataExtra;
		const kernelSpec = metadataExtra?.homepath 
			? buildKernelSpec(metadataExtra.homepath, runtimeMetadata.runtimeName, sessionMetadata.sessionMode)
			: undefined;

		const session = new RSession(runtimeMetadata, sessionMetadata, undefined, kernelSpec);
		RLanguageManager._sessions.set(sessionMetadata.sessionId, session);
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

		const metadataExtra = runtimeMetadata.extraRuntimeData as RMetadataExtra;
		const kernelSpec = metadataExtra?.homepath 
			? buildKernelSpec(metadataExtra.homepath, runtimeMetadata.runtimeName, sessionMetadata.sessionMode)
			: undefined;

		const session = new RSession(runtimeMetadata, sessionMetadata, sessionName, kernelSpec);
		RLanguageManager._sessions.set(sessionMetadata.sessionId, session);
		return Promise.resolve(session);
	}
}

