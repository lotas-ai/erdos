/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { reads, writes } from './jupytext/jupytext.js';
import { NotebookNode } from './jupytext/types.js';
import { IJupytextService, JupytextOptions } from '../common/jupytextService.js';
import { SCRIPT_EXTENSIONS, sameLanguage } from './jupytext/languages.js';

export class JupytextService extends Disposable implements IJupytextService {
	declare readonly _serviceBrand: undefined;

	constructor() {
		super();
	}

	convertNotebookToText(notebookContent: string, options: JupytextOptions): string {
		try {
			// Parse and convert
			const notebook: NotebookNode = JSON.parse(notebookContent);
			return writes(notebook, options);
		} catch (error) {
			throw new Error(`Failed to convert notebook to text: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	convertTextToNotebook(textContent: string, options: JupytextOptions): string {
		try {
			// Convert text to notebook and return as JSON string
			const notebook = reads(textContent, options);
			return JSON.stringify(notebook, null, 2);
		} catch (error) {
			throw new Error(`Failed to convert text to notebook: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	getNotebookJupytextOptions(notebookContent: string): JupytextOptions {
		try {
			const notebook: NotebookNode = JSON.parse(notebookContent);
			const metadata = notebook.metadata || {};
			
			// Use jupytext's exact logic from autoExtFromMetadata (formats.ts lines 831-860)
			let autoExt = metadata.language_info?.file_extension;

			// Sage notebooks have ".py" as the associated extension in "language_info",
			// so we change it to ".sage" in that case
			if (autoExt === ".py" && metadata.kernelspec?.language === "sage") {
				autoExt = ".sage";
			}

			if (!autoExt) {
				const language = metadata.kernelspec?.language || metadata.jupytext?.main_language;
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
			// If parsing fails, default to Python
			return { extension: '.py', format_name: 'percent' };
		}
	}
}
