/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { ILanguageRuntimeMetadata, ILanguageRuntimeSession, LanguageRuntimeSessionMode, RuntimeExitReason } from './languageRuntimeTypes.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { generateUuid } from '../../../../base/common/uuid.js';

export const ISessionManager = createDecorator<ISessionManager>('sessionManager');

export interface ILanguageRuntimeManager {
	createSession(runtimeMetadata: ILanguageRuntimeMetadata, sessionMetadata: any): Promise<ILanguageRuntimeSession>;
	validateMetadata(metadata: ILanguageRuntimeMetadata): Promise<ILanguageRuntimeMetadata>;
	validateSession(sessionId: string): Promise<boolean>;
}

export interface ISessionManager {
	readonly _serviceBrand: undefined;
	readonly activeSessions: ILanguageRuntimeSession[];
	foregroundSession: ILanguageRuntimeSession | undefined;
	readonly onDidStartSession: Event<ILanguageRuntimeSession>;
	readonly onDidEndSession: Event<string>;
	readonly onDidChangeForegroundSession: Event<ILanguageRuntimeSession | undefined>;
	startSession(runtimeMetadata: ILanguageRuntimeMetadata, sessionMode: LanguageRuntimeSessionMode, sessionName: string, notebookUri?: string): Promise<ILanguageRuntimeSession>;
	getSession(sessionId: string): ILanguageRuntimeSession | undefined;
	getConsoleSessionForLanguage(languageId: string): ILanguageRuntimeSession | undefined;
	getConsoleSessionForRuntime(runtimeId: string): ILanguageRuntimeSession | undefined;
	shutdownSession(sessionId: string): Promise<void>;
	startNewRuntimeSession(runtimeId: string, sessionName: string, sessionMode: LanguageRuntimeSessionMode, notebookUri?: string): Promise<ILanguageRuntimeSession>;
	registerRuntime(runtime: ILanguageRuntimeMetadata): void;
	getPreferredRuntime(languageId: string): ILanguageRuntimeMetadata | undefined;
	restartSession(sessionId: string, sessionName: string): Promise<ILanguageRuntimeSession>;
	interruptSession(sessionId: string): Promise<void>;
	focusSession(sessionId: string): void;
	getNotebookSessionForNotebookUri(notebookUri: string): ILanguageRuntimeSession | undefined;
	selectRuntime(runtimeId: string, source: string): Promise<void>;
	registerLanguageRuntimeManager(languageId: string, manager: ILanguageRuntimeManager): void;
	completeDiscovery(): void;
}

export class SessionManager extends Disposable implements ISessionManager {
	declare readonly _serviceBrand: undefined;

	private readonly _sessions = new Map<string, ILanguageRuntimeSession>();
	private readonly _runtimes = new Map<string, ILanguageRuntimeMetadata>();
	private readonly _notebookSessions = new Map<string, ILanguageRuntimeSession>();
	private readonly _runtimeManagers = new Map<string, ILanguageRuntimeManager>();
	private _foregroundSession: ILanguageRuntimeSession | undefined;
	private readonly _onDidStartSession = this._register(new Emitter<ILanguageRuntimeSession>());
	private readonly _onDidEndSession = this._register(new Emitter<string>());
	private readonly _onDidChangeForegroundSession = this._register(new Emitter<ILanguageRuntimeSession | undefined>());

	readonly onDidStartSession = this._onDidStartSession.event;
	readonly onDidEndSession = this._onDidEndSession.event;
	readonly onDidChangeForegroundSession = this._onDidChangeForegroundSession.event;

	constructor(
	) {
		super();
	}

	get activeSessions(): ILanguageRuntimeSession[] {
		return Array.from(this._sessions.values());
	}

	get foregroundSession(): ILanguageRuntimeSession | undefined {
		return this._foregroundSession;
	}

	set foregroundSession(session: ILanguageRuntimeSession | undefined) {
		if (this._foregroundSession !== session) {
			this._foregroundSession = session;
			this._onDidChangeForegroundSession.fire(session);
		}
	}

	// Sessions are created by calling the extension's LanguageRuntimeManager.createSession()
	// The extension (erdos-python, erdos-kernel-manager) handles WebSocket connections
	async startSession(
		runtimeMetadata: ILanguageRuntimeMetadata,
		sessionMode: LanguageRuntimeSessionMode,
		sessionName: string,
		notebookUri?: string
	): Promise<ILanguageRuntimeSession> {
		// Find the manager for this language
		const manager = this._runtimeManagers.get(runtimeMetadata.languageId);
		if (!manager) {
			throw new Error(`No runtime manager registered for language: ${runtimeMetadata.languageId}`);
		}
		
		// Generate a session ID
		const sessionId = `${runtimeMetadata.languageId}-${generateUuid()}`;
		
		const sessionMetadata = {
			sessionId,
			sessionName,
			sessionMode,
			notebookUri
		};
		
		// Call the extension's createSession method
		// The extension creates the session with WebSocket connection to erdos-kernel-manager
		const session = await manager.createSession(runtimeMetadata, sessionMetadata);
		
		// Register the session
		this.registerSession(session);
		
		// Track notebook sessions
		if (notebookUri) {
			this._notebookSessions.set(notebookUri, session);
		}
		
		// Auto-focus console sessions
		if (sessionMode === LanguageRuntimeSessionMode.Console) {
			this.foregroundSession = session;
		}
		
		return session;
	}

