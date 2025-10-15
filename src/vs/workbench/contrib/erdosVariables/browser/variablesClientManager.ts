/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILanguageRuntimeSession } from '../../../services/languageRuntime/common/languageRuntimeTypes.js';
import { IVariable } from '../common/variablesTypes.js';

/**
 * Manages a variables client for a single runtime session
 */
export class VariablesClient extends Disposable {
	private _variables: IVariable[] = [];
	private _channel: any;
	private _channelId: string;
	private readonly _pendingRequests = new Map<string, { resolve: (value: any) => void; reject: (error: any) => void; timeout: any }>();
	
	private readonly _onDidChangeVariables = this._register(new Emitter<IVariable[]>());
	readonly onDidChangeVariables: Event<IVariable[]> = this._onDidChangeVariables.event;

	constructor(
		public readonly session: ILanguageRuntimeSession,
		channel: any
	) {
		super();
		this._channel = channel;
		// Runtime implementation uses clientId (camelCase), not client_id despite the TypeScript interface
		this._channelId = channel.clientId;
		this._setupListeners();
	}

	private _setupListeners(): void {
		// Subscribe to runtime messages to listen for comm_data responses
		this._register(this.session.onDidReceiveRuntimeMessage((msg: any) => {
			// Check for comm_data messages with our channel ID
			if (msg.type === 'comm_data' && msg.comm_id === this._channelId) {
				try {
					const data = msg.data;
					
					// Handle JSON-RPC 2.0 replies (responses to our requests)
					if (data?.jsonrpc === '2.0' && data?.id) {
						const pending = this._pendingRequests.get(data.id);
						if (pending) {
							clearTimeout(pending.timeout);
							this._pendingRequests.delete(data.id);
							
							if (data.error) {
								pending.reject(new Error(data.error.message || JSON.stringify(data.error)));
							} else {
								pending.resolve(data.result);
							}
						}
					}
					
					// Handle unsolicited events (refresh, update)
					if (data.method === 'refresh') {
						// Full refresh of variables
						const params = data.params;
						this._variables = params.variables || [];
						this._onDidChangeVariables.fire(this._variables);
					} else if (data.method === 'update') {
						// Incremental update
						const params = data.params;
						
						// Remove deleted variables
						if (params.removed && params.removed.length > 0) {
							this._variables = this._variables.filter(v => 
								!params.removed.includes(v.access_key)
							);
						}
						
						// Update or add assigned variables
						if (params.assigned && params.assigned.length > 0) {
							params.assigned.forEach((newVar: IVariable) => {
								const existingIndex = this._variables.findIndex(v => 
									v.access_key === newVar.access_key
								);
								if (existingIndex >= 0) {
									this._variables[existingIndex] = newVar;
								} else {
									this._variables.push(newVar);
								}
							});
						}
						
						this._onDidChangeVariables.fire(this._variables);
					}
				} catch (e) {
					// Silently ignore errors in message processing
				}
			}
		}));
	}

	getVariables(): IVariable[] {
		return this._variables;
	}

	private _sendRequest(method: string, params: any, timeoutMs: number = 30000): Promise<any> {
		return new Promise((resolve, reject) => {
			const requestId = Math.random().toString(36).substring(7);
			
			const timeout = setTimeout(() => {
				this._pendingRequests.delete(requestId);
				reject(new Error(`Request ${method} timed out after ${timeoutMs}ms`));
			}, timeoutMs);
			
			this._pendingRequests.set(requestId, { resolve, reject, timeout });
			
			// Use JSON-RPC 2.0 format (required by ark comm handler)
			const request = {
				jsonrpc: '2.0',
				id: requestId,
				method,
				params
			};
			
			// Send via the channel's send method
			this._channel.send(request);
		});
	}

	/**
	 * Unwrap adjacently-tagged enum response from backend.
	 * Both Ark (R) and Python return: { method: "InspectReply", result: { actual data } }
	 * This extracts the inner result.
	 */
	private _unwrapResponse(response: any): any {
		if (!response || typeof response !== 'object') {
			throw new Error('Invalid response: expected object');
		}
		if (!response.result) {
			throw new Error('Invalid response format: missing result wrapper');
		}
		return response.result;
	}

	async inspectVariable(path: string[]): Promise<IVariable[]> {
		try {
			const result = await this._sendRequest('inspect', { path });
			const unwrapped = this._unwrapResponse(result);
			const children = unwrapped.children || [];
			return children;
		} catch (e) {
			return [];
		}
	}

	async viewVariable(path: string[]): Promise<void> {
		try {
			await this._sendRequest('view', { path });
		} catch (e) {
			// Silently ignore errors
		}
	}

	async clearVariables(includeHidden: boolean): Promise<void> {
		try {
			await this._sendRequest('clear', { include_hidden_objects: includeHidden });
		} catch (e) {
			// Silently ignore errors
		}
	}

	async deleteVariables(names: string[]): Promise<void> {
		try {
			await this._sendRequest('delete', { names });
		} catch (e) {
			// Silently ignore errors
		}
	}

	override dispose(): void {
		// Clear all pending requests
		for (const [, pending] of this._pendingRequests.entries()) {
			clearTimeout(pending.timeout);
			pending.reject(new Error('Client disposed'));
		}
		this._pendingRequests.clear();
		super.dispose();
	}
}

/**
 * Manages VariablesClient instances for multiple runtime sessions
 */
export class VariablesClientManager extends Disposable {
	private readonly _clients = new Map<string, VariablesClient>();

	private readonly _onDidRegisterClient = this._register(new Emitter<string>());
	readonly onDidRegisterClient: Event<string> = this._onDidRegisterClient.event;

	private readonly _onDidUnregisterClient = this._register(new Emitter<string>());
	readonly onDidUnregisterClient: Event<string> = this._onDidUnregisterClient.event;

	async registerSession(session: ILanguageRuntimeSession): Promise<VariablesClient> {
		const sessionId = session.sessionId;

		// Dispose existing client if any
		if (this._clients.has(sessionId)) {
			this._clients.get(sessionId)!.dispose();
		}

		// Get or create a variables channel
		const existingChannels = await session.listClients('variables');
		
		let channel;
		if (existingChannels.length > 0) {
			channel = existingChannels[existingChannels.length - 1];
		} else {
			channel = await session.createClient('variables', {});
		}

		const client = new VariablesClient(session, channel);
		this._clients.set(sessionId, client);
		this._onDidRegisterClient.fire(sessionId);
		
		return client;
	}

	unregisterSession(sessionId: string): void {
		const client = this._clients.get(sessionId);
		if (client) {
			client.dispose();
			this._clients.delete(sessionId);
			this._onDidUnregisterClient.fire(sessionId);
		}
	}

	override dispose(): void {
		for (const client of this._clients.values()) {
			client.dispose();
		}
		this._clients.clear();
		super.dispose();
	}

	getClient(sessionId: string): VariablesClient | undefined {
		return this._clients.get(sessionId);
	}

	getSessions(): string[] {
		return Array.from(this._clients.keys());
	}
}
