/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILanguageRuntimeSession } from '../../../services/languageRuntime/common/languageRuntimeTypes.js';
import { ISessionManager } from '../../../services/languageRuntime/common/sessionManager.js';
import { IErdosVariablesService, IVariable } from '../common/variablesTypes.js';
import { VariablesClientManager } from './variablesClientManager.js';

export class VariablesService extends Disposable implements IErdosVariablesService {
	declare readonly _serviceBrand: undefined;

	private readonly _clientManager = this._register(new VariablesClientManager());

	private readonly _onDidChangeVariables = this._register(new Emitter<string>());
	readonly onDidChangeVariables: Event<string> = this._onDidChangeVariables.event;

	private readonly _onDidRegisterSession = this._register(new Emitter<string>());
	readonly onDidRegisterSession: Event<string> = this._onDidRegisterSession.event;

	private readonly _onDidUnregisterSession = this._register(new Emitter<string>());
	readonly onDidUnregisterSession: Event<string> = this._onDidUnregisterSession.event;

	constructor(
		@ISessionManager private readonly _sessionManager: ISessionManager
	) {
		super();

		// Listen for runtime sessions starting
		this._register(this._sessionManager.onDidStartSession((session: ILanguageRuntimeSession) => {
			this._attachToSession(session);
		}));

		// Listen for runtime sessions ending
		this._register(this._sessionManager.onDidEndSession((sessionId: string) => {
			this._clientManager.unregisterSession(sessionId);
		}));

		// Attach to any existing sessions
		const existingSessions = this._sessionManager.activeSessions;
		existingSessions.forEach((session: ILanguageRuntimeSession) => {
			this._attachToSession(session);
		});

		// Listen for client registration
		this._register(this._clientManager.onDidRegisterClient(sessionId => {
			this._onDidRegisterSession.fire(sessionId);
		}));

		// Listen for client unregistration
		this._register(this._clientManager.onDidUnregisterClient(sessionId => {
			this._onDidUnregisterSession.fire(sessionId);
		}));
	}

	private async _attachToSession(session: ILanguageRuntimeSession): Promise<void> {
		try {
			const client = await this._clientManager.registerSession(session);
			
			// Listen for variable changes from this client
			this._register(client.onDidChangeVariables((variables) => {
				this._onDidChangeVariables.fire(session.sessionId);
			}));
		} catch (e) {
			// Silently ignore errors
		}
	}

	getSessions(): string[] {
		return this._clientManager.getSessions();
	}

	getVariables(sessionId: string): IVariable[] {
		const client = this._clientManager.getClient(sessionId);
		return client?.getVariables() || [];
	}

	async inspectVariable(sessionId: string, path: string[]): Promise<IVariable[]> {
		const client = this._clientManager.getClient(sessionId);
		if (!client) {
			console.error('[VariablesService] inspectVariable: No client found for sessionId:', sessionId);
			return [];
		}
		const result = await client.inspectVariable(path);
		return result;
	}

	async viewVariable(sessionId: string, path: string[]): Promise<void> {
		const client = this._clientManager.getClient(sessionId);
		if (client) {
			await client.viewVariable(path);
		}
	}

	async clearVariables(sessionId: string, includeHidden: boolean): Promise<void> {
		const client = this._clientManager.getClient(sessionId);
		if (client) {
			await client.clearVariables(includeHidden);
		}
	}

	async deleteVariables(sessionId: string, names: string[]): Promise<void> {
		const client = this._clientManager.getClient(sessionId);
		if (client) {
			await client.deleteVariables(names);
		} else {
			console.error('[VariablesService] No client found for sessionId:', sessionId);
		}
	}

	getSessionDisplayName(sessionId: string): string {
		const client = this._clientManager.getClient(sessionId);
		if (!client) {
			return sessionId;
		}
		
		const session = client.session;
		const runtimeName = session.runtimeMetadata.runtimeName;
		const languageId = session.runtimeMetadata.languageId;
		
		// Return something like "Python (3.11)" or "R (4.3.1)"
		return `${languageId.charAt(0).toUpperCase()}${languageId.slice(1)} (${runtimeName})`;
	}

	getSessionLanguageId(sessionId: string): string | undefined {
		const client = this._clientManager.getClient(sessionId);
		return client?.session.runtimeMetadata.languageId;
	}

	override dispose(): void {
		this._clientManager.dispose();
		super.dispose();
	}
}

