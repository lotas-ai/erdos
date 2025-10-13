/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { extHostNamedCustomer, IExtHostContext } from '../../services/extensions/common/extHostCustomers.js';
import { MainContext, ExtHostContext, ExtHostRuntimeShape, MainThreadRuntimeShape } from '../common/extHost.protocol.js';
import { ILanguageRuntimeMetadata, ILanguageRuntimeSession, LanguageRuntimeSessionMode, RuntimeState, RuntimeExitReason, RuntimeCodeFragmentStatus } from '../../services/languageRuntime/common/languageRuntimeTypes.js';
import { ISessionManager, ILanguageRuntimeManager } from '../../services/languageRuntime/common/sessionManager.js';
import { ILanguageRuntimeService } from '../../services/languageRuntime/common/languageRuntimeService.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { Disposable, DisposableStore } from '../../../base/common/lifecycle.js';
import { Emitter } from '../../../base/common/event.js';
import { ILanguageRuntimeMessage, type IDirectKernelClient } from '../../services/languageRuntime/common/languageRuntimeMessageTypes.js';
import { SerializableObjectWithBuffers } from '../../services/extensions/common/proxyIdentifier.js';
import { URI } from '../../../base/common/uri.js';
import { CommandsRegistry } from '../../../platform/commands/common/commands.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { IConsoleService } from '../../services/erdosConsole/common/consoleService.js';
import { CodeAttributionSource } from '../../services/languageRuntime/common/codeExecution.js';

// Adapter that wraps an ExtHost session
class ExtHostRuntimeSessionAdapter extends Disposable implements ILanguageRuntimeSession {
	private readonly _stateEmitter = new Emitter<RuntimeState>();
	private readonly _exitEmitter = new Emitter<void>();
	private readonly _onDidReceiveRuntimeMessage = new Emitter<any>();
	private readonly _onDidReceiveRuntimeMessageOutput = new Emitter<any>();
	private readonly _onDidReceiveRuntimeMessageResult = new Emitter<any>();
	private readonly _onDidReceiveRuntimeMessageStream = new Emitter<any>();
	private readonly _onDidReceiveRuntimeMessageError = new Emitter<any>();
	private readonly _onDidReceiveRuntimeClientEvent = new Emitter<{ name: string; data: Record<string, unknown> }>();

	readonly onDidChangeRuntimeState = this._stateEmitter.event;
	readonly onDidEndSession = this._exitEmitter.event;
	readonly onDidReceiveRuntimeMessage = this._onDidReceiveRuntimeMessage.event;
	readonly onDidReceiveRuntimeMessageOutput = this._onDidReceiveRuntimeMessageOutput.event;
	readonly onDidReceiveRuntimeMessageResult = this._onDidReceiveRuntimeMessageResult.event;
	readonly onDidReceiveRuntimeMessageStream = this._onDidReceiveRuntimeMessageStream.event;
	readonly onDidReceiveRuntimeMessageError = this._onDidReceiveRuntimeMessageError.event;
	readonly onDidReceiveRuntimeClientEvent = this._onDidReceiveRuntimeClientEvent.event;

	private _currentState: RuntimeState = RuntimeState.Uninitialized;

	readonly dynState = {
		inputPrompt: '',
		continuationPrompt: '',
		currentWorkingDirectory: '',
		busy: false
	};

	constructor(
		private readonly handle: number,
		readonly runtimeMetadata: ILanguageRuntimeMetadata,
		readonly metadata: { sessionMode: LanguageRuntimeSessionMode },
		private readonly _sessionMetadata: any,
		private readonly _proxy: ExtHostRuntimeShape,
		private readonly _logService: ILogService
	) {
		super();
	}

	get sessionId(): string {
		return this._sessionMetadata.sessionId;
	}

	async start(): Promise<void> {
		await this._proxy.$startLanguageRuntime(this.handle);
	}

		execute(code: string, id: string, mode?: any, errorBehavior?: any, batchId?: string, filePath?: string): void {
			this._proxy.$executeCode(this.handle, code, id, mode, errorBehavior, id, batchId, filePath);
		}

	async setWorkingDirectory(dir: string): Promise<void> {
		await this._proxy.$setWorkingDirectory(this.handle, dir);
	}

	async isCodeFragmentComplete(code: string): Promise<RuntimeCodeFragmentStatus> {
		return await this._proxy.$isCodeFragmentComplete(this.handle, code);
	}

	getRuntimeState(): RuntimeState {
		return this._currentState;
	}

	async listClients(clientType?: any): Promise<IDirectKernelClient[]> {
		const clients = await this._proxy.$listClients(this.handle, clientType);
		// Convert Record<string, any> back to array
		const result = Object.values(clients);
		return result as IDirectKernelClient[];
	}

