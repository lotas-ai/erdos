/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Lotas Inc. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ThrottledDelayer } from '../../../../../../base/common/async.js';
import { VSBuffer } from '../../../../../../base/common/buffer.js';
import { Event, Emitter } from '../../../../../../base/common/event.js';
import { Disposable, DisposableStore, IReference } from '../../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../../base/common/uri.js';
import { generateUuid } from '../../../../../../base/common/uuid.js';
import { Range } from '../../../../../../editor/common/core/range.js';
import { ITextModel } from '../../../../../../editor/common/model.js';
import { DiffState } from '../../../../../../editor/browser/widget/diffEditor/diffEditorViewModel.js';
import { toLineChanges } from '../../../../../../editor/browser/widget/diffEditor/diffEditorWidget.js';
import { IEditorWorkerService } from '../../../../../../editor/common/services/editorWorker.js';
import { IModelService } from '../../../../../../editor/common/services/model.js';
import { IResolvedTextEditorModel, ITextModelService } from '../../../../../../editor/common/services/resolverService.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { INotebookEditor, INotebookEditorContribution, INotebookDeltaDecoration, ICellViewModel, NotebookOverviewRulerLane } from '../../notebookBrowser.js';
import { registerNotebookContribution } from '../../notebookEditorExtensions.js';
import { INotebookService, SimpleNotebookProviderInfo } from '../../../common/notebookService.js';
import { ChangeType, IQuickDiffService, QuickDiff, QuickDiffChange, getChangeType, getModifiedEndLineNumber, overviewRulerAddedForeground, overviewRulerDeletedForeground, overviewRulerModifiedForeground } from '../../../../scm/common/quickDiff.js';
import { IFileChangeTracker } from '../../../../../services/erdosAi/common/fileChangeTracker.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';

interface ILineCellMapping {
	cellHandle: number;
	cellLine: number;
}

interface INotebookQuickDiffSnapshot {
	readonly quickDiff: QuickDiff | undefined;
	readonly changes: readonly QuickDiffChange[];
	readonly lineMapping: ReadonlyArray<ILineCellMapping | undefined>;
}

const enum NotebookQuickDiffConstants {
	MaxComputationTime = 1000
}

type OverviewSummaryEntry = {
	added: number[];
	deleted: number[];
};

class NotebookQuickDiffModel extends Disposable {
	private readonly onDidChangeEmitter = this._register(new Emitter<INotebookQuickDiffSnapshot>());
	readonly onDidChange: Event<INotebookQuickDiffSnapshot> = this.onDidChangeEmitter.event;

	private readonly delayer = new ThrottledDelayer<void>(200);
	private readonly modelStore = this._register(new DisposableStore());

	private snapshot: INotebookQuickDiffSnapshot = { quickDiff: undefined, changes: [], lineMapping: [] };
	private computeGeneration = 0;

	constructor(
		private readonly notebookEditor: INotebookEditor,
		@IQuickDiffService private readonly quickDiffService: IQuickDiffService,
		@IEditorWorkerService private readonly editorWorkerService: IEditorWorkerService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ITextModelService private readonly textModelService: ITextModelService,
		@IModelService private readonly modelService: IModelService,
		@INotebookService private readonly notebookService: INotebookService,
		@IFileService private readonly fileService: IFileService
	) {
		super();

		this._register(this.quickDiffService.onDidChangeQuickDiffProviders(() => this.schedule()));
		this._register(this.notebookEditor.onDidChangeModel(() => {
			this.modelStore.clear();
			this.attachModel();
		}));
		this._register(this.notebookEditor.onDidChangeViewCells(() => this.schedule()));
		this._register(this.notebookEditor.onDidAttachViewModel(() => this.schedule()));
		this._register(this.notebookEditor.onDidChangeVisibleRanges(() => this.schedule()));
		this.attachModel();
	}

	getSnapshot(): INotebookQuickDiffSnapshot {
		return this.snapshot;
	}

	private attachModel(): void {
		if (!this.notebookEditor.hasModel()) {
			this.updateSnapshot({ quickDiff: undefined, changes: [], lineMapping: [] });
			return;
		}

		const textModel = this.notebookEditor.textModel;
		if (!textModel) {
			this.updateSnapshot({ quickDiff: undefined, changes: [], lineMapping: [] });
			return;
		}

		this.modelStore.clear();
		this.modelStore.add(textModel.onDidChangeContent(() => this.schedule()));
		this.schedule();
	}

	private schedule(): void {
		this.delayer.trigger(() => this.compute());
	}

