/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as erdos from 'erdos';
import * as vscode from 'vscode';
import WebSocket from 'ws';
import * as path from 'path';
import { traceInfo } from '../logging';
import { RuntimeExtraData } from './discoverer';

interface IpykernelBundle {
	disabledReason?: string;
	paths?: string[];
}

// RuntimeOutputKind enum mirror for runtime use
// Must match the enum values in vscode/src/vs/workbench/services/languageRuntime/common/languageRuntimeTypes.ts
const RuntimeOutputKind = {
    Text: 'text',
    StaticImage: 'static_image',
    InlineHtml: 'inline_html',
    ViewerWidget: 'viewer_widget',
    PlotWidget: 'plot_widget',
    QuartoInline: 'quarto_inline',
    IPyWidget: 'ipywidget',
    WebviewPreload: 'webview_preload',
    Unknown: 'unknown'
} as const;

export class RuntimeSession implements erdos.LanguageRuntimeSession, vscode.Disposable {

	private _kernel?: any; // DirectKernelSession
	private _messageEmitter =
		new vscode.EventEmitter<erdos.LanguageRuntimeMessage>();
	private _stateEmitter =
		new vscode.EventEmitter<erdos.RuntimeState>();
	private _exitEmitter =
		new vscode.EventEmitter<erdos.LanguageRuntimeExit>();
	private _clientEventEmitter =
		new vscode.EventEmitter<erdos.LanguageRuntimeClientEvent>();
	private _state: erdos.RuntimeState = erdos.RuntimeState.Uninitialized;
	private _created: number;
	public dynState: erdos.LanguageRuntimeDynState & { sessionName: string; currentWorkingDirectory: string; busy: boolean };
	private _kernelSpec: any;
	private _ipykernelBundle: IpykernelBundle;

	constructor(
		readonly runtimeMetadata: erdos.LanguageRuntimeMetadata,
		readonly metadata: erdos.RuntimeSessionMetadata,
		sessionName?: string,
		kernelSpec?: any
	) {
		// Extract ipykernel bundle from runtime metadata
		const extraData: RuntimeExtraData = runtimeMetadata.extraRuntimeData as RuntimeExtraData;
		if (!extraData || !extraData.ipykernelBundle) {
			throw new Error(`Runtime metadata missing ipykernel bundle data: ${JSON.stringify(runtimeMetadata)}`);
		}
		this._ipykernelBundle = extraData.ipykernelBundle;
		this.dynState = {
			sessionName: sessionName || runtimeMetadata.runtimeName,
			continuationPrompt: '...',
			inputPrompt: '>>>',
			currentWorkingDirectory: '',
			busy: false
		};

		this.onDidReceiveRuntimeMessage = this._messageEmitter.event;
		this.onDidChangeRuntimeState = this._stateEmitter.event;
		this.onDidEndSession = this._exitEmitter.event;
		this.onDidReceiveRuntimeClientEvent = this._clientEventEmitter.event;

		this._created = Date.now();

		this.onDidChangeRuntimeState(async (state) => {
			await this.onStateChange(state);
		});

		this._kernelSpec = kernelSpec || {};
	}

	onDidEndSession: vscode.Event<erdos.LanguageRuntimeExit>;
	onDidReceiveRuntimeMessage: vscode.Event<erdos.LanguageRuntimeMessage>;
	onDidChangeRuntimeState: vscode.Event<erdos.RuntimeState>;
	onDidReceiveRuntimeClientEvent: vscode.Event<erdos.LanguageRuntimeClientEvent>;

	get sessionId(): string { return this.metadata.sessionId; }
	get sessionName(): string { return this.dynState.sessionName; }
	get sessionMode(): number { return this.metadata.sessionMode; }
	get notebookUri(): vscode.Uri | undefined { return this.metadata.notebookUri; }
	get state(): erdos.RuntimeState { return this._state; }
	get created(): number { return this._created; }

	getRuntimeState(): erdos.RuntimeState {
		return this._state;
	}

