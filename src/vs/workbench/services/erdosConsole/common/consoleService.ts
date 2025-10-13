/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILanguageRuntimeSession } from '../../languageRuntime/common/languageRuntimeTypes.js';
import { Event } from '../../../../base/common/event.js';
import { ILanguageRuntimeCodeExecutedEvent, CodeAttributionSource } from '../../languageRuntime/common/codeExecution.js';

export const ERDOS_CONSOLE_VIEW_ID = 'workbench.panel.erdosConsole';

export const IConsoleService = createDecorator<IConsoleService>('consoleService');

export interface IConsoleService {
	readonly _serviceBrand: undefined;

	readonly activeSession: ILanguageRuntimeSession | undefined;
	readonly onDidChangeActiveSession: Event<ILanguageRuntimeSession | undefined>;
	readonly onDidRequestClear: Event<void>;
	readonly onDidRequestPaste: Event<string>;
	readonly onDidExecuteCode: Event<ILanguageRuntimeCodeExecutedEvent>;

	executeCode(code: string, languageId: string, attributionSource: CodeAttributionSource, executionId?: string, batchId?: string, extensionId?: string, filePath?: string): Promise<void>;
	requestClearConsole(): void;
	requestPasteText(text: string): void;
	
	markExecutionAsNotebookOriginated(executionId: string): void;
	isNotebookExecution(executionId: string): boolean;
	
	recordCodeExecution(event: ILanguageRuntimeCodeExecutedEvent): void;
}

