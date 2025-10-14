/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as erdos from 'erdos';
import { Emitter, Event } from '../../../base/common/event.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { ExtHostRuntimeShape, MainContext, MainThreadRuntimeShape } from './extHost.protocol.js';
import { IExtHostInitDataService } from './extHostInitDataService.js';
import { IExtHostRpcService } from './extHostRpcService.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { SerializableObjectWithBuffers } from '../../services/extensions/common/proxyIdentifier.js';

export const IExtHostRuntime = createDecorator<IExtHostRuntime>('IExtHostRuntime');

export interface IExtHostRuntime extends ExtHostRuntime {
	readonly _serviceBrand: undefined;
}

export class ExtHostRuntime implements ExtHostRuntimeShape {
	declare readonly _serviceBrand: undefined;

	private readonly _proxy: MainThreadRuntimeShape;
	private readonly _managers = new Map<string, erdos.LanguageRuntimeManager>();
	private readonly _sessions = new Map<number, any>();
	private readonly _sessionIdToHandle = new Map<string, number>();
	private _nextHandle = 0;

	private readonly _onDidRegisterRuntime = new Emitter<erdos.LanguageRuntimeMetadata>();
	private readonly _onDidChangeForegroundSession = new Emitter<string>();
	
	readonly onDidRegisterRuntime: Event<erdos.LanguageRuntimeMetadata> = this._onDidRegisterRuntime.event;
	readonly onDidChangeForegroundSession: Event<string> = this._onDidChangeForegroundSession.event;

	constructor(
		@IExtHostRpcService extHostRpc: IExtHostRpcService,
		@IExtHostInitDataService _initData: IExtHostInitDataService,
		@ILogService private readonly _logService: ILogService,
	) {
		this._proxy = extHostRpc.getProxy(MainContext.MainThreadRuntime);
	}

	// ===== Called by extensions =====

	registerLanguageRuntimeManager(languageId: string, manager: erdos.LanguageRuntimeManager): { dispose: () => void } {
		this._managers.set(languageId, manager);
		this._logService.info(`[ExtHostRuntime] Registered manager for ${languageId}`);

		// Start discovery for this language
		this.discoverRuntimesForLanguage(languageId, manager);

		return {
			dispose: () => {
				this._managers.delete(languageId);
			}
		};
	}

	private async discoverRuntimesForLanguage(languageId: string, manager: erdos.LanguageRuntimeManager): Promise<void> {
		try {
			const runtimes = manager.discoverAllRuntimes();
			for await (const runtime of runtimes) {
				this._proxy.$registerLanguageRuntime(runtime);
				this._onDidRegisterRuntime.fire(runtime);
			}
			this._proxy.$completeLanguageRuntimeDiscovery();
		} catch (err) {
			this._logService.error(`[ExtHostRuntime] Discovery failed for ${languageId}:`, err);
		}
	}

	async getActiveSessions(): Promise<erdos.LanguageRuntimeSession[]> {
		const sessionMetadatas = await this._proxy.$getActiveSessions();
		return sessionMetadatas.map((meta: any) => ({
			sessionId: meta.sessionId,
			metadata: {
				sessionId: meta.sessionId,
				sessionName: meta.sessionName,
				sessionMode: meta.sessionMode
			},
			runtimeMetadata: meta.runtimeMetadata
		} as any));
	}

	async getPreferredRuntime(languageId: string): Promise<erdos.LanguageRuntimeMetadata | undefined> {
		return await this._proxy.$getPreferredRuntime(languageId);
	}

	async selectLanguageRuntime(languageId: string): Promise<erdos.LanguageRuntimeMetadata | undefined> {
		return await this.getPreferredRuntime(languageId);
	}

	async executeCode(
		languageId: string,
		code: string,
		focus: boolean,
		allowIncomplete?: boolean,
		mode?: any,
		errorBehavior?: any,
		observer?: any,
		executionId?: string,
		batchId?: string,
		filePath?: string
	): Promise<Record<string, any>> {
		const execId = executionId || generateUuid();
		this._logService.trace(`[ExtHostRuntime] executeCode called with batchId: ${batchId}, filePath: ${filePath}`);
		await this._proxy.$executeCode(languageId, '', code, focus, allowIncomplete, mode, errorBehavior, execId, batchId, filePath);
		return { executionId: execId };
	}

	$notifyForegroundSessionChanged(sessionId: string | undefined): void {
		if (sessionId) {
			this._onDidChangeForegroundSession.fire(sessionId);
		}
	}

	// ===== Called by MainThread to create sessions =====

	async $createLanguageRuntimeSession(runtimeMetadata: any, sessionMetadata: any): Promise<any> {
		const manager = this._managers.get(runtimeMetadata.languageId);
		if (!manager) {
			throw new Error(`No runtime manager for ${runtimeMetadata.languageId}`);
		}

		this._logService.info(`[ExtHostRuntime] Creating session for ${runtimeMetadata.languageId}`);

		// Call the extension's createSession
		const session = await manager.createSession(runtimeMetadata, sessionMetadata);

		// Store it with a handle
		const handle = this._nextHandle++;
		this._sessions.set(handle, session);
		this._sessionIdToHandle.set(session.sessionId, handle);

		// Wire up event forwarding to main thread
		if (session.onDidReceiveRuntimeMessage) {
			session.onDidReceiveRuntimeMessage((message: any) => {
				this._proxy.$emitLanguageRuntimeMessage(handle, false, new SerializableObjectWithBuffers(message));
			});
		}

		if (session.onDidChangeRuntimeState) {
			session.onDidChangeRuntimeState((state: any) => {
				this._proxy.$emitLanguageRuntimeState(handle, Date.now(), state);
			});
		}

		if (session.onDidEndSession) {
			session.onDidEndSession((exit: any) => {
				this._proxy.$emitLanguageRuntimeExit(handle, exit);
			});
		}

		if ((session as any).onDidReceiveRuntimeClientEvent) {
			(session as any).onDidReceiveRuntimeClientEvent((event: { name: string; data: Record<string, unknown> }) => {
				this._proxy.$emitLanguageRuntimeClientEvent(handle, event);
			});
		}

		return {
			handle,
			dynState: {
				inputPrompt: session.dynState?.inputPrompt || '>>> ',
				continuationPrompt: session.dynState?.continuationPrompt || '... '
			}
		};
	}

