/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { AsyncIterableObject } from '../../../../base/common/async.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ILanguageRuntimeMetadata } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { ISessionManager } from '../../../services/languageRuntime/common/sessionManager.js';
import { RuntimeCodeExecutionMode, RuntimeErrorBehavior } from '../../../services/languageRuntime/common/languageRuntimeTypes.js';
import { CodeAttributionSource, ILanguageRuntimeCodeExecutedEvent, IConsoleCodeAttribution } from '../../../services/languageRuntime/common/codeExecution.js';
import { INotebookKernel, INotebookKernelChangeEvent, VariablesResult } from '../../notebook/common/notebookKernelService.js';
import { INotebookExecutionStateService } from '../../notebook/common/notebookExecutionStateService.js';
import { INotebookService } from '../../notebook/common/notebookService.js';
import { NotebookCellExecution } from './notebookCellExecution.js';
import { IConsoleService } from '../../../services/erdosConsole/common/consoleService.js';

/**
 * A notebook kernel that executes cells using the shared console runtime session.
 */
export class ErdosNotebookKernel extends Disposable implements INotebookKernel {
	public readonly viewType = 'jupyter-notebook';
	public readonly extension = new ExtensionIdentifier('erdos-notebook-kernel');
	public readonly preloadUris: URI[] = [];
	public readonly preloadProvides: string[] = [];
	public readonly implementsInterrupt = true;
	public readonly implementsExecutionOrder = true;
	public readonly hasVariableProvider = false;
	public readonly localResourceRoot = URI.parse('');

	private readonly _onDidChange = this._register(new Emitter<INotebookKernelChangeEvent>());
	public readonly onDidChange: Event<INotebookKernelChangeEvent> = this._onDidChange.event;

	constructor(
		public readonly runtime: ILanguageRuntimeMetadata,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
		@INotebookService private readonly _notebookService: INotebookService,
		@INotebookExecutionStateService private readonly _notebookExecutionStateService: INotebookExecutionStateService,
		@ISessionManager private readonly _sessionManager: ISessionManager,
		@IConsoleService private readonly _consoleService: IConsoleService,
		@ICommandService private readonly _commandService: ICommandService,
	) {
		super();
	}

	get id(): string {
		return `erdos-notebook-kernel/${this.runtime.runtimeId}`;
	}

	get label(): string {
		return this.runtime.runtimeName;
	}

	get description(): string {
		return this.runtime.runtimePath;
	}

	get detail(): string | undefined {
		return undefined;
	}

	get supportedLanguages(): string[] {
		return ['r', 'python', 'raw'];
	}

	async executeNotebookCellsRequest(notebookUri: URI, cellHandles: number[]): Promise<void> {
		try {
			this._logService.debug(`[ErdosNotebookKernel] Executing ${cellHandles.length} cells for notebook ${notebookUri.fsPath}`);

			// Get the notebook
			const notebook = this._notebookService.getNotebookTextModel(notebookUri);
			if (!notebook) {
				throw new Error(`No notebook found for ${notebookUri.fsPath}`);
			}

		// Get the console session for this language (shared runtime)
		let session = this._sessionManager.getConsoleSessionForLanguage(this.runtime.languageId);
		if (!session) {
			// No session exists - open the picker to let user start one
			this._logService.info(`[ErdosNotebookKernel] No session found for ${this.runtime.languageId}, opening session picker`);
			await this._commandService.executeCommand('erdos.languageRuntime.startNewSession');
			
			// Check again after user action
			session = this._sessionManager.getConsoleSessionForLanguage(this.runtime.languageId);
			if (!session) {
				// User cancelled or failed to start
				this._logService.warn(`[ErdosNotebookKernel] No session available after picker, aborting execution`);
				return;
			}
		}

			// Generate a batch ID for this group of cells
			const batchId = generateUuid();

			// Execute each cell sequentially
			for (const cellHandle of cellHandles) {
				const cell = notebook.cells.find(c => c.handle === cellHandle);
				if (!cell) {
					this._logService.warn(`[ErdosNotebookKernel] Cell ${cellHandle} not found, skipping`);
					continue;
				}

				// Skip raw cells
				if (cell.language === 'raw') {
					continue;
				}

				// Skip empty cells
				const code = cell.getValue();
				if (!code.trim()) {
					continue;
				}

				// Get the cell execution from VSCode
				const cellExecution = this._notebookExecutionStateService.getCellExecution(cell.uri);
				if (!cellExecution) {
					this._logService.error(`[ErdosNotebookKernel] No execution state for cell ${cell.uri}`);
					continue;
				}

			// Create our execution handler
			const execution = this._register(
				this._instantiationService.createInstance(NotebookCellExecution, session, cellExecution)
			);

			// Mark this execution as notebook-originated for console mirroring
			this._consoleService.markExecutionAsNotebookOriginated(execution.executionId);

			// Record the execution for plot attribution tracking
			const attribution: IConsoleCodeAttribution = {
				source: CodeAttributionSource.Notebook,
				batchId,
				metadata: {
					filePath: notebookUri.fsPath,
					cellHandle: cell.handle
				}
			};

			const executionEvent: ILanguageRuntimeCodeExecutedEvent = {
				executionId: execution.executionId,
				sessionId: session.sessionId,
				attribution,
				code,
				languageId: this.runtime.languageId,
				runtimeName: session.runtimeMetadata.runtimeName,
				errorBehavior: RuntimeErrorBehavior.Continue,
				mode: RuntimeCodeExecutionMode.Interactive
			};

			this._consoleService.recordCodeExecution(executionEvent);

			// Start the execution
			execution.start(code, batchId);

				// Wait for this cell to complete before moving to the next
				await execution.promise;
			}
		} catch (err) {
			this._logService.error(`[ErdosNotebookKernel] Error executing cells: ${err}`);
		}
	}

	async cancelNotebookCellExecution(_notebookUri: URI, _cellHandles: number[]): Promise<void> {
		// Interrupt the session
		const session = this._sessionManager.getConsoleSessionForLanguage(this.runtime.languageId);
		if (session) {
			session.interrupt();
		}
	}

	provideVariables(_notebookUri: URI, _parentId: number | undefined, _kind: 'named' | 'indexed', _start: number, _token: CancellationToken): AsyncIterableObject<VariablesResult> {
		return AsyncIterableObject.EMPTY;
	}
}

