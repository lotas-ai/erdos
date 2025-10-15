/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { reads, writes } from './jupytext/jupytext.js';
import { NotebookNode } from './jupytext/types.js';
import { IJupytextService, JupytextOptions } from '../common/jupytextService.js';
import { SCRIPT_EXTENSIONS, sameLanguage } from './jupytext/languages.js';
import { URI } from '../../../../base/common/uri.js';
import { INotebookService } from '../../../contrib/notebook/common/notebookService.js';

export class JupytextService extends Disposable implements IJupytextService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@INotebookService private readonly notebookService: INotebookService
	) {
		super();
	}

	convertNotebookToText(notebookContent: string, options: JupytextOptions): string {
		try {
			// Parse and convert
			const notebook: NotebookNode = JSON.parse(notebookContent);
			
			const result = writes(notebook, options);
			return result;
		} catch (error) {
			console.error('[JUPYTEXT_TO_TEXT] Conversion failed:', error);
			throw new Error(`Failed to convert notebook to text: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	convertTextToNotebook(textContent: string, options: JupytextOptions): string {
		try {
			// Convert text to notebook and return as JSON string
			const readsResult = reads(textContent, options);
			
			// Handle both return types from reads()
			const notebook: NotebookNode = 'notebook' in readsResult ? readsResult.notebook : readsResult;
			
		const result = JSON.stringify(notebook, null, 2);
			return result;
		} catch (error) {
			console.error('[JUPYTEXT_TO_NOTEBOOK] Conversion failed:', error);
			throw new Error(`Failed to convert text to notebook: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	getNotebookJupytextOptions(notebookContent: string, fileUri?: URI): JupytextOptions {
		try {
			// First, try to get metadata from in-memory model if available
			let metadata: any = {};
			let metadataSource = 'serialized-content';
			
			if (fileUri) {
				const notebookModel = this.notebookService.getNotebookTextModel(fileUri);
				if (notebookModel) {
					metadata = notebookModel.metadata || {};
					metadataSource = 'in-memory-model';
				}
			}
			
			// Fallback to parsing serialized content if no in-memory model
			if (metadataSource === 'serialized-content') {
				const notebook: NotebookNode = JSON.parse(notebookContent);
				metadata = notebook.metadata || {};
			}
			
			
			// Use jupytext's exact logic from autoExtFromMetadata (formats.ts lines 831-860)
			let autoExt = metadata.language_info?.file_extension;

			// Sage notebooks have ".py" as the associated extension in "language_info",
			// so we change it to ".sage" in that case
			if (autoExt === ".py" && metadata.kernelspec?.language === "sage") {
				autoExt = ".sage";
			}

			if (!autoExt) {
				let language = metadata.kernelspec?.language || metadata.jupytext?.main_language;
				
				// If no language from metadata and we have in-memory model, try to get from cell language
				if (!language && metadataSource === 'in-memory-model' && fileUri) {
					const notebookModel = this.notebookService.getNotebookTextModel(fileUri);
					if (notebookModel?.cells && notebookModel.cells.length > 0) {
						const cellLanguage = notebookModel.cells[0].language;
						language = cellLanguage;
					}
				}
				
				if (language) {
					for (const ext in SCRIPT_EXTENSIONS) {
						if (sameLanguage(language, SCRIPT_EXTENSIONS[ext].language)) {
							autoExt = ext;
							break;
						}
					}
				}
			}

			// Apply jupytext's extension normalization rules
			if (autoExt === ".r") { autoExt = ".R"; }
			if (autoExt === ".fs") { autoExt = ".fsx"; }
			if (autoExt === ".resource") { autoExt = ".robot"; }
			if (autoExt === ".C") { autoExt = ".cpp"; }

			// Default to .py if no extension could be determined
			const extension = autoExt || '.py';
			
			return { extension, format_name: 'percent' };
		} catch (error) {
			console.error('[JUPYTEXT_OPTIONS] Failed to parse notebook, defaulting to Python:', error);
			// If parsing fails, default to Python
			return { extension: '.py', format_name: 'percent' };
		}
	}
}