	async requestCompletion(code: string, cursorPos: number): Promise<{ matches: string[], cursorStart: number, cursorEnd: number }> {
		if (!this._kernel) {
			return { matches: [], cursorStart: cursorPos, cursorEnd: cursorPos };
		}
		
		return await this._kernel.complete(code, cursorPos);
	}

	execute(code: string, id: string, mode: erdos.RuntimeCodeExecutionMode, errorBehavior: erdos.RuntimeErrorBehavior): void {
		if (this._kernel) {
			this._kernel.execute(code, id, mode, errorBehavior);
		} else {
			throw new Error(`Cannot execute '${code}'; kernel not started`);
		}
	}

	async setWorkingDirectory(dir: string): Promise<void> {
		if (this._kernel) {
			// Pass directory as first positional argument, not as object
			await this._kernel.callMethod('set_working_directory', dir);
		} else {
			throw new Error(`Cannot change to ${dir}; kernel not started`);
		}
	}

	callMethod(method: string, ...args: any[]): Thenable<any> {
		if (this._kernel) {
			return this._kernel.callMethod(method, ...args);
		} else {
			throw new Error(`Cannot call method '${method}'; kernel not started`);
		}
	}

	isCodeFragmentComplete(code: string): Thenable<erdos.RuntimeCodeFragmentStatus> {
		if (this._kernel) {
			return this._kernel.isCodeFragmentComplete(code);
		} else {
			throw new Error(`Cannot check code fragment '${code}'; kernel not started`);
		}
	}

	createClient(id: string, type: erdos.RuntimeClientType, params: any, metadata?: any): Thenable<void> {
		if (this._kernel) {
			return this._kernel.createClient(id, type, params, metadata);
		} else {
			throw new Error(`Cannot create client of type '${type}'; kernel not started`);
		}
	}

	async listClients(type?: erdos.RuntimeClientType | undefined): Promise<erdos.RuntimeClientInstance[]> {
		if (this._kernel) {
			const clients = await this._kernel.listClients(type);
			const result = Object.values(clients) as erdos.RuntimeClientInstance[];
			return result;
		} else {
			throw new Error(`Cannot list clients; kernel not started`);
		}
	}

	sendClientMessage(clientId: string, messageId: string, data: any): void {
		if (this._kernel) {
			this._kernel.sendClientMessage(clientId, messageId, data);
		} else {
			throw new Error(`Cannot send client message; kernel not started`);
		}
	}

	removeClient(clientId: string): void {
		if (this._kernel) {
			this._kernel.removeClient(clientId);
		}
	}

	async start(): Promise<erdos.LanguageRuntimeInfo> {
		if (!this._kernel) {
			this._kernel = await this.createKernel();
		}
		return await this._kernel.start();
	}

	async interrupt(): Promise<void> {
		if (this._kernel) {
			return await this._kernel.interrupt();
		} else {
			throw new Error('Cannot interrupt; kernel not started');
		}
	}

	replyToInput(parentId: string, value: string): void {
		if (this._kernel) {
			this._kernel.replyToInput(parentId, value);
		} else {
			throw new Error('Cannot reply to input; kernel not started');
		}
	}

	async restart(workingDirectory: string | undefined): Promise<void> {
		if (this._kernel) {
			await this._kernel.restart(workingDirectory);
		} else {
			throw new Error('Cannot restart; kernel not started');
		}
	}

	async shutdown(exitReason = erdos.RuntimeExitReason.Shutdown): Promise<void> {
		if (this._kernel) {
			await this._kernel.shutdown(exitReason);
		} else {
			throw new Error('Cannot shutdown; kernel not started');
		}
	}

	async dispose(): Promise<void> {
		if (this._kernel) {
			await this._kernel.dispose();
		}
	}

	private addBundledIpykernelToPythonPath(): void {
		if (this._ipykernelBundle.disabledReason || !this._ipykernelBundle.paths) {
			traceInfo(`Not using bundled ipykernel. Reason: ${this._ipykernelBundle.disabledReason}`);
			return;
		}

		traceInfo(`Using bundled ipykernel with ${this._ipykernelBundle.paths.length} paths`);
		
		if (!this._kernelSpec.env) {
			this._kernelSpec.env = {};
		}

		// Append ipykernel bundle paths to PYTHONPATH
		const pythonPathParts = this._ipykernelBundle.paths;
		const existingPythonPath = this._kernelSpec.env.PYTHONPATH;
		
		if (existingPythonPath) {
			pythonPathParts.push(existingPythonPath);
		}

		this._kernelSpec.env.PYTHONPATH = pythonPathParts.join(path.delimiter);
		traceInfo(`PYTHONPATH set to: ${this._kernelSpec.env.PYTHONPATH}`);
	}

