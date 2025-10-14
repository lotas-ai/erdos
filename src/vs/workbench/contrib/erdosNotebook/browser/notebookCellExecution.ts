/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { DeferredPromise } from '../../../../base/common/async.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { VSBuffer, decodeBase64 } from '../../../../base/common/buffer.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ILanguageRuntimeSession, RuntimeState, RuntimeCodeExecutionMode } from '../../../services/languageRuntime/common/languageRuntimeTypes.js';
import { INotebookCellExecution } from '../../notebook/common/notebookExecutionStateService.js';
import { CellExecutionUpdateType } from '../../notebook/common/notebookExecutionService.js';
import { IOutputItemDto } from '../../notebook/common/notebookCommon.js';

/**
 * Handles execution of a single notebook cell by subscribing to runtime session events
 * and updating the cell's output in real-time.
 */
export class NotebookCellExecution extends Disposable {
	public readonly executionId = generateUuid();
	private readonly _completionPromise = new DeferredPromise<void>();
	private _completed = false;
	private _accumulatedText: string = '';
	private _textOutputId: string | undefined;

	constructor(
		private readonly _session: ILanguageRuntimeSession,
		private readonly _cellExecution: INotebookCellExecution,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		// Subscribe to all message types from the session
		this._register(this._session.onDidReceiveRuntimeMessageStream((msg: any) => {
			if (msg.parent_id === this.executionId && !this._completed) {
				this._handleStreamMessage(msg);
			}
		}));

		this._register(this._session.onDidReceiveRuntimeMessageOutput((msg: any) => {
			if (msg.parent_id === this.executionId && !this._completed) {
				this._handleOutputMessage(msg);
			}
		}));

		this._register(this._session.onDidReceiveRuntimeMessageResult((msg: any) => {
			if (msg.parent_id === this.executionId && !this._completed) {
				this._handleResultMessage(msg);
			}
		}));

		this._register(this._session.onDidReceiveRuntimeMessageError((msg: any) => {
			if (msg.parent_id === this.executionId && !this._completed) {
				this._handleErrorMessage(msg);
			}
		}));

		this._register(this._session.onDidChangeRuntimeState((state: RuntimeState) => {
			if (state === RuntimeState.Idle || state === RuntimeState.Ready) {
				if (!this._completed) {
					this._complete(true);
				}
			}
		}));

		// Clear existing outputs and start execution
		this._accumulatedText = ''; // Reset for new execution
		this._textOutputId = undefined;
		this._cellExecution.update([
			{
				editType: CellExecutionUpdateType.ExecutionState,
				runStartTime: Date.now(),
			},
			{
				editType: CellExecutionUpdateType.Output,
				cellHandle: this._cellExecution.cellHandle,
				outputs: [],
			}
		]);
	}

	private _handleStreamMessage(msg: any): void {
		// Handle stdout/stderr streaming (real-time output)
		let mime: string;
		if (msg.name === 'stdout') {
			mime = 'application/vnd.code.notebook.stdout';
		} else if (msg.name === 'stderr') {
			mime = 'application/vnd.code.notebook.stderr';
		} else {
			this._logService.warn(`[NotebookCellExecution] Unknown stream name: ${msg.name}`);
			return;
		}

		const outputItem: IOutputItemDto = {
			data: VSBuffer.fromString(msg.text),
			mime
		};

		// Append to existing output if it's the same stream type, otherwise create new output
		this._cellExecution.update([{
			editType: CellExecutionUpdateType.Output,
			cellHandle: this._cellExecution.cellHandle,
			append: true,
			outputs: [{
				outputId: generateUuid(),
				outputs: [outputItem],
			}]
		}]);
	}