	async createClient(clientType: any, params: any, metadata?: any): Promise<any> {
		const clientId = generateUuid();
		await this._proxy.$createClient(this.handle, clientId, clientType, params, metadata);
		
		// Create a client wrapper with send() and close() methods
		const client = {
			clientId: clientId,
			client_id: clientId,  // Both naming conventions for compatibility
			client_type: clientType,
			send: (data: unknown) => {
				this._proxy.$sendClientMessage(this.handle, clientId, data);
			},
			close: () => {
				this._proxy.$removeClient(this.handle, clientId);
			}
		};
		
		return client;
	}

	async restart(): Promise<void> {
		await this._proxy.$restartSession(this.handle);
	}

	interrupt(): void {
		this._proxy.$interruptLanguageRuntime(this.handle);
	}

	replyToInput(parentId: string, value: string): void {
		this._proxy.$replyToInput(this.handle, parentId, value);
	}

	async shutdown(exitReason: RuntimeExitReason = RuntimeExitReason.Shutdown): Promise<void> {
		await this._proxy.$shutdownLanguageRuntime(this.handle, exitReason);
	}

	async forceQuit(): Promise<void> {
		await this._proxy.$forceQuitLanguageRuntime(this.handle);
	}

	handleRuntimeMessage(message: ILanguageRuntimeMessage, _handled: boolean): void {
		this._logService.trace(`[Session ${this.sessionId}] Runtime message: ${message.type}`);
		
		this._onDidReceiveRuntimeMessage.fire(message);
		
		switch (message.type) {
			case 'output':
				this._onDidReceiveRuntimeMessageOutput.fire(message);
				break;
			case 'result':
				this._onDidReceiveRuntimeMessageResult.fire(message);
				break;
			case 'stream':
				this._onDidReceiveRuntimeMessageStream.fire(message);
				break;
			case 'error':
				this._onDidReceiveRuntimeMessageError.fire(message);
				break;
		}
	}

	emitState(_clock: number, state: RuntimeState): void {
		this._currentState = state;
		this._stateEmitter.fire(state);
	}

	emitExit(_exit: any): void {
		this._exitEmitter.fire();
	}

	emitClientEvent(event: { name: string; data: Record<string, unknown> }): void {
		this._logService.trace(`[Session ${this.sessionId}] Client event: ${event.name}`);
		
		// Update dynState based on the event
		if (event.name === 'working_directory' && typeof event.data.directory === 'string') {
			this.dynState.currentWorkingDirectory = event.data.directory;
		} else if (event.name === 'prompt_state') {
			if (typeof event.data.input_prompt === 'string') {
				this.dynState.inputPrompt = event.data.input_prompt;
			}
			if (typeof event.data.continuation_prompt === 'string') {
				this.dynState.continuationPrompt = event.data.continuation_prompt;
			}
		} else if (event.name === 'busy' && typeof event.data.busy === 'boolean') {
			this.dynState.busy = event.data.busy;
		}
		
		this._onDidReceiveRuntimeClientEvent.fire(event);
	}
}

@extHostNamedCustomer(MainContext.MainThreadRuntime)
export class MainThreadRuntime implements MainThreadRuntimeShape, ILanguageRuntimeManager {

	private readonly _disposables = new DisposableStore();
	private readonly _proxy: ExtHostRuntimeShape;
	private readonly _sessions: Map<number, ExtHostRuntimeSessionAdapter> = new Map();
	private readonly _sessionIdToHandle: Map<string, number> = new Map();
	private readonly _registeredRuntimes: Map<string, ILanguageRuntimeMetadata> = new Map();
	private readonly _registeredLanguages = new Set<string>();
	private readonly _quartoExecutionIds = new Set<string>();

	constructor(
		extHostContext: IExtHostContext,
		@ISessionManager private readonly _sessionManager: ISessionManager,
		@ILanguageRuntimeService private readonly _languageRuntimeService: ILanguageRuntimeService,
		@ILogService private readonly _logService: ILogService,
		@IConsoleService private readonly _consoleService: IConsoleService
	) {
		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostRuntime);