	private async compute(): Promise<void> {
		const generation = ++this.computeGeneration;

		if (!this.notebookEditor.hasModel()) {
			this.updateSnapshot({ quickDiff: undefined, changes: [], lineMapping: [] });
			return;
		}

		const viewModel = this.notebookEditor.getViewModel();
		const textModel = this.notebookEditor.textModel;
		if (!viewModel || !textModel) {
			this.updateSnapshot({ quickDiff: undefined, changes: [], lineMapping: [] });
			return;
		}

		const modifiedSnapshot = this.captureModifiedLines(viewModel.viewCells);
		let quickDiff: QuickDiff | undefined = undefined;
		let changes: QuickDiffChange[] = [];

		try {
			const quickDiffs = await this.quickDiffService.getQuickDiffs(textModel.uri, undefined, undefined);
			const visibleQuickDiffs = quickDiffs.filter(diff => this.quickDiffService.isQuickDiffProviderVisible(diff.id));
			quickDiff = visibleQuickDiffs.find(diff => diff.kind === 'primary') ?? visibleQuickDiffs[0];

			if (quickDiff) {
				const originalLines = await this.captureOriginalLines(quickDiff, textModel.viewType);
				if (originalLines) {
					const ignoreTrimWhitespace = this.resolveIgnoreWhitespace();
					changes = await this.computeQuickDiffChanges(quickDiff, textModel.uri, originalLines, modifiedSnapshot.lines, ignoreTrimWhitespace);
				} else {
				}
			} else {
			}
		} catch (err) {
			changes = [];
		}

		if ((!quickDiff || changes.length === 0) && modifiedSnapshot.lines.length) {
			try {
				const fallbackLines = await this.captureOriginalLinesFromDisk(textModel.uri, textModel.viewType);
				if (fallbackLines) {
					const ignoreTrimWhitespace = this.resolveIgnoreWhitespace();
					quickDiff = quickDiff ?? {
						id: 'notebook.savedBaseline',
						label: 'Saved Version',
						kind: 'primary',
						originalResource: textModel.uri
					};
					changes = await this.computeQuickDiffChanges(quickDiff, textModel.uri, fallbackLines, modifiedSnapshot.lines, ignoreTrimWhitespace);
				} else {
				}
			} catch (err) {
			}
		}

		if (generation !== this.computeGeneration) {
			return;
		}

		this.updateSnapshot({ quickDiff, changes, lineMapping: modifiedSnapshot.mapping });
	}

	private captureModifiedLines(cells: readonly ICellViewModel[]): { lines: string[]; mapping: Array<ILineCellMapping | undefined> } {
		const mapping: Array<ILineCellMapping | undefined> = [undefined];
		const lines: string[] = [];

		for (const cell of cells) {
			const lineCount = cell.textBuffer.getLineCount();
			for (let line = 1; line <= lineCount; line++) {
				const content = cell.textBuffer.getLineContent(line);
				lines.push(content);
				mapping.push({ cellHandle: cell.handle, cellLine: line });
			}
		}

		return { lines, mapping };
	}

	private async captureOriginalLines(diff: QuickDiff, viewType: string): Promise<string[] | undefined> {
		let reference: IReference<IResolvedTextEditorModel> | undefined;
		try {
			const providerInfo = await this.notebookService.withNotebookDataProvider(viewType);
			if (!(providerInfo instanceof SimpleNotebookProviderInfo)) {
				return undefined;
			}

			reference = await this.textModelService.createModelReference(diff.originalResource);
			const originalContent = reference.object.textEditorModel.getValue();
			const bytes = VSBuffer.fromString(originalContent);
			const notebookData = await providerInfo.serializer.dataToNotebook(bytes);

			const lines: string[] = [];
			for (const cell of notebookData.cells) {
				const source = cell.source as string | string[];
				if (Array.isArray(source)) {
					for (const chunk of source) {
						if (chunk.length === 0) {
							lines.push('');
							continue;
						}
						lines.push(...chunk.split(/\r\n|\r|\n/));
					}
				} else {
					lines.push(...source.split(/\r\n|\r|\n/));
				}
			}

			return lines;
		} catch (err) {
			return undefined;
		} finally {
			reference?.dispose();
		}
	}

	private async captureOriginalLinesFromDisk(uri: URI, viewType: string): Promise<string[] | undefined> {
		try {
			const providerInfo = await this.notebookService.withNotebookDataProvider(viewType);
			if (!(providerInfo instanceof SimpleNotebookProviderInfo)) {
				return undefined;
			}

			const contents = await this.fileService.readFile(uri);
			const notebookData = await providerInfo.serializer.dataToNotebook(contents.value);

			const lines: string[] = [];
			for (const cell of notebookData.cells) {
				const source = cell.source as string | string[];
				if (Array.isArray(source)) {
					for (const chunk of source) {
						if (chunk.length === 0) {
							lines.push('');
							continue;
						}
						lines.push(...chunk.split(/\r\n|\r|\n/));
					}
				} else {
					lines.push(...source.split(/\r\n|\r|\n/));
				}
			}

			return lines;
		} catch (err) {
			return undefined;
		}
	}