	private _handleOutputMessage(msg: any): void {
		// Handle display_data (plots, tables, etc.)
		const outputItems = this._convertDataToOutputItems(msg.data);
		if (outputItems.length > 0) {
			// Check if this is text output
			const isTextOutput = outputItems.length === 1 && outputItems[0].mime === 'text/plain';
			
			if (isTextOutput) {
				// Accumulate text output
				const textData = outputItems[0].data;
				const newText = textData.toString();
				this._accumulatedText += newText;
				
				const isFirstTextOutput = !this._textOutputId;
				
				// Create or update the text output
				if (!this._textOutputId) {
					this._textOutputId = generateUuid();
				}
				
				// Replace the entire text output with accumulated text
				this._cellExecution.update([{
					editType: CellExecutionUpdateType.Output,
					cellHandle: this._cellExecution.cellHandle,
					append: isFirstTextOutput, // Only append if first time, otherwise replace
					outputs: [{
						outputId: this._textOutputId,
						outputs: [{
							mime: 'text/plain',
							data: VSBuffer.fromString(this._accumulatedText)
						}],
					}]
				}]);
			} else {
				// Non-text output (images, plots, etc.) - create separate output
				// Reset text accumulation since we're breaking the text stream
				this._accumulatedText = '';
				this._textOutputId = undefined;
				
				this._cellExecution.update([{
					editType: CellExecutionUpdateType.Output,
					cellHandle: this._cellExecution.cellHandle,
					append: true,
					outputs: [{
						outputId: generateUuid(),
						outputs: outputItems,
					}]
				}]);
			}
		}
	}

	private _handleResultMessage(msg: any): void {
		// Handle execute_result (return values)
		const outputItems = this._convertDataToOutputItems(msg.data);
		if (outputItems.length > 0) {
			this._cellExecution.update([{
				editType: CellExecutionUpdateType.Output,
				cellHandle: this._cellExecution.cellHandle,
				append: true,
				outputs: [{
					outputId: generateUuid(),
					outputs: outputItems,
				}]
			}]);
		}
	}

	private _handleErrorMessage(msg: any): void {
		// Handle errors
		const errorOutput: IOutputItemDto = {
			data: VSBuffer.fromString(JSON.stringify({
				name: msg.name || 'Error',
				message: msg.message || '',
				stack: (msg.traceback || []).join('\n'),
			}, undefined, '\t')),
			mime: 'application/vnd.code.notebook.error',
		};

		this._cellExecution.update([{
			editType: CellExecutionUpdateType.Output,
			cellHandle: this._cellExecution.cellHandle,
			append: true,
			outputs: [{
				outputId: generateUuid(),
				outputs: [errorOutput],
			}]
		}]);

		// Complete with error
		this._complete(false);
	}

	private _convertDataToOutputItems(data: any): IOutputItemDto[] {
		const items: IOutputItemDto[] = [];
		if (!data) {
			return items;
		}

		for (const [mime, value] of Object.entries(data)) {
			if (mime === 'text/plain' || mime === 'text/html') {
				items.push({
					data: VSBuffer.fromString(String(value)),
					mime
				});
			} else if (mime === 'image/png' || mime === 'image/jpeg') {
				// Decode base64-encoded images
				try {
					const buffer = decodeBase64(String(value));
					items.push({ data: buffer, mime });
				} catch (err) {
					this._logService.error(`Failed to decode image: ${err}`);
				}
			} else if (mime.startsWith('application/')) {
				// JSON-based outputs (plots, widgets, etc.)
				items.push({
					data: VSBuffer.fromString(typeof value === 'string' ? value : JSON.stringify(value)),
					mime
				});
			}
		}

		return items;
	}

	private _complete(success: boolean): void {
		if (this._completed) {
			return;
		}
		this._completed = true;

		this._cellExecution.complete({
			runEndTime: Date.now(),
			lastRunSuccess: success,
		});

		if (success) {
			this._completionPromise.complete();
		} else {
			this._completionPromise.error(new Error('Cell execution failed'));
		}

		this.dispose();
	}

	public start(code: string, batchId?: string): void {
		// Execute the code on the runtime session
		this._session.execute(code, this.executionId, RuntimeCodeExecutionMode.Interactive, undefined, batchId);
	}

	public get promise(): Promise<void> {
		return this._completionPromise.p;
	}
}