	async $validateLanguageRuntimeMetadata(metadata: any): Promise<any> {
		const manager = this._managers.get(metadata.languageId);
		if (!manager || !manager.validateMetadata) {
			return metadata;
		}
		return await manager.validateMetadata(metadata);
	}

	async $validateLanguageRuntimeSession(metadata: any, sessionId: string): Promise<boolean> {
		const manager = this._managers.get(metadata.languageId);
		if (!manager || !manager.validateSession) {
			return true;
		}
		return await manager.validateSession(sessionId);
	}

	async $startLanguageRuntime(handle: number): Promise<any> {
		const session = this._sessions.get(handle);
		if (!session) {
			throw new Error(`Session not found: ${handle}`);
		}

		if (session.start) {
			const info = await session.start();
			return info || {
				runtimeId: session.runtimeMetadata.runtimeId,
				runtimeName: session.runtimeMetadata.runtimeName,
				languageId: session.runtimeMetadata.languageId,
				languageName: session.runtimeMetadata.languageName,
				languageVersion: session.runtimeMetadata.languageVersion,
				runtimePath: session.runtimeMetadata.runtimePath,
				runtimeVersion: session.runtimeMetadata.runtimeVersion,
				runtimeSource: session.runtimeMetadata.runtimeSource
			};
		}

		return {};
	}

	async $executeCode(handle: number, code: string, id: string, mode: any, errorBehavior: any, executionId?: string, batchId?: string, filePath?: string): Promise<void> {
		this._logService.trace(`[ExtHostRuntime] $executeCode called for handle ${handle} with batchId: ${batchId}, filePath: ${filePath}`);
		const session = this._sessions.get(handle);
		if (session?.execute) {
			this._logService.trace(`[ExtHostRuntime] Calling session.execute with batchId and filePath`);
			session.execute(code, id, mode, errorBehavior, batchId, filePath);
		}
	}

	async $isCodeFragmentComplete(handle: number, code: string): Promise<any> {
		const session = this._sessions.get(handle);
		if (session?.isCodeFragmentComplete) {
			return await session.isCodeFragmentComplete(code);
		}
		return 0; // Complete
	}

	async $interruptLanguageRuntime(handle: number): Promise<void> {
		const session = this._sessions.get(handle);
		if (session?.interrupt) {
			await session.interrupt();
		}
	}

	async $replyToInput(handle: number, parentId: string, value: string): Promise<void> {
		const session = this._sessions.get(handle);
		if (session?.replyToInput) {
			session.replyToInput(parentId, value);
		}
	}

	async $restartSession(handle: number): Promise<void> {
		const session = this._sessions.get(handle);
		if (session?.restart) {
			await session.restart();
		}
	}

	async $shutdownLanguageRuntime(handle: number, exitReason: any): Promise<void> {
		const session = this._sessions.get(handle);
		if (session?.shutdown) {
			await session.shutdown(exitReason);
		}
		this._sessions.delete(handle);
	}

	async $forceQuitLanguageRuntime(handle: number): Promise<void> {
		const session = this._sessions.get(handle);
		if (session?.forceQuit) {
			await session.forceQuit();
		}
		this._sessions.delete(handle);
	}

	async $setWorkingDirectory(handle: number, directory: string): Promise<void> {
		const session = this._sessions.get(handle);
		if (session?.setWorkingDirectory) {
			await session.setWorkingDirectory(directory);
		}
	}

	async $createClient(handle: number, id: string, type: any, params: any, metadata?: any): Promise<void> {
		const session = this._sessions.get(handle);
		if (session?.createClient) {
			await session.createClient(id, type, params, metadata);
		}
	}

	async $listClients(handle: number, type?: any): Promise<Record<string, any>> {
		const session = this._sessions.get(handle);
		if (session?.listClients) {
			const clients = await session.listClients(type);
			// Convert array to Record keyed by client_id
			const record: Record<string, any> = {};
			if (Array.isArray(clients)) {
				for (const client of clients) {
					if (client && client.client_id) {
						record[client.client_id] = client;
					}
				}
			}
			return record;
		}
		return {};
	}

	async $sendClientMessage(handle: number, clientId: string, data: any): Promise<void> {
		const session = this._sessions.get(handle);
		if (session && typeof (session as any).sendClientMessage === 'function') {
			const messageId = generateUuid();
			await (session as any).sendClientMessage(clientId, messageId, data);
		}
	}

	async $removeClient(handle: number, clientId: string): Promise<void> {
		const session = this._sessions.get(handle);
		if (session && typeof (session as any).removeClient === 'function') {
			(session as any).removeClient(clientId);
		}
	}

	$discoverLanguageRuntimes(_disabledLanguageIds: string[]): void {
		// Discovery happens automatically when managers register
	}

	async $recommendWorkspaceRuntimes(_disabledLanguageIds: string[]): Promise<any[]> {
		return [];
	}

	$notifyCodeExecuted(_event: any): void {
		// No-op for now
	}
}

