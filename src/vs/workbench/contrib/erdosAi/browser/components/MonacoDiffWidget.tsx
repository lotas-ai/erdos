/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React from 'react';
import { CodeEditorWidget } from '../../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IMonacoWidgetServices } from '../widgets/widgetTypes.js';
import { NotebookCellRenderer } from './NotebookCellRenderer.js';
import { ReactMonacoEditor } from './ReactMonacoEditor.js';
import { ICommonUtils } from '../../../../services/erdosAiUtils/common/commonUtils.js';
import { IJupytextService } from '../../../../services/erdosAiIntegration/common/jupytextService.js';

/**
 * Diff data interface matching the existing structure
 */
interface DiffItem {
	type: 'added' | 'deleted' | 'unchanged';
	content: string;
	old_line?: number;
	new_line?: number;
}

interface EnhancedDiffItem extends DiffItem {
	cellIndex: number;
	lineInCell: number;
	cellType: string;
}


export interface MonacoDiffWidgetProps {
	content: string;
	diffData?: {
		diff_data: DiffItem[];
		added?: number;
		deleted?: number;
		clean_filename?: string;
	};
	filename?: string;
	monacoServices: IMonacoWidgetServices;
	configurationService: IConfigurationService;
	commonUtils?: ICommonUtils;
	jupytextService?: IJupytextService;
	onContentChange?: (content: string) => void;
	onEditorReady?: (editor: CodeEditorWidget) => void;
	height?: string;
	className?: string;
}

/**
 * Monaco editor wrapper component for search_replace widgets with diff highlighting
 * Uses Monaco editor with decorations to show diff data, matching original DiffHighlighter behavior
 */
export const MonacoDiffWidget: React.FC<MonacoDiffWidgetProps> = ({
	content,
	diffData,
	filename,
	monacoServices,
	configurationService,
	commonUtils,
	jupytextService,
	onContentChange,
	onEditorReady,
	height = '300px',
	className = 'monaco-diff-widget'
}) => {
	// Check if this is a Jupyter notebook file with enhanced diff data (contains cellIndex)
	const isNotebookFile = filename && commonUtils?.getFileExtension(filename).toLowerCase() === 'ipynb';
	const hasNotebookDiffData = diffData && diffData.diff_data && 
		Array.isArray(diffData.diff_data) && 
		diffData.diff_data.some((item: DiffItem) => 'cellIndex' in item);

	// Detect if this should render as notebook cells (like MonacoWidgetEditor pattern)
	let isNotebookCells = false;
	let cellsWithDiffData = null;
	
	// Process notebook data if conditions are met
	if (isNotebookFile && hasNotebookDiffData && diffData?.diff_data && jupytextService && commonUtils) {
		try {
			// Group diff lines by cellIndex from conversation diff data
			const cellDiffMap = new Map<number, Array<{type: string, content: string, old_line?: number, new_line?: number, lineInCell: number, cellType: string}>>();
			
			for (const item of diffData.diff_data) {
				// Enhanced diff items have cellIndex, lineInCell, cellType
				if ('cellIndex' in item) {
					const enhancedItem = item as EnhancedDiffItem;
					if (!cellDiffMap.has(enhancedItem.cellIndex)) {
						cellDiffMap.set(enhancedItem.cellIndex, []);
					}
					cellDiffMap.get(enhancedItem.cellIndex)!.push({
						type: item.type,
						content: item.content,
						old_line: item.old_line,
						new_line: item.new_line,
						lineInCell: enhancedItem.lineInCell,
						cellType: enhancedItem.cellType
					});
				}
			}

			// Create cells directly from diff data - only cells that have diffs
			cellsWithDiffData = Array.from(cellDiffMap.entries()).map(([originalCellIndex, diffLines]) => {
				// Get cell type from diff data (all items in a cell should have same cellType)
				const cellType = (diffLines[0] as any).cellType || 'code';
				
				// Filter jupytext structural markers using the same regex patterns jupytext uses
				const doublePercentRe = /^#\s*%%(\s|$)/;  // Matches "# %%" or "# %% [markdown]"
				const separatorRe = /^#\s*---\s*$/;  // Matches "# ---"
				
				const cleanedDiffLines = diffLines
					.filter(line => {
						const content = line.content;
						return !doublePercentRe.test(content) && !separatorRe.test(content);
					})
					.map((line, index) => {
						let cleanedContent = line.content;
						
						// For markdown cells, remove leading "# " prefix that jupytext adds
						if (cellType === 'markdown' && cleanedContent.startsWith('# ')) {
							cleanedContent = cleanedContent.substring(2);
						}
						
						return {
							type: line.type as 'added' | 'deleted' | 'unchanged',
							content: cleanedContent,
							lineNumber: index + 1
						};
					});
				
				// Reconstruct clean source
				const cleanSource = cleanedDiffLines.map(line => line.content).join('\n');
				
				return {
					cell_type: cellType,
					source: cleanSource,
					metadata: {},
					diffLines: cleanedDiffLines
				};
			});
			
			isNotebookCells = cellsWithDiffData.length > 0;
		} catch (error) {
			console.error('Notebook processing failed:', error);
		}
	}

	// Clean conditional rendering: NotebookCellRenderer for notebook cells, ReactMonacoEditor for everything else
	if (isNotebookCells && cellsWithDiffData && commonUtils) {
		return (
			<div className={className}>
				<NotebookCellRenderer 
					cells={cellsWithDiffData} 
					monacoServices={monacoServices} 
					configurationService={configurationService}
					commonUtils={commonUtils}
					isReadOnly={true}
					functionType="search_replace"
					filename={filename}
					diffData={diffData}
				/>
			</div>
		);
	}

	// Use ReactMonacoEditor for all non-notebook content
	return (
		<ReactMonacoEditor
			content={content}
			diffData={diffData}
			filename={filename}
			monacoServices={monacoServices}
			configurationService={configurationService}
			commonUtils={commonUtils}
			onContentChange={onContentChange}
			onEditorReady={onEditorReady}
			height={height}
			className={className}
		/>
	);
};
