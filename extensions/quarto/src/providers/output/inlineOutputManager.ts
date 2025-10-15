/*---------------------------------------------------------------------------------------------
 * Copyright (c) 2025 Lotas Inc. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Disposable } from "../../core/dispose";

// Runtime tracking for active chunks
interface ChunkState {
	currentExecutionId: string;              // Most recent execution ID
	viewZone: vscode.ViewZoneController | null;  // The native DOM view zone
	decoration: vscode.TextEditorDecorationType; // The decoration storing chunk ID
	lastOutputLength: number;                // Track how much output has been appended
	range: vscode.Range;                     // The cell range for this chunk
	viewZoneHandle?: number;                 // Handle for updating position in main thread
}

// Per-document state that persists across editor switches
interface DocumentState {
	chunkStates: Map<string, ChunkState>;
	executionToChunkId: Map<string, string>;
	cellOutputs: Map<string, string[]>;
	decorationToChunkId: Map<vscode.TextEditorDecorationType, string>;
}

export class QuartoInlineOutputManager extends Disposable {
	// EXACTLY matches Rao's architecture:
	// 1. Chunk ID stored in decoration metadata (like Rao's LineWidget.data)
	// 2. Query decorations by position to find chunk ID (like Rao's getLineWidgetForRow)
	// 3. Decorations automatically track position (like Rao's anchors)
	// 4. View zones managed by chunk ID, reused across re-executions
	
	// Per-document state storage for persistence across file switches
	private documentStates_ = new Map<string, DocumentState>();
	private currentDocumentUri_?: string;
	
	// Current active state (points to entry in documentStates_)
	private chunkStates_ = new Map<string, ChunkState>();   // chunkId -> runtime state
	private executionToChunkId_ = new Map<string, string>(); // executionId -> chunkId
	private cellOutputs_ = new Map<string, string[]>();      // executionId -> output lines
	private disposingChunks_ = new Set<string>();            // Track chunks being intentionally disposed
	private decorationToChunkId_ = new Map<vscode.TextEditorDecorationType, string>(); // decorationType -> chunkId
    private activeEditor_?: vscode.TextEditor;
	private isSwitchingEditors_ = false;                     // Flag to prevent cleanup during editor switches

    constructor() {
        super();

        this._register(vscode.window.onDidChangeActiveTextEditor(async (editor) => {
            this.isSwitchingEditors_ = true;
            
            if (this.currentDocumentUri_) {
                await this.saveCurrentDocumentState();
            }
            
            this.activeEditor_ = editor;
            
            if (!editor || (!editor.document.fileName.endsWith('.qmd') && !editor.document.fileName.endsWith('.rmd'))) {
                this.clearCurrentState();
                this.currentDocumentUri_ = undefined;
            } else {
                const newUri = editor.document.uri.toString();
                this.currentDocumentUri_ = newUri;
                await this.restoreDocumentState(newUri, editor);
            }
            
            this.isSwitchingEditors_ = false;
        }));

        this._register(vscode.workspace.onDidChangeTextDocument(async (event) => {
            if (this.activeEditor_ && event.document === this.activeEditor_.document) {
                const fileName = event.document.fileName;
                if (fileName.endsWith('.qmd') || fileName.endsWith('.rmd')) {
                    if (event.contentChanges.length === 0) {
                        return;
                    }
                    
                    for (const [decorationType, chunkId] of this.decorationToChunkId_.entries()) {
                        const decorations = await this.activeEditor_.getDecorationsInRange(decorationType);
                        if (decorations.length > 0) {
                            const newRange = decorations[0].range;
                            const state = this.chunkStates_.get(chunkId);
                            if (state) {
                                const newAfterLine = newRange.end.line + 1;
                                if (state.viewZone && state.range.end.line !== newRange.end.line) {
                                    state.viewZone.updatePosition(newAfterLine);
                                }
                                state.range = newRange;
                            }
                        }
                    }
                }
            }
        }));

        this.activeEditor_ = vscode.window.activeTextEditor;
        if (this.activeEditor_ && (this.activeEditor_.document.fileName.endsWith('.qmd') || this.activeEditor_.document.fileName.endsWith('.rmd'))) {
            this.currentDocumentUri_ = this.activeEditor_.document.uri.toString();
        }
    }

    public override dispose() {
        this.disposeAllChunks();
        super.dispose();
    }

    // Generate random chunk ID (matches Rao: "c" + random 12 chars)
    private generateChunkId(): string {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let id = 'c';
        for (let i = 0; i < 12; i++) {
            id += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return id;
    }

    // Save current document state (called when switching away from a document)
    private async saveCurrentDocumentState(): Promise<void> {
        if (!this.currentDocumentUri_) {
            return;
        }

        for (const [chunkId, state] of this.chunkStates_) {
            if (state.viewZone) {
                this.disposingChunks_.add(chunkId);
                state.viewZone.dispose();
                state.viewZone = null;
            }
        }

        this.documentStates_.set(this.currentDocumentUri_, {
            chunkStates: new Map(this.chunkStates_),
            executionToChunkId: new Map(this.executionToChunkId_),
            cellOutputs: new Map(this.cellOutputs_),
            decorationToChunkId: new Map(this.decorationToChunkId_)
        });

        this.disposingChunks_.clear();
    }

    // Clear current state without saving
    private clearCurrentState(): void {
        this.disposeAllChunks();
        this.chunkStates_.clear();
        this.executionToChunkId_.clear();
        this.cellOutputs_.clear();
        this.decorationToChunkId_.clear();
    }

    // Restore document state (called when switching to a document)
    private async restoreDocumentState(uri: string, editor: vscode.TextEditor): Promise<void> {
        const savedState = this.documentStates_.get(uri);
        
        if (!savedState) {
            this.chunkStates_.clear();
            this.executionToChunkId_.clear();
            this.cellOutputs_.clear();
            this.decorationToChunkId_.clear();
            return;
        }

        this.chunkStates_ = new Map(savedState.chunkStates);
        this.executionToChunkId_ = new Map(savedState.executionToChunkId);
        this.cellOutputs_ = new Map(savedState.cellOutputs);
        this.decorationToChunkId_ = new Map(savedState.decorationToChunkId);

        for (const [chunkId, state] of this.chunkStates_) {
            editor.setDecorations(state.decoration, [{ range: state.range }]);

            const outputLines = this.cellOutputs_.get(state.currentExecutionId);
            if (outputLines && outputLines.length > 0) {
                await this.createViewZoneForChunk(chunkId, state.currentExecutionId, state.range, outputLines);
            }
        }
    }

    // Query chunk ID at position by checking which decoration overlaps (matches Rao's getLineWidgetForRow)
    private async getChunkIdAtRange(cellRange: vscode.Range): Promise<string | null> {
        if (!this.activeEditor_) {
            return null;
        }

        for (const [decorationType, chunkId] of this.decorationToChunkId_.entries()) {
            const decorations = await this.activeEditor_.getDecorationsInRange(decorationType, cellRange);
            if (decorations.length > 0) {
                return chunkId;
            }
        }

        return null;
    }

    // Track cell execution (matches Rao's chunk execution setup)
    public async trackCellExecution(executionId: string, cellRange: vscode.Range): Promise<void> {
        if (!this.activeEditor_) {
            return;
        }

        let chunkId = await this.getChunkIdAtRange(cellRange);

        if (chunkId) {
            let state = this.chunkStates_.get(chunkId);
            if (state) {
                if (state.viewZone) {
                    this.disposingChunks_.add(chunkId);
                    state.viewZone.dispose();
                }
                state.viewZone = null;
                state.currentExecutionId = executionId;
                state.lastOutputLength = 0;
                state.range = cellRange;
            } else {
                return;
            }
        } else {
            chunkId = this.generateChunkId();
            
            const decorationType = vscode.window.createTextEditorDecorationType({
                isWholeLine: false,
            });
            this._register(decorationType);
            
            this.activeEditor_.setDecorations(decorationType, [{ range: cellRange }]);
            this.decorationToChunkId_.set(decorationType, chunkId);

            const state: ChunkState = {
                currentExecutionId: executionId,
                viewZone: null,
                decoration: decorationType,
                lastOutputLength: 0,
                range: cellRange
            };
            this.chunkStates_.set(chunkId, state);
        }

        this.executionToChunkId_.set(executionId, chunkId);
        this.cellOutputs_.set(executionId, []);
        this.disposingChunks_.delete(chunkId);
    }

    public isQuartoExecution(executionId: string): boolean {
        return this.executionToChunkId_.has(executionId);
    }

    public handleRuntimeOutput(output: any): void {
        const executionId = output.parent_id;
        const chunkId = this.executionToChunkId_.get(executionId);
        if (!chunkId || !this.chunkStates_.get(chunkId) || !this.activeEditor_) {
            return;
        }

        this.addOutputToExecution(executionId, output);
    }

    private async addOutputToExecution(executionId: string, output: any): Promise<void> {
        const outputLines = this.formatOutputData(output);
        const existingOutput = this.cellOutputs_.get(executionId) || [];
        
        existingOutput.push(...outputLines);
        this.cellOutputs_.set(executionId, existingOutput);

        await this.updateViewZoneForExecution(executionId);
    }

    private async updateViewZoneForExecution(executionId: string): Promise<void> {
        if (!this.activeEditor_) {
            return;
        }

        const chunkId = this.executionToChunkId_.get(executionId);
        const state = chunkId ? this.chunkStates_.get(chunkId) : null;
        const outputLines = this.cellOutputs_.get(executionId);

        if (!chunkId || !state || !outputLines || outputLines.length === 0) {
            return;
        }

        let cellRange: vscode.Range | null = null;
        if (state.decoration) {
            const decorations = await this.activeEditor_.getDecorationsInRange(state.decoration);
            if (decorations.length > 0) {
                cellRange = decorations[0].range;
            }
        }

        if (!cellRange) {
            return;
        }
        
        // Check if we need to update the view zone
        if (state.viewZone) {
            // Append only new output (streaming)
            const newOutputLines = outputLines.slice(state.lastOutputLength);
            if (newOutputLines.length > 0) {
                const newText = newOutputLines.join('');
                state.viewZone.appendText(newText);
                state.lastOutputLength = outputLines.length;
            }

            // Update height
            const newHeight = this.calculateViewZoneHeight(outputLines);
            state.viewZone.updateHeight(newHeight);
            return;
        }

        // Create new view zone if needed
        if (!state.viewZone) {
            await this.createViewZoneForChunk(chunkId, executionId, cellRange, outputLines);
        }
    }

    private async createViewZoneForChunk(chunkId: string, _executionId: string, cellRange: vscode.Range, outputLines: string[]): Promise<void> {
        if (!this.activeEditor_) {
            return;
        }

        const height = this.calculateViewZoneHeight(outputLines);
        const afterLineNumber = cellRange.end.line + 1;

        try {
            const controller = await vscode.window.createEditorViewZone(this.activeEditor_, {
                afterLineNumber: afterLineNumber,
                heightInPx: height
            });

            const allText = outputLines.join('');
            controller.appendText(allText);

            const state = this.chunkStates_.get(chunkId);
            if (state) {
                state.viewZone = controller;
                state.lastOutputLength = outputLines.length;
                
                controller.onDidDispose(() => {
                    if (this.isSwitchingEditors_) {
                        return;
                    }
                    
                    if (this.disposingChunks_.has(chunkId)) {
                        return;
                    }
                    
                    this.cleanupChunk(chunkId);
                });
            } else {
                controller.dispose();
            }
        } catch (error) {
            // Silently fail
        }
    }

    private calculateViewZoneHeight(outputLines: string[]): number {
        const lineHeight = 18;
        const padding = 20;
        const maxLinesBeforeDynamic = 10;

        // Check if output contains an image - give it extra height
        const hasImage = outputLines.some(line => line.startsWith('IMAGE:'));
        
        if (hasImage) {
            return 400;
        }

        return outputLines.length > maxLinesBeforeDynamic 
            ? maxLinesBeforeDynamic * lineHeight + padding
            : outputLines.length * lineHeight + padding;
    }

    private formatOutputData(output: any): string[] {
        if (!output) {
            return [];
        }

        const lines: string[] = [];

        // Check if this is an error message (has type: 'error')
        if (output.type === 'error') {
            // Format error exactly like console does: name + message, then traceback
            const errorName = output.name || '';
            const errorMessage = output.message || '';
            const traceback = output.traceback || [];
            
            // Create the detailed message with ANSI red color for the name (same as console)
            const detailedMessage = !errorName ? errorMessage : `\x1b[31m${errorName}\x1b[0m: ${errorMessage}`;
            lines.push(detailedMessage);
            
            // Add traceback as a single string (same as console)
            if (traceback.length > 0) {
                lines.push(traceback.join('\n'));
            }
            
            return lines;
        }

        // For regular outputs, check the data field
        const data = output.data;
        if (!data) {
            return [];
        }

        // For native DOM view zones, we output raw ANSI text (no HTML)
        // The view zone will render it using handleANSIOutput (same as console)
        if (data['text/plain']) {
            const textData = Array.isArray(data['text/plain']) ? data['text/plain'].join('') : data['text/plain'];
            lines.push(textData); // Raw ANSI text - will be rendered by handleANSIOutput
        } else if (data['image/png']) {
            const base64Image = Array.isArray(data['image/png']) ? data['image/png'].join('') : data['image/png'];
            lines.push(`IMAGE:data:image/png;base64,${base64Image}`);
        } else if (data['image/jpeg']) {
            const base64Image = Array.isArray(data['image/jpeg']) ? data['image/jpeg'].join('') : data['image/jpeg'];
            lines.push(`IMAGE:data:image/jpeg;base64,${base64Image}`);
        } else if (data['text/html']) {
            // HTML output - for now just show a placeholder
            lines.push('[HTML output not yet supported in native view zones]\n');
        } else if (data['application/json']) {
            const jsonData = typeof data['application/json'] === 'string' 
                ? data['application/json'] 
                : JSON.stringify(data['application/json'], null, 2);
            lines.push(jsonData + '\n');
        } else {
            const textData = Array.isArray(data) ? data.join('') : String(data);
            lines.push(textData);
        }

        return lines;
    }

    private async cleanupChunk(chunkId: string): Promise<void> {
        const state = this.chunkStates_.get(chunkId);
        if (!state) {
            return;
        }

        this.chunkStates_.delete(chunkId);

        for (const [executionId, mappedChunkId] of this.executionToChunkId_.entries()) {
            if (mappedChunkId === chunkId) {
                this.executionToChunkId_.delete(executionId);
                this.cellOutputs_.delete(executionId);
            }
        }

        if (state.decoration) {
            this.decorationToChunkId_.delete(state.decoration);
            state.decoration.dispose();
        }
    }

    private disposeAllChunks(): void {
        for (const [_chunkId, state] of this.chunkStates_) {
            if (state.viewZone) {
                state.viewZone.dispose();
            }
            if (state.decoration) {
                state.decoration.dispose();
            }
        }
        this.chunkStates_.clear();
        this.executionToChunkId_.clear();
        this.cellOutputs_.clear();
        this.decorationToChunkId_.clear();
    }

    public clearExecutionOutput(executionId: string): void {
        const chunkId = this.executionToChunkId_.get(executionId);
        if (!chunkId) {
            return;
        }

        const state = this.chunkStates_.get(chunkId);
        if (state?.viewZone) {
            state.viewZone.dispose();
            state.viewZone = null;
            this.cellOutputs_.delete(executionId);
            this.executionToChunkId_.delete(executionId);
        }
    }
}

// Export singleton instance for use across extension
export const quartoInlineOutputManager = new QuartoInlineOutputManager();
