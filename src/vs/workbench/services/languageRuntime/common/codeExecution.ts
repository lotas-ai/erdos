/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RuntimeCodeExecutionMode, RuntimeErrorBehavior } from './languageRuntimeTypes.js';

/**
 * Enum of code attribution sources for code execution.
 */
export enum CodeAttributionSource {
	Extension = 'extension',
	Interactive = 'interactive',
	Notebook = 'notebook',
	Paste = 'paste',
	Script = 'script',
}

/**
 * Code attribution interface.
 * Tracks where code execution originated from.
 */
export interface IConsoleCodeAttribution {
	source: CodeAttributionSource;
	batchId?: string;
	metadata?: Record<string, any>;
}

/**
 * Event fired when code is executed in a runtime session.
 * Used to track code execution across all sources (console, notebook, extension, etc.)
 */
export interface ILanguageRuntimeCodeExecutedEvent {
	executionId: string;
	sessionId: string;
	attribution: IConsoleCodeAttribution;
	code: string;
	languageId: string;
	runtimeName: string;
	errorBehavior: RuntimeErrorBehavior;
	mode: RuntimeCodeExecutionMode;
}




