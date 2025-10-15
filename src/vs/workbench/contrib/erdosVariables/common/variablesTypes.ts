/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const ERDOS_VARIABLES_VIEW_ID = 'workbench.view.erdosVariables';

export const IErdosVariablesService = createDecorator<IErdosVariablesService>('erdosVariablesService');

/**
 * Variable as received from the backend (Python/R kernel)
 */
export interface IVariable {
	access_key: string;
	display_name: string;
	display_value: string;
	display_type: string;
	type_info: string;
	size: number;
	kind: VariableKind;
	length: number;
	has_children: boolean;
	has_viewer: boolean;
	is_truncated: boolean;
	updated_time: number;
}

/**
 * Variable kinds matching the backend protocol
 */
export enum VariableKind {
	Boolean = 'boolean',
	Bytes = 'bytes',
	Class = 'class',
	Collection = 'collection',
	Empty = 'empty',
	Function = 'function',
	Map = 'map',
	Number = 'number',
	Other = 'other',
	String = 'string',
	Table = 'table',
	Lazy = 'lazy',
	Connection = 'connection'
}

/**
 * Service interface for managing variables across multiple runtime sessions
 */
export interface IErdosVariablesService {
	readonly _serviceBrand: undefined;

	/**
	 * Event fired when variables change in any session
	 */
	readonly onDidChangeVariables: Event<string>; // sessionId

	/**
	 * Event fired when a session is registered
	 */
	readonly onDidRegisterSession: Event<string>; // sessionId

	/**
	 * Event fired when a session is unregistered
	 */
	readonly onDidUnregisterSession: Event<string>; // sessionId

	/**
	 * Get all registered session IDs
	 */
	getSessions(): string[];

	/**
	 * Get variables for a specific session
	 */
	getVariables(sessionId: string): IVariable[];

	/**
	 * Inspect a variable's children
	 */
	inspectVariable(sessionId: string, path: string[]): Promise<IVariable[]>;

	/**
	 * Open a viewer for a variable
	 */
	viewVariable(sessionId: string, path: string[]): Promise<void>;

	/**
	 * Clear all variables in a session
	 */
	clearVariables(sessionId: string, includeHidden: boolean): Promise<void>;

	/**
	 * Delete specific variables
	 */
	deleteVariables(sessionId: string, names: string[]): Promise<void>;

	/**
	 * Get session display name
	 */
	getSessionDisplayName(sessionId: string): string;

	/**
	 * Get session language ID
	 */
	getSessionLanguageId(sessionId: string): string | undefined;
}