	private async createKernel(): Promise<any> {
		
		const managerPort = await vscode.commands.executeCommand<number>('erdos.kernelManager.getManagerPort');
		if (!managerPort) {
			throw new Error('Kernel manager not available');
		}

		// Add bundled ipykernel paths to PYTHONPATH before creating kernel config
		this.addBundledIpykernelToPythonPath();

		const kernelConfig = await this.buildKernelConfig();

		const response = await (globalThis as any).fetch(`http://localhost:${managerPort}/kernels`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(kernelConfig)
		});

		if (!response.ok) {
			throw new Error(`Failed to start kernel: ${response.statusText}`);
		}

		const kernelInfo = await response.json();
		const { port } = kernelInfo;

		// Wait for kernel to be ready and establish TWO WebSocket connections
		const shellWs = await this.connectToKernel(port);  // Shell WebSocket (execution)
		const controlWs = await this.connectToKernel(port + 1);  // Control WebSocket (interrupts)

		const pendingRequests = new Map<string, { resolve: (value: any) => void; reject: (error: any) => void }>();

		// Set up shell WebSocket message handling (execution, outputs, etc.)
		shellWs.on('message', (data: WebSocket.Data) => {
			this.handleShellMessage(JSON.parse(data.toString()), pendingRequests);
		});

		// Set up control WebSocket message handling (interrupt replies only)
		controlWs.on('message', (data: WebSocket.Data) => {
			this.handleControlMessage(JSON.parse(data.toString()), pendingRequests);
		});

		const kernel = {
			execute: (code: string, id: string, mode: erdos.RuntimeCodeExecutionMode, errorBehavior: erdos.RuntimeErrorBehavior, batchId?: string, filePath?: string) => {
				this.sendExecuteRequest(shellWs, code, id, mode, errorBehavior, batchId, filePath);
			},

			interrupt: async () => {
				this.sendInterruptRequest(controlWs);  // Use control WebSocket for interrupts
			},

			replyToInput: (parentId: string, value: string) => {
				this.sendInputReply(shellWs, parentId, value);
			},

			shutdown: async () => {
				await this.sendShutdownRequest(shellWs, kernelInfo.id, managerPort);
				controlWs.close();  // Close both WebSockets
			},

		start: async () => {
			await this.sendCommOpen(shellWs, pendingRequests, 'erdos.ui', 'erdos.ui', {});
			return {
				banner: 'Python kernel started via WebSocket'
			};
		},

			callMethod: async (method: string, ...args: any[]) => {
				return this.sendRpcRequest(shellWs, pendingRequests, method, args);
			},
			
		createClient: async (id: string, type: erdos.RuntimeClientType, params: any, _metadata?: any) => {
			await this.sendCommOpen(shellWs, pendingRequests, type, id, params || {});
		},
		
		listClients: async (_type?: erdos.RuntimeClientType) => {
			return {};
		},
		
		removeClient: (id: string) => {
			this.sendCommClose(shellWs, id);
		},
		
		sendClientMessage: (clientId: string, messageId: string, message: any) => {
			const msg = this.createJupyterMessage('comm_msg', messageId, {
				comm_id: clientId,
				data: message
			});
			shellWs.send(JSON.stringify(msg));
		},
		
		isCodeFragmentComplete: async (code: string): Promise<erdos.RuntimeCodeFragmentStatus> => {
			const msgId = this.generateMessageId();
			const msg = this.createJupyterMessage('is_complete_request', msgId, { code });
			
			const reply = await new Promise<any>((resolve, reject) => {
				pendingRequests.set(msgId, { resolve, reject });
				shellWs.send(JSON.stringify(msg));
				
				setTimeout(() => {
					if (pendingRequests.has(msgId)) {
						pendingRequests.delete(msgId);
						reject(new Error('is_complete_request timed out'));
					}
				}, 5000);
			});
			
			switch (reply.status) {
				case 'complete':
					return erdos.RuntimeCodeFragmentStatus.Complete;
				case 'incomplete':
					return erdos.RuntimeCodeFragmentStatus.Incomplete;
				case 'invalid':
					return erdos.RuntimeCodeFragmentStatus.Invalid;
				case 'unknown':
				default:
					return erdos.RuntimeCodeFragmentStatus.Unknown;
			}
		},

		complete: async (code: string, cursorPos: number): Promise<{ matches: string[], cursorStart: number, cursorEnd: number }> => {
			const msgId = this.generateMessageId();
			const msg = this.createJupyterMessage('complete_request', msgId, { code, cursor_pos: cursorPos });
			
			const reply = await new Promise<any>((resolve, reject) => {
				pendingRequests.set(msgId, { resolve, reject });
				shellWs.send(JSON.stringify(msg));
				
				setTimeout(() => {
					if (pendingRequests.has(msgId)) {
						pendingRequests.delete(msgId);
						reject(new Error('complete_request timed out'));
					}
				}, 5000);
			});
			
			return {
				matches: reply.matches || [],
				// Use ?? (nullish coalescing) instead of || to handle cursor_start=0 correctly
				cursorStart: reply.cursor_start ?? cursorPos,
				cursorEnd: reply.cursor_end ?? cursorPos
			};
		},
		
		restart: async (_workingDirectory?: string) => {
			throw new Error('Restart not supported in WebSocket mode');
		},
		
		forceQuit: async () => {
			shellWs.close();
			controlWs.close();
		},
		
		dispose: async () => {
			shellWs.close();
			controlWs.close();
		}
	};

