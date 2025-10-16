/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * RuntimeQueryHandler - JSON-RPC Communication with Kernel Comm Channels
 * 
 * This handler enables structured communication with language kernels (R/Python) via JSON-RPC
 * over Jupyter comm channels. It provides help, function parsing, and search capabilities.
 * 
 * ## Protocol Flow
 * 
 * 1. **Channel Creation** (Frontend)
 *    - Call `session.createClient('help', {})` to open a comm channel
 *    - Kernel receives `comm_open` message with target_name='help'
 * 
 * 2. **Request/Response** (Frontend → Kernel)
 *    - Send JSON-RPC request via `channel.send()`:
 *      ```json
 *      {
 *        "jsonrpc": "2.0",
 *        "id": "abc123",
 *        "method": "show_help_topic",
 *        "params": { "topic": "print" }
 *      }
 *      ```
 *    - Kernel processes via `comm_msg` handler
 *    - Kernel responds with JSON-RPC reply:
 *      ```json
 *      {
 *        "jsonrpc": "2.0",
 *        "id": "abc123",
 *        "result": true
 *      }
 *      ```
 * 
 * 3. **Events** (Kernel → Frontend)
 *    - Kernel can send notifications without request ID:
 *      ```json
 *      {
 *        "method": "show_help",
 *        "params": { "content": "<html>...", "kind": "html", "focus": true }
 *      }
 *      ```
 * 
 * ## Kernel-Side Implementation
 * 
 * ### R (ark/crates/ark/src/help/r_help.rs)
 * - `handle_comm_open_help()` creates RHelp handler
 * - Listens for JSON-RPC requests on comm channel
 * - Supports methods:
 *   - `show_help_topic`: Calls `.ps.help.showHelpTopic(topic)`
 *   - `parse_functions`: Calls `.ps.rpc.parse_functions(code, language)`
 *   - `search_help_topics`: Calls `.ps.rpc.searchHelpTopics(query)`
 * 
 * ### Python (kallichore or similar)
 * - Should implement similar comm handler for 'help' target
 * - Process JSON-RPC requests and call appropriate Python functions
 * - Example methods:
 *   - `show_help_topic`: Use `help()` or `pydoc`
 *   - `parse_functions`: Use `ast.parse()` to extract function calls
 *   - `search_help_topics`: Search available modules/functions
 */

import { Disposable, type IDisposable } from '../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../base/common/event.js';
import { type ILanguageRuntimeSession } from './languageRuntimeTypes.js';
import { type IDirectKernelClient } from './languageRuntimeMessageTypes.js';

export interface FunctionParseResult {
	functions: Array<string>;
	success: boolean;
	error?: string;
}

export interface HelpContentEvent {
	content: string;
	kind: 'html' | 'markdown' | 'url';
	focus: boolean;
}

export class RuntimeQueryHandler extends Disposable {
	private readonly _helpEmitter = new Emitter<HelpContentEvent>();
	private readonly _closeEmitter = new Emitter<void>();
	private readonly _pendingRequests = new Map<string, { resolve: (value: any) => void; reject: (error: any) => void; timeout: any }>();
	private _messageListener: IDisposable | undefined;
	private _channel: IDirectKernelClient | undefined;
	private _channelId: string;

	readonly onDidEmitHelpContent = this._helpEmitter.event;
	readonly onDidClose = this._closeEmitter.event;

	constructor(
		private readonly _session: ILanguageRuntimeSession,
		channel: IDirectKernelClient,
		readonly languageId: string,
		readonly sessionId: string
	) {
		super();
		this._channel = channel;
		// Handle both clientId (camelCase) and client_id (snake_case)
		this._channelId = (channel as { client_id?: string }).client_id || (channel as { clientId?: string }).clientId || '';

		// Listen for JSON-RPC responses from the kernel
		this._messageListener = this._session.onDidReceiveRuntimeMessage((msg: any) => {
			// Check for comm_data responses with our channel ID
			// Note: Jupyter wire protocol uses 'comm_msg', but erdos standardizes to 'comm_data'
			if (msg.type === 'comm_data' && msg.comm_id === this._channelId) {
				const data = msg.data;
				
				// Handle JSON-RPC response
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
				
				// Handle event notifications (no id, just method)
				if (data?.method === 'show_help' && data?.params) {
					this._helpEmitter.fire({
						content: data.params.content || '',
						kind: data.params.kind || 'html',
						focus: data.params.focus !== false
					});
				}
			}
		});
	}

	private async sendRequest(method: string, params: any, timeoutMs: number = 5000): Promise<any> {
		if (!this._channel) {
			throw new Error('Channel not available');
		}

		const requestId = Math.random().toString(36).substring(7);
		
		return new Promise((resolve, reject) => {
			const timeoutHandle = setTimeout(() => {
				this._pendingRequests.delete(requestId);
				reject(new Error(`Request timed out after ${timeoutMs}ms`));
			}, timeoutMs);

			this._pendingRequests.set(requestId, { resolve, reject, timeout: timeoutHandle });

			const request = {
				jsonrpc: '2.0',
				id: requestId,
				method,
				params
			};
			this._channel!.send(request);
		});
	}

	async showHelpTopic(topic: string): Promise<boolean> {
		const result = await this.sendRequest('show_help_topic', { topic });
		
		// Check if the backend returns a nested structure like search_help_topics
		if (result && typeof result === 'object' && 'result' in result) {
			return result.result || false;
		}
		
		return result || false;
	}

	async searchHelpTopics(query: string): Promise<Array<string>> {
		try {
			const result = await this.sendRequest('search_help_topics', { query });
			
			// The R backend returns { method: "SearchHelpTopicsReply", result: [...] }
			// We need to unwrap the nested result
			if (result && typeof result === 'object' && 'result' in result) {
				return result.result || [];
			}
			
			return result || [];
		} catch (error) {
			console.error(`[RuntimeQueryHandler.searchHelpTopics] Error during search:`, error);
			throw error;
		}
	}

	async parseFunctions(code: string, language: string): Promise<FunctionParseResult> {
		const result = await this.sendRequest('parse_functions', { code, language });
		
		// Check if the backend returns a nested structure like search_help_topics
		if (result && typeof result === 'object' && 'result' in result) {
			return result.result || { functions: [], success: false };
		}
		
		return result || { functions: [], success: false };
	}

	override dispose(): void {
		// Cancel all pending requests
		for (const pending of this._pendingRequests.values()) {
			clearTimeout(pending.timeout);
			pending.reject(new Error('Query handler disposed'));
		}
		this._pendingRequests.clear();

		if (this._messageListener) {
			this._messageListener.dispose();
		}

		if (this._channel) {
			this._channel.close();
			this._channel = undefined;
		}

		this._helpEmitter.dispose();
		this._closeEmitter.dispose();
		super.dispose();
	}
}