	private resolveIgnoreWhitespace(): boolean {
		const setting = this.configurationService.getValue<'true' | 'false' | 'inherit'>('scm.diffDecorationsIgnoreTrimWhitespace');
		if (setting === 'inherit') {
			return this.configurationService.getValue<boolean>('diffEditor.ignoreTrimWhitespace');
		}

		return setting !== 'false';
	}

	private async computeQuickDiffChanges(
		diff: QuickDiff,
		target: URI,
		originalLines: string[],
		modifiedLines: string[],
		ignoreTrimWhitespace: boolean
	): Promise<QuickDiffChange[]> {
		const originalModel = this.createTextModel(originalLines.join('\n'), 'original');
		const modifiedModel = this.createTextModel(modifiedLines.join('\n'), 'modified');

		try {
			const result = await this.editorWorkerService.computeDiff(
				originalModel.uri,
				modifiedModel.uri,
				{ computeMoves: false, ignoreTrimWhitespace, maxComputationTimeMs: NotebookQuickDiffConstants.MaxComputationTime },
				'advanced'
			);

			if (!result) {
				return [];
			}

			const changes = toLineChanges(DiffState.fromDiffResult(result));
			const mappings = result.changes ?? [];
			const quickDiffChanges: QuickDiffChange[] = [];

			for (let index = 0; index < Math.min(changes.length, mappings.length); index++) {
				quickDiffChanges.push({
					providerId: diff.id,
					original: diff.originalResource,
					modified: target,
					change: changes[index],
					change2: mappings[index]
				});
			}

			return quickDiffChanges;
		} catch (err) {
			return [];
		} finally {
			originalModel.dispose();
			modifiedModel.dispose();
		}
	}

	private createTextModel(contents: string, kind: 'original' | 'modified'): ITextModel {
		const uri = URI.from({
			scheme: 'notebook-quick-diff',
			path: `${kind}/${generateUuid()}`
		});

		return this.modelService.createModel(contents, null, uri, true);
	}

	private updateSnapshot(snapshot: INotebookQuickDiffSnapshot): void {
		this.snapshot = snapshot;
		this.onDidChangeEmitter.fire(snapshot);
	}
}

class NotebookDiffOverviewDecoration extends Disposable implements INotebookEditorContribution {
	static readonly ID = 'notebook.contrib.quickDiffOverview';

	private readonly quickDiffModel: NotebookQuickDiffModel;
	private decorationIds: string[] = [];

	constructor(
		private readonly notebookEditor: INotebookEditor,
		@IQuickDiffService quickDiffService: IQuickDiffService,
		@IEditorWorkerService editorWorkerService: IEditorWorkerService,
		@IConfigurationService configurationService: IConfigurationService,
		@ITextModelService textModelService: ITextModelService,
		@IModelService modelService: IModelService,
		@INotebookService notebookService: INotebookService,
		@IFileService fileService: IFileService,
		@IFileChangeTracker private readonly fileChangeTracker: IFileChangeTracker
	) {
		super();

		this.quickDiffModel = this._register(new NotebookQuickDiffModel(
			notebookEditor,
			quickDiffService,
			editorWorkerService,
			configurationService,
			textModelService,
			modelService,
			notebookService,
			fileService
		));

		this._register(this.quickDiffModel.onDidChange(snapshot => this.render(snapshot)));
	}

	private render(snapshot: INotebookQuickDiffSnapshot): void {
		if (!this.notebookEditor.hasModel()) {
			this.clearDecorations();
			return;
		}

		const uri = this.notebookEditor.textModel?.uri;
		if (uri) {
			const summary = this.fileChangeTracker.getNotebookOverviewSummary(uri);
			if (summary) {
				const summaryDecorations = this.createDecorationsFromSummary(summary);
				if (summaryDecorations.length) {
					this.decorationIds = this.notebookEditor.deltaCellDecorations(this.decorationIds, summaryDecorations);
					return;
				}
			}
		}

		if (snapshot.changes.length === 0) {
			this.clearDecorations();
			return;
		}

		const decorations = this.createDecorations(snapshot);
		this.decorationIds = this.notebookEditor.deltaCellDecorations(this.decorationIds, decorations);
	}

	private clearDecorations(): void {
		if (this.decorationIds.length === 0) {
			return;
		}

		this.decorationIds = this.notebookEditor.deltaCellDecorations(this.decorationIds, []);
	}

