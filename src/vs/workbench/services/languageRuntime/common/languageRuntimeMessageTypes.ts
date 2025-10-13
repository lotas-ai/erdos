/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RuntimeOutputKind } from './languageRuntimeTypes.js';

/**
 * Base interface for all language runtime messages
 */
export interface ILanguageRuntimeMessage {
	id: string;
	parent_id?: string;
	when: string;
	type: string;
}

/**
 * Output message from the runtime (stdout/stderr)
 */
export interface ILanguageRuntimeMessageOutput extends ILanguageRuntimeMessage {
	type: 'output';
	kind: RuntimeOutputKind;
	data: Record<string, any>;
	metadata?: Record<string, any>;
	output_id?: string;
}

/**
 * Web/HTML output message for rendering in webviews
 */
export interface ILanguageRuntimeMessageWebOutput extends ILanguageRuntimeMessage {
	type: 'web_output';
	data: {
		html?: string;
		url?: string;
		[key: string]: unknown;
	};
	metadata?: Record<string, unknown>;
	resource_roots?: (string | Record<string, unknown>)[];
}

/**
 * Stream output (stdout/stderr text)
 */
export interface ILanguageRuntimeMessageStream extends ILanguageRuntimeMessage {
	type: 'stream';
	name: 'stdout' | 'stderr';
	text: string;
}

/**
 * Result from code execution
 */
export interface ILanguageRuntimeMessageResult extends ILanguageRuntimeMessage {
	type: 'result';
	data: Record<string, any>;
	metadata?: Record<string, any>;
}

/**
 * Error message
 */
export interface ILanguageRuntimeMessageError extends ILanguageRuntimeMessage {
	type: 'error';
	name: string;
	message: string;
	traceback: string[];
}

/**
 * State change message
 */
export interface ILanguageRuntimeMessageState extends ILanguageRuntimeMessage {
	type: 'state';
	state: string;
}

/**
 * Comm (client) opened
 */
export interface ILanguageRuntimeMessageCommOpen extends ILanguageRuntimeMessage {
	type: 'comm_open';
	comm_id: string;
	target_name: string;
	data: Record<string, any>;
}

/**
 * Comm (client) data
 */
export interface ILanguageRuntimeMessageCommData extends ILanguageRuntimeMessage {
	type: 'comm_data';
	comm_id: string;
	data: Record<string, any>;
}

/**
 * Comm (client) closed
 */
export interface ILanguageRuntimeMessageCommClosed extends ILanguageRuntimeMessage {
	type: 'comm_closed';
	comm_id: string;
}

/**
 * Plot metadata for tracking plots
 */
export interface IErdosPlotMetadata {
	id: string;
	parent_id?: string;
	session_id: string;
	code?: string;
	created: string;
	mime_type?: string;
	language?: string;
	output_id?: string;
	source_file?: string;
	source_type?: string;
	batch_id?: string;
}

/**
 * HTML file event for showing HTML plots
 */
export interface ShowHtmlFileEvent {
	file_path: string;
	path?: string;  // Alternative path property (for compatibility)
	title?: string;
	metadata?: IErdosPlotMetadata;
}

/**
 * Client/comm instance for runtime communication
 */
export interface PlotClientInstance {
	client_id: string;
	client_type: string;
	comm_id?: string;
	session_id: string;
	send(data: unknown): void;
	close(): void;
}

/**
 * Comm proxy for plot rendering
 */
export interface ErdosPlotCommProxy {
	comm_id: string;
	target_name: string;
	opened: boolean;
	onMessage(callback: (data: unknown) => void): void;
	send(data: unknown): void;
	close(): void;
}

/**
 * Render queue for managing plot rendering order
 */
export interface ErdosPlotRenderQueue {
	session_id: string;
	queue: Array<{
		plot_id: string;
		data: unknown;
		timestamp: number;
	}>;
	add(plot_id: string, data: unknown): void;
	process(): Promise<void>;
	clear(): void;
}

/**
 * Event when a client instance is created
 */
export interface ILanguageRuntimeClientEvent {
	client: {
		getClientId(): string;
		getClientType(): string;
	};
	message: ILanguageRuntimeMessageOutput;
}

/**
 * Client instance returned from DirectKernelSession.createClient()
 */
export interface IDirectKernelClient {
	client_id: string;
	client_type: string;
	send(data: unknown): void;
	close(): void;
	onDidReceiveData?(callback: (data: unknown) => void): void;
}