	// Called by extensions when they create a session
	registerSession(session: ILanguageRuntimeSession): void {
		const sessionId = session.sessionId;
		this._sessions.set(sessionId, session);

	this._register(session);
	
	// Handle session end
	this._register(session.onDidEndSession(() => {
		this._sessions.delete(sessionId);
		if (this._foregroundSession === session) {
			this.foregroundSession = undefined;
		}
		this._onDidEndSession.fire(sessionId);
	}));

		this._onDidStartSession.fire(session);
	}

	getSession(sessionId: string): ILanguageRuntimeSession | undefined {
		return this._sessions.get(sessionId);
	}

	getConsoleSessionForLanguage(languageId: string): ILanguageRuntimeSession | undefined {
		return this.activeSessions.find(session =>
			session.runtimeMetadata.languageId === languageId &&
			session.metadata.sessionMode === LanguageRuntimeSessionMode.Console
		);
	}

	getConsoleSessionForRuntime(runtimeId: string): ILanguageRuntimeSession | undefined {
		return this.activeSessions.find(session =>
			session.runtimeMetadata.runtimeId === runtimeId &&
			session.metadata.sessionMode === LanguageRuntimeSessionMode.Console
		);
	}

	async shutdownSession(sessionId: string): Promise<void> {
		const session = this._sessions.get(sessionId);
		if (session) {
			if (this._foregroundSession === session) {
				this.foregroundSession = undefined;
			}
			
			for (const [uri, notebookSession] of this._notebookSessions.entries()) {
				if (notebookSession === session) {
					this._notebookSessions.delete(uri);
				}
			}
			
			await session.shutdown(RuntimeExitReason.Shutdown);
			session.dispose();
			this._sessions.delete(sessionId);
			this._onDidEndSession.fire(sessionId);
		}
	}

	async startNewRuntimeSession(
		runtimeId: string,
		sessionName: string,
		sessionMode: LanguageRuntimeSessionMode,
		notebookUri?: string
	): Promise<ILanguageRuntimeSession> {
		const runtime = this._runtimes.get(runtimeId);
		if (!runtime) {
			throw new Error(`Runtime not found: ${runtimeId}`);
		}

		const session = await this.startSession(runtime, sessionMode, sessionName);
		
		if (notebookUri) {
			this._notebookSessions.set(notebookUri, session);
		}
		
		return session;
	}

	registerRuntime(runtime: ILanguageRuntimeMetadata): void {
		this._runtimes.set(runtime.runtimeId, runtime);
	}

	getPreferredRuntime(languageId: string): ILanguageRuntimeMetadata | undefined {
		// Find first runtime for this language
		for (const runtime of this._runtimes.values()) {
			if (runtime.languageId === languageId) {
				return runtime;
			}
		}
		return undefined;
	}

	async restartSession(sessionId: string, sessionName: string): Promise<ILanguageRuntimeSession> {
		const session = this._sessions.get(sessionId);
		if (!session) {
			throw new Error(`Session not found: ${sessionId}`);
		}

		const runtime = session.runtimeMetadata;
		const mode = session.metadata.sessionMode;

		// Shutdown old session
		await this.shutdownSession(sessionId);

		// Start new session with same runtime
		return this.startSession(runtime, mode, sessionName);
	}

	async interruptSession(sessionId: string): Promise<void> {
		const session = this._sessions.get(sessionId);
		if (session) {
			session.interrupt();
		}
	}

	focusSession(sessionId: string): void {
		const session = this._sessions.get(sessionId);
		if (session) {
			this.foregroundSession = session;
		}
	}

	getNotebookSessionForNotebookUri(notebookUri: string): ILanguageRuntimeSession | undefined {
		return this._notebookSessions.get(notebookUri);
	}

	async selectRuntime(runtimeId: string, source: string): Promise<void> {
		const runtime = this._runtimes.get(runtimeId);
		if (!runtime) {
			throw new Error(`Runtime not found: ${runtimeId}`);
		}
	}

	registerLanguageRuntimeManager(languageId: string, manager: ILanguageRuntimeManager): void {
		this._runtimeManagers.set(languageId, manager);
	}

	completeDiscovery(): void {
	}
}

registerSingleton(ISessionManager, SessionManager, InstantiationType.Delayed);