	// Set up shell WebSocket event handlers
	shellWs.on('open', () => {
		this._state = erdos.RuntimeState.Ready;
		this._stateEmitter.fire(erdos.RuntimeState.Ready);
	});

	shellWs.on('close', () => {
		this._state = erdos.RuntimeState.Exited;
		this._stateEmitter.fire(erdos.RuntimeState.Exited);
		this._exitEmitter.fire({
			runtime_name: this.runtimeMetadata.runtimeName,
			session_name: this.dynState.sessionName,
			exit_code: 0,
			reason: erdos.RuntimeExitReason.Unknown,
			message: 'Kernel connection closed'
		});
	});

	shellWs.on('error', (error: Error) => {
		console.error('Shell WebSocket error:', error);
	});

	controlWs.on('error', (error: Error) => {
		console.error('Control WebSocket error:', error);
	});

	// Fire initial state change events
	this._stateEmitter.fire(erdos.RuntimeState.Ready);

		return kernel;
	}

	private handleShellMessage(msg: any, pendingRequests: Map<string, { resolve: (value: any) => void; reject: (error: any) => void }>): void {
		// Handle all shell messages (execution, outputs, etc.) - same as before
		let message = this.handleKernelMessage(JSON.stringify(msg), pendingRequests);
		
		if (message) {
			// Handle UI comm messages to update dynState
			if (message.type === erdos.LanguageRuntimeMessageType.CommData) {
				const commMessage = message as erdos.LanguageRuntimeCommMessage;
				if (commMessage.comm_id === 'erdos.ui') {
					this.handleUiCommMessage(commMessage.data);
				}
			}
			
			this._messageEmitter.fire(message);
		}
	}

	private handleControlMessage(msg: any, pendingRequests: Map<string, { resolve: (value: any) => void; reject: (error: any) => void }>): void {
		// Handle control messages (interrupt replies only) - simpler processing
		this.handleKernelMessage(JSON.stringify(msg), pendingRequests);
	}

	private async buildKernelConfig(): Promise<any> {
		return {
			language: 'python',
			sessionId: this.metadata.sessionId,
			argv: this._kernelSpec?.argv || [],
			env: this._kernelSpec?.env || {},
		};
	}

	private async connectToKernel(port: number): Promise<WebSocket> {
		// Wait for kernel to be ready
		const MAX_RETRIES = 30;
		const RETRY_DELAY_MS = 100;

		for (let i = 0; i < MAX_RETRIES; i++) {
			try {
				const ws = new WebSocket(`ws://localhost:${port}`);
				await new Promise<void>((resolve, reject) => {
					const timeout = setTimeout(() => {
						ws.close();
						reject(new Error('Connection timeout'));
					}, 1000);

					ws.on('open', () => {
						clearTimeout(timeout);
						resolve();
					});

					ws.on('error', (err: Error) => {
						clearTimeout(timeout);
						reject(err);
					});
				});
				return ws;
			} catch (err) {
				if (i < MAX_RETRIES - 1) {
					await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
				}
			}
		}
		throw new Error('Failed to connect to kernel');
	}

	private sendExecuteRequest(ws: WebSocket, code: string, id: string, _mode: erdos.RuntimeCodeExecutionMode, errorBehavior: erdos.RuntimeErrorBehavior, batchId?: string, filePath?: string): void {
		const metadata: Record<string, any> = {};
		
		// Add batch ID and file path to metadata for plot attribution
		if (batchId) {
			metadata.batchId = batchId;
		}
		if (filePath) {
			metadata.filePath = filePath;
		}
		
		const msg = this.createJupyterMessage('execute_request', id, {
			code,
			silent: false,
			store_history: true,
			user_expressions: {},
			allow_stdin: true,
			stop_on_error: errorBehavior === erdos.RuntimeErrorBehavior.Stop
		}, metadata);
		
		ws.send(JSON.stringify(msg));
	}

	private sendInterruptRequest(ws: WebSocket): void {
		const msg = this.createJupyterMessage('interrupt_request', this.generateMessageId(), {});
		ws.send(JSON.stringify(msg));
	}

	private sendInputReply(ws: WebSocket, parentId: string, value: string): void {
		const msg = this.createJupyterMessage('input_reply', this.generateMessageId(), {
			value: value
		});
		// Set parent_header to link this reply to the input_request
		msg.parent_header = {
			msg_id: parentId,
			msg_type: 'input_request',
			session: this.metadata.sessionId,
			username: 'user',
			version: '5.3',
			date: new Date().toISOString()
		};
		ws.send(JSON.stringify(msg));
	}

	private async sendShutdownRequest(ws: WebSocket, kernelId: string, managerPort: number): Promise<void> {
		const msg = this.createJupyterMessage('shutdown_request', this.generateMessageId(), { restart: false });
		ws.send(JSON.stringify(msg));
		ws.close();

		try {
			await (globalThis as any).fetch(`http://localhost:${managerPort}/kernels/${kernelId}`, {
				method: 'DELETE'
			});
		} catch (error) {
		}
	}

	private async sendCommOpen(ws: WebSocket, _pendingRequests: Map<string, any>, targetName: string, commId: string, data: any): Promise<void> {
		const msgId = this.generateMessageId();
		const msg = this.createJupyterMessage('comm_open', msgId, {
			comm_id: commId,
			target_name: targetName,
			data: data || {}
		});

		ws.send(JSON.stringify(msg));
		await new Promise(resolve => setTimeout(resolve, 100));

		const vscodeTargetName = targetName.includes('.') ? targetName : `erdos.${targetName}`;
		this._messageEmitter.fire({
			type: erdos.LanguageRuntimeMessageType.CommOpen,
			id: msgId,
			parent_id: '',
			when: msg.header.date,
			comm_id: commId,
			target_name: vscodeTargetName,
			data: data || {}
		} as erdos.LanguageRuntimeCommOpen);
	}

	private async sendCommClose(ws: WebSocket, commId: string): Promise<void> {
		const msg = this.createJupyterMessage('comm_close', this.generateMessageId(), {
			comm_id: commId,
			data: {}
		});
		ws.send(JSON.stringify(msg));
	}

	private async sendRpcRequest(ws: WebSocket, pendingRequests: Map<string, any>, method: string, args: any[]): Promise<any> {
		const msgId = this.generateMessageId();
		const rpcId = this.generateMessageId(); // Separate ID for JSON-RPC
		// Python kernel expects call_method wrapper format
		const params = {
			method: method,
			params: args  // Pass args as array
		};

		return new Promise((resolve, reject) => {
			const msg = this.createJupyterMessage('comm_msg', msgId, {
				comm_id: 'erdos.ui',
				data: {
					jsonrpc: '2.0',
					method: 'call_method',  // Python kernel uses call_method wrapper
					id: rpcId,  // Use separate JSON-RPC ID
					params: params
				}
			});

			// Store pending request with JSON-RPC ID, not Jupyter message ID
			pendingRequests.set(rpcId, { resolve, reject });
			ws.send(JSON.stringify(msg));

			setTimeout(() => {
				if (pendingRequests.has(rpcId)) {
					pendingRequests.delete(rpcId);
					reject(new Error(`RPC call to ${method} timed out`));
				}
			}, 30000);
		});
	}

	private handleUiCommMessage(data: any): void {
		if (!data || !data.method) {
			return;
		}

		switch (data.method) {
			case 'working_directory':
				if (data.params?.directory) {
					this.dynState.currentWorkingDirectory = data.params.directory;
					this._clientEventEmitter.fire({
						name: 'working_directory',
						data: { directory: data.params.directory }
					});
				}
				break;
			
			case 'prompt_state':
				if (data.params?.input_prompt) {
					this.dynState.inputPrompt = data.params.input_prompt;
				}
				if (data.params?.continuation_prompt) {
					this.dynState.continuationPrompt = data.params.continuation_prompt;
				}
				break;
			
			case 'busy':
				if (typeof data.params?.busy === 'boolean') {
					this.dynState.busy = data.params.busy;
				}
				break;
			
		case 'clear_console':
			this._clientEventEmitter.fire({
				name: 'clear_console',
				data: {
					session_mode: data.params?.session_mode || 'console'
				}
			});
			break;
		}
	}

	private handleKernelMessage(data: WebSocket.Data, pendingRequests: Map<string, any>): erdos.LanguageRuntimeMessage | null {
		const dataStr = data.toString();
		const msg = JSON.parse(dataStr);
		const msgType = msg.header?.msg_type;

		// Handle RPC replies
		if (msgType?.endsWith('_reply') || msgType === 'comm_msg') {
			const data = msg.content?.data;
			
			// Check if this is a JSON-RPC response (has jsonrpc and id fields)
			if (data && data.jsonrpc === '2.0' && data.id !== undefined) {
				const rpcId = data.id;
				
				if (pendingRequests.has(rpcId)) {
					const pending = pendingRequests.get(rpcId);
					pendingRequests.delete(rpcId);
					
					if (data.error) {
						pending.reject(new Error(data.error.message || 'RPC error'));
					} else {
						pending.resolve(data.result);
					}
				}
			} else if (msgType?.endsWith('_reply')) {
				// For standard Jupyter protocol replies, check parent message ID
				const parentMsgId = msg.parent_header?.msg_id;
				
				if (parentMsgId && pendingRequests.has(parentMsgId)) {
					const pending = pendingRequests.get(parentMsgId);
					pendingRequests.delete(parentMsgId);
					
					// Check for error status
					if (msg.content.status === 'error') {
						pending.reject(new Error(msg.content.evalue || 'Request failed'));
					} else {
						// Resolve with content for all other statuses
						pending.resolve(msg.content);
					}
				}
			}
		}

		// Handle state changes
		if (msgType === 'status') {
			const executionState = msg.content.execution_state;
			if (executionState === 'busy') {
				this._state = erdos.RuntimeState.Busy;
				this._stateEmitter.fire(erdos.RuntimeState.Busy);
			} else if (executionState === 'idle') {
				this._state = erdos.RuntimeState.Idle;
				this._stateEmitter.fire(erdos.RuntimeState.Idle);
			}
		}

		const erdosMessage = this.jupyterToErdosMessage(msg);
		return erdosMessage;
	}

	private jupyterToErdosMessage(msg: any): erdos.LanguageRuntimeMessage | null {
		const msgType = msg.header?.msg_type;

		switch (msgType) {
			case 'stream':
				return {
					type: erdos.LanguageRuntimeMessageType.Output,
					id: msg.header.msg_id,
					parent_id: msg.parent_header?.msg_id || '',
					when: msg.header.date,
					data: { 'text/plain': msg.content.text },
					kind: RuntimeOutputKind.Text as any
				} as erdos.LanguageRuntimeOutput;

			case 'execute_result':
			case 'display_data':
				{
					// Detect output kind based on content
					let kind: any = RuntimeOutputKind.Text;
					const data = msg.content.data || {};
					
					// Check for image outputs
					const imageMimeTypes = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/gif'];
					if (imageMimeTypes.some(mimeType => mimeType in data)) {
						kind = RuntimeOutputKind.StaticImage;
					}
					// Check for HTML outputs
					else if ('text/html' in data) {
						kind = RuntimeOutputKind.InlineHtml;
					}
					// Check for interactive plot libraries
					else if ('application/vnd.plotly.v1+json' in data || 
					         'application/vnd.bokehjs_exec.v0+json' in data ||
					         'application/vnd.holoviews_exec.v0+json' in data) {
						kind = RuntimeOutputKind.PlotWidget;
					}
					
					return {
						type: erdos.LanguageRuntimeMessageType.Output,
						id: msg.header.msg_id,
						parent_id: msg.parent_header?.msg_id || '',
						when: msg.header.date,
						data: data,
						kind: kind
					} as erdos.LanguageRuntimeOutput;
				}

		case 'error':
			return {
				type: erdos.LanguageRuntimeMessageType.Error,
				id: msg.header.msg_id,
				parent_id: msg.parent_header?.msg_id || '',
				when: msg.header.date,
				name: msg.content.ename,
				message: msg.content.evalue,
				traceback: msg.content.traceback
			} as erdos.LanguageRuntimeError;

		case 'input_request':
			return {
				type: erdos.LanguageRuntimeMessageType.Input,
				id: msg.header.msg_id,
				parent_id: msg.parent_header?.msg_id || '',
				when: msg.header.date,
				prompt: msg.content.prompt || '',
				password: msg.content.password || false
			} as erdos.LanguageRuntimeInput;

		case 'comm_open':
				return {
					type: erdos.LanguageRuntimeMessageType.CommOpen,
					id: msg.header.msg_id,
					parent_id: msg.parent_header?.msg_id || '',
					when: msg.header.date,
					comm_id: msg.content.comm_id,
					target_name: msg.content.target_name,
					data: msg.content.data
				} as erdos.LanguageRuntimeCommOpen;

			case 'comm_msg':
				return {
					type: erdos.LanguageRuntimeMessageType.CommData,
					id: msg.header.msg_id,
					parent_id: msg.parent_header?.msg_id || '',
					when: msg.header.date,
					comm_id: msg.content.comm_id,
					data: msg.content.data
				} as erdos.LanguageRuntimeCommMessage;

			case 'comm_close':
				return {
					type: erdos.LanguageRuntimeMessageType.CommClosed,
					id: msg.header.msg_id,
					parent_id: msg.parent_header?.msg_id || '',
					when: msg.header.date,
					comm_id: msg.content.comm_id,
					data: msg.content.data || {}
				} as erdos.LanguageRuntimeCommClosed;

			case 'status':
				return {
					type: erdos.LanguageRuntimeMessageType.State,
					id: msg.header.msg_id,
					parent_id: msg.parent_header?.msg_id || '',
					when: msg.header.date,
					state: msg.content.execution_state
				} as erdos.LanguageRuntimeState;

			default:
				return null;
		}
	}

	private generateMessageId(): string {
		return Math.random().toString(36).substring(7);
	}

	private createJupyterMessage(msgType: string, msgId: string, content: any, metadata?: Record<string, any>): any {
		return {
			header: {
				msg_id: msgId,
				msg_type: msgType,
				session: this.metadata.sessionId,
				username: 'user',
				version: '5.3',
				date: new Date().toISOString()
			},
			parent_header: {},
			metadata: metadata || {},
			content
		};
	}

	private async onStateChange(state: erdos.RuntimeState): Promise<void> {
		this._state = state;
	}
}