	private createDecorationsFromSummary(summary: Map<number, OverviewSummaryEntry>): INotebookDeltaDecoration[] {
		if (!this.notebookEditor.hasModel()) {
			return [];
		}

		const decorations: INotebookDeltaDecoration[] = [];

		for (const [cellIndex, entry] of summary) {
			const cell = this.notebookEditor.cellAt(cellIndex);
			if (!cell) {
				continue;
			}

			const handle = cell.handle;
			const addedRanges = this.createRanges(entry.added);
			const deletedRanges = this.createRanges(entry.deleted);

			if (addedRanges.length) {
				decorations.push(this.createDecoration(handle, overviewRulerAddedForeground, addedRanges));
			}

			if (deletedRanges.length) {
				decorations.push(this.createDecoration(handle, overviewRulerDeletedForeground, deletedRanges));
			}

			if (!addedRanges.length && !deletedRanges.length && entry.added.length && entry.deleted.length) {
				// In case ranges collapse due to deduping, treat as modification
				const modificationRanges = this.createRanges([...new Set([...entry.added, ...entry.deleted])]);
				if (modificationRanges.length) {
					decorations.push(this.createDecoration(handle, overviewRulerModifiedForeground, modificationRanges));
				}
			}
		}

		return decorations;
	}

	private createDecorations(snapshot: INotebookQuickDiffSnapshot): INotebookDeltaDecoration[] {
		const perCell = new Map<number, { handle: number; add: number[]; modify: number[]; del: number[] }>();

		const ensureBucket = (handle: number) => {
			let bucket = perCell.get(handle);
			if (!bucket) {
				bucket = { handle, add: [], modify: [], del: [] };
				perCell.set(handle, bucket);
			}
			return bucket;
		};

		for (const change of snapshot.changes) {
			const type = getChangeType(change.change);

			if (type === ChangeType.Delete) {
				let anchor = change.change.modifiedStartLineNumber;
				if (anchor <= 0) {
					anchor = 1;
				}

				const mapping = snapshot.lineMapping[anchor] ?? snapshot.lineMapping[Math.max(anchor - 1, 1)];
				if (!mapping) {
					continue;
				}

				const bucket = ensureBucket(mapping.cellHandle);
				if (!bucket.del.includes(mapping.cellLine)) {
					bucket.del.push(mapping.cellLine);
				}
				continue;
			}

			const start = Math.max(1, change.change.modifiedStartLineNumber);
			const end = Math.max(start, getModifiedEndLineNumber(change.change));

			for (let line = start; line <= end; line++) {
				const mapping = snapshot.lineMapping[line];
				if (!mapping) {
					continue;
				}

				const bucket = ensureBucket(mapping.cellHandle);
				const target = type === ChangeType.Add ? bucket.add : bucket.modify;
				target.push(mapping.cellLine);
			}
		}

		const decorations: INotebookDeltaDecoration[] = [];

		for (const bucket of perCell.values()) {
			const cell = this.notebookEditor.getCellByHandle(bucket.handle);
			if (!cell) {
				continue;
			}

			const additions = this.createRanges(bucket.add);
			const modifications = this.createRanges(bucket.modify);
			const deletions = this.createRanges(bucket.del);

			if (additions.length) {
				decorations.push(this.createDecoration(bucket.handle, overviewRulerAddedForeground, additions));
			}

			if (modifications.length) {
				decorations.push(this.createDecoration(bucket.handle, overviewRulerModifiedForeground, modifications));
			}

			if (deletions.length) {
				decorations.push(this.createDecoration(bucket.handle, overviewRulerDeletedForeground, deletions));
			}
		}

		return decorations;
	}

	private createRanges(lines: number[]): Range[] {
		if (!lines.length) {
			return [];
		}

		const sorted = Array.from(new Set(lines)).sort((a, b) => a - b);
		const ranges: Range[] = [];

		let start = sorted[0];
		let previous = start;

		for (let index = 1; index < sorted.length; index++) {
			const current = sorted[index];
			if (current === previous || current === previous + 1) {
				previous = current;
				continue;
			}

			ranges.push(new Range(start, 1, previous, 1));
			start = current;
			previous = current;
		}

		ranges.push(new Range(start, 1, previous, 1));
		return ranges;
	}

	private createDecoration(handle: number, color: string, ranges: Range[]): INotebookDeltaDecoration {
		return {
			handle,
			options: {
				overviewRuler: {
					color,
					modelRanges: ranges,
					includeOutput: false,
					position: NotebookOverviewRulerLane.Full
				}
			}
		};
	}

	override dispose(): void {
		this.clearDecorations();
		super.dispose();
	}
}

registerNotebookContribution(NotebookDiffOverviewDecoration.ID, NotebookDiffOverviewDecoration);
