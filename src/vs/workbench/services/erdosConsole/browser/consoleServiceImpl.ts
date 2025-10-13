/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConsoleService } from '../common/consoleService.js';
import { ISessionManager } from '../../languageRuntime/common/sessionManager.js';
import { ILanguageRuntimeSession, RuntimeCodeExecutionMode, RuntimeErrorBehavior } from '../../languageRuntime/common/languageRuntimeTypes.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../base/common/event.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ILanguageRuntimeCodeExecutedEvent, CodeAttributionSource, IConsoleCodeAttribution } from '../../languageRuntime/common/codeExecution.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IPackageCheckerService } from '../../../contrib/packageChecker/common/packageChecker.js';

export class ConsoleServiceImpl extends Disposable implements IConsoleService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeActiveSession = this._register(new Emitter<ILanguageRuntimeSession | undefined>());
	readonly onDidChangeActiveSession = this._onDidChangeActiveSession.event;

	private readonly _onDidRequestClear = this._register(new Emitter<void>());
	readonly onDidRequestClear = this._onDidRequestClear.event;

	private readonly _onDidRequestPaste = this._register(new Emitter<string>());
	readonly onDidRequestPaste = this._onDidRequestPaste.event;

	private readonly _onDidExecuteCode = this._register(new Emitter<ILanguageRuntimeCodeExecutedEvent>());
	readonly onDidExecuteCode = this._onDidExecuteCode.event;

	private readonly _notebookExecutionIds = new Set<string>();

	constructor(
		@ISessionManager private readonly _sessionManager: ISessionManager,
		@ICommandService private readonly _commandService: ICommandService,
		@IPackageCheckerService private readonly _packageCheckerService: IPackageCheckerService,
	) {
		super();

		this._register(this._sessionManager.onDidChangeForegroundSession(() => {
			this._onDidChangeActiveSession.fire(this.activeSession);
		}));
	}

	get activeSession(): ILanguageRuntimeSession | undefined {
		return this._sessionManager.foregroundSession;
	}

	async executeCode(code: string, languageId: string, attributionSource: CodeAttributionSource, executionId?: string, batchId?: string, extensionId?: string, filePath?: string): Promise<void> {
		// Check for missing packages before execution (if supported language)
		// This BLOCKS until user decides what to do
		if ((languageId === 'python' || languageId === 'r') && this._packageCheckerService) {
			try {
				const shouldProceed = await this._packageCheckerService.checkPackagesBeforeExecution(code, languageId, false);
				if (!shouldProceed) {
					return; // Don't execute if user cancelled
				}
			} catch (error) {
				// Continue with execution on error
			}
		}

		// Find a session for this language
		let session = this._sessionManager.activeSessions.find(
			s => s.runtimeMetadata.languageId === languageId
		);

		// If no session exists, show the quickpick to select and start one
		if (!session) {
			await this._commandService.executeCommand('erdos.languageRuntime.startNewSession');
			
			// Check again if a session was started
			session = this._sessionManager.activeSessions.find(
				s => s.runtimeMetadata.languageId === languageId
			);
			
			if (!session) {
				throw new Error(`No ${languageId} session was started. Please start a session to execute code.`);
			}
		}

		// Set this session as the foreground session
		this._sessionManager.foregroundSession = session;

		const finalExecutionId = executionId || generateUuid();
		const finalBatchId = batchId || generateUuid();

		// Determine attribution source and include file path in metadata
		const metadata: Record<string, any> = extensionId ? { extensionId } : {};
		if (filePath) {
			metadata.filePath = filePath;
		}
		
		const attribution: IConsoleCodeAttribution = {
			source: attributionSource,
			batchId: finalBatchId,
			metadata
		};

		// Fire execution event for tracking (before execution, so ConsoleView can display the input)
		const event: ILanguageRuntimeCodeExecutedEvent = {
			executionId: finalExecutionId,
			sessionId: session.sessionId,
			attribution,
			code,
			languageId,
			runtimeName: session.runtimeMetadata.runtimeName,
			errorBehavior: RuntimeErrorBehavior.Continue,
			mode: RuntimeCodeExecutionMode.Interactive
		};
		this._onDidExecuteCode.fire(event);

		// Execute the code with batch ID and file path
		session.execute(code, finalExecutionId, RuntimeCodeExecutionMode.Interactive, RuntimeErrorBehavior.Continue, finalBatchId, filePath);
	}

	requestClearConsole(): void {
		this._onDidRequestClear.fire();
	}

	requestPasteText(text: string): void {
		this._onDidRequestPaste.fire(text);
	}

	markExecutionAsNotebookOriginated(executionId: string): void {
		this._notebookExecutionIds.add(executionId);
	}

	isNotebookExecution(executionId: string): boolean {
		return this._notebookExecutionIds.has(executionId);
	}

	recordCodeExecution(event: ILanguageRuntimeCodeExecutedEvent): void {
		this._onDidExecuteCode.fire(event);
	}
}