		CommandsRegistry.registerCommand('erdos.registerQuartoExecution', (_accessor, executionId: string) => {
			this.registerQuartoExecution(executionId);
		});
	}

	dispose(): void {
		this._disposables.dispose();
	}

	// ===== Protocol Methods (called by ExtHost) =====

	$emitLanguageRuntimeMessage(handle: number, handled: boolean, message: SerializableObjectWithBuffers<ILanguageRuntimeMessage>): void {
		const session = this.findSession(handle);
		session.handleRuntimeMessage(message.value, handled);
	}

	$emitLanguageRuntimeState(handle: number, clock: number, state: RuntimeState): void {
		this.findSession(handle).emitState(clock, state);
	}

	$emitLanguageRuntimeExit(handle: number, exit: any): void {
		this.findSession(handle).emitExit(exit);
	}

	$emitLanguageRuntimeClientEvent(handle: number, event: { name: string; data: Record<string, unknown> }): void {
		this.findSession(handle).emitClientEvent(event);
	}

	$registerLanguageRuntime(metadata: ILanguageRuntimeMetadata): void {
		this._registeredRuntimes.set(metadata.runtimeId, metadata);
		this._languageRuntimeService.registerRuntime(metadata);
		this._sessionManager.registerRuntime(metadata);
		
		if (!this._registeredLanguages.has(metadata.languageId)) {
			this._sessionManager.registerLanguageRuntimeManager(metadata.languageId, this);
			this._registeredLanguages.add(metadata.languageId);
		}
	}

	$unregisterLanguageRuntime(runtimeId: string): void {
		this._registeredRuntimes.delete(runtimeId);
		this._languageRuntimeService.unregisterRuntime(runtimeId);
	}

	$completeLanguageRuntimeDiscovery(): void {
		this._sessionManager.completeDiscovery();
	}

	async $getPreferredRuntime(languageId: string): Promise<ILanguageRuntimeMetadata | undefined> {
		return this._sessionManager.getPreferredRuntime(languageId);
	}

	async $getActiveSessions(): Promise<any[]> {
		return this._sessionManager.activeSessions.map(session => ({
			sessionId: session.sessionId,
			sessionName: session.sessionId,
			sessionMode: session.metadata.sessionMode as any,
			runtimeMetadata: session.runtimeMetadata
		}));
	}

	async $getForegroundSession(): Promise<string | undefined> {
		return this._sessionManager.foregroundSession?.sessionId;
	}

	async $getNotebookSession(notebookUri: URI): Promise<string | undefined> {
		const uri = URI.revive(notebookUri);
		const session = this._sessionManager.getNotebookSessionForNotebookUri(uri.toString());
		return session?.sessionId;
	}

	async $selectLanguageRuntime(runtimeId: string): Promise<void> {
		await this._sessionManager.selectRuntime(runtimeId, 'Extension-requested via API');
	}

	async $getRegisteredRuntimes(): Promise<ILanguageRuntimeMetadata[]> {
		return Array.from(this._registeredRuntimes.values());
	}

	async $startLanguageRuntime(
		runtimeId: string,
		sessionName: string,
		sessionMode: number,
		notebookUri: URI | undefined
	): Promise<string> {
		const runtime = this._registeredRuntimes.get(runtimeId);
		if (!runtime) {
			throw new Error(`Runtime not found: ${runtimeId}`);
		}

		const session = await this._sessionManager.startSession(runtime, sessionMode as unknown as LanguageRuntimeSessionMode, sessionName);
		return session.sessionId;
	}

	// ===== ILanguageRuntimeManager Implementation =====

	async createSession(
		runtimeMetadata: ILanguageRuntimeMetadata,
		sessionMetadata: any
	): Promise<ILanguageRuntimeSession> {
		const initialState = await this._proxy.$createLanguageRuntimeSession(runtimeMetadata, sessionMetadata);

		const session = new ExtHostRuntimeSessionAdapter(
			initialState.handle,
			runtimeMetadata,
			{ sessionMode: sessionMetadata.sessionMode },
			sessionMetadata,
			this._proxy,
			this._logService
		);

		this._sessions.set(initialState.handle, session);
		this._sessionIdToHandle.set(session.sessionId, initialState.handle);

		await session.start();

		return session;
	}

	async validateMetadata(metadata: ILanguageRuntimeMetadata): Promise<ILanguageRuntimeMetadata> {
		return await this._proxy.$validateLanguageRuntimeMetadata(metadata);
	}

	async validateSession(sessionId: string): Promise<boolean> {
		const handle = this._sessionIdToHandle.get(sessionId);
		if (handle === undefined) {
			return false;
		}
		return this._sessions.has(handle);
	}

	async $restartSession(handle: number): Promise<void> {
		const session = this.findSession(handle);
		await session.restart();
	}

	async $interruptSession(handle: number): Promise<void> {
		const session = this.findSession(handle);
		session.interrupt();
	}

	$focusSession(handle: number): void {
		const session = this.findSession(handle);
		this._sessionManager.focusSession(session.sessionId);
	}

	async $executeCode(
		languageId: string,
		_extensionId: string,
		code: string,
		_focus: boolean,
		_allowIncomplete?: boolean,
		_mode?: any,
		_errorBehavior?: any,
		executionId?: string,
		batchId?: string,
		filePath?: string
	): Promise<string> {
		const finalExecutionId = executionId || `exec-${Date.now()}`;

		try {
			await this._consoleService.executeCode(code, languageId, CodeAttributionSource.Extension, finalExecutionId, batchId, _extensionId, filePath);
		} catch (error) {
			this._logService.error(`[MainThreadRuntime] Failed to execute code for language '${languageId}': ${error instanceof Error ? error.message : String(error)}`);
			throw error;
		}

		return finalExecutionId;
	}

	$registerQuartoExecution(executionId: string): void {
		this._quartoExecutionIds.add(executionId);
	}

	// ===== Helper Methods =====

	private findSession(handle: number): ExtHostRuntimeSessionAdapter {
		const session = this._sessions.get(handle);
		if (!session) {
			throw new Error(`Session not found for handle: ${handle}`);
		}
		return session;
	}

	private registerQuartoExecution(executionId: string): void {
		this._quartoExecutionIds.add(executionId);
	}
}
