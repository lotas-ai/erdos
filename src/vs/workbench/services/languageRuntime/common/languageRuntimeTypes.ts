/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../../base/common/lifecycle.js';
import { Event } from '../../../../base/common/event.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { type IDirectKernelClient } from './languageRuntimeMessageTypes.js';

export enum RuntimeState {
	Uninitialized = 'uninitialized',
	Initializing = 'initializing',
	Starting = 'starting',
	Ready = 'ready',
	Idle = 'idle',
	Busy = 'busy',
	Restarting = 'restarting',
	Exiting = 'exiting',
	Exited = 'exited',
	Offline = 'offline',
	Interrupting = 'interrupting',
}

export enum LanguageRuntimeSessionMode {
	Console = 'console',
	Notebook = 'notebook',
	Background = 'background',
}

export interface ILanguageRuntimeMetadata {
	readonly runtimePath: string;
	readonly runtimeId: string;
	readonly languageName: string;
	readonly languageId: string;
	readonly languageVersion: string;
	readonly base64EncodedIconSvg: string | undefined;
	readonly runtimeName: string;
	readonly runtimeShortName: string;
	readonly runtimeVersion: string;
	readonly runtimeSource: string;
	readonly extensionId: ExtensionIdentifier;
	readonly extraRuntimeData: any;
}

export enum RuntimeCodeExecutionMode {
	Interactive = 'interactive',
	NonInteractive = 'non-interactive',
	Transient = 'transient',
	Silent = 'silent'
}

export enum RuntimeErrorBehavior {
	Stop = 'stop',
	Continue = 'continue',
}

export interface IRuntimeDynamicState {
	inputPrompt: string;
	continuationPrompt: string;
	currentWorkingDirectory: string;
	busy: boolean;
}

export interface ILanguageRuntimeClientEvent {
	name: string;
	data: Record<string, unknown>;
}

export interface ILanguageRuntimeSession extends IDisposable {
	readonly sessionId: string;
	readonly runtimeMetadata: ILanguageRuntimeMetadata;
	readonly metadata: {
		sessionMode: LanguageRuntimeSessionMode;
	};
	readonly dynState: IRuntimeDynamicState;
	readonly onDidEndSession: Event<void>;
	readonly onDidChangeRuntimeState: Event<RuntimeState>;
	readonly onDidReceiveRuntimeMessage: Event<any>;
	readonly onDidReceiveRuntimeMessageOutput: Event<any>;
	readonly onDidReceiveRuntimeMessageResult: Event<any>;
	readonly onDidReceiveRuntimeMessageStream: Event<any>;
	readonly onDidReceiveRuntimeMessageError: Event<any>;
	readonly onDidReceiveRuntimeClientEvent: Event<ILanguageRuntimeClientEvent>;
	execute(code: string, id: string, mode?: RuntimeCodeExecutionMode, errorBehavior?: RuntimeErrorBehavior, batchId?: string, filePath?: string): void;
	setWorkingDirectory(dir: string): Promise<void>;
	interrupt(): void;
	replyToInput(parentId: string, value: string): void;
	shutdown(exitReason?: RuntimeExitReason): Promise<void>;
	isCodeFragmentComplete(code: string): Promise<RuntimeCodeFragmentStatus>;
	getRuntimeState(): RuntimeState;
	listClients(clientType?: any): Promise<IDirectKernelClient[]>;
	createClient(clientType: any, params: any, metadata?: any, extra?: any): Promise<any>;
}

export enum RuntimeCodeFragmentStatus {
	Complete = 'complete',
	Incomplete = 'incomplete',
	Invalid = 'invalid',
	Unknown = 'unknown',
}

export enum RuntimeOutputKind {
	Text = 'text',
	StaticImage = 'static_image',
	InlineHtml = 'inline_html',
	ViewerWidget = 'viewer_widget',
	PlotWidget = 'plot_widget',
	QuartoInline = 'quarto_inline',
	IPyWidget = 'ipywidget',
	WebviewPreload = 'webview_preload',
	Unknown = 'unknown',
}

export enum RuntimeClientState {
	Uninitialized = 'uninitialized',
	Opening = 'opening',
	Connected = 'connected',
	Closing = 'closing',
	Closed = 'closed',
}

export enum LanguageRuntimeMessageType {
	Stream = 'stream',
	Output = 'output',
	ClearOutput = 'clear_output',
	Result = 'result',
	Input = 'input',
	Error = 'error',
	Prompt = 'prompt',
	State = 'state',
	IPyWidget = 'ipywidget',
	CommOpen = 'comm_open',
	CommData = 'comm_data',
	CommClosed = 'comm_closed',
	UpdateOutput = 'update_output',
}

export enum UiFrontendEvent {
	PromptState = 'prompt_state',
	Busy = 'busy',
	SetEditorSelections = 'set_editor_selections',
	OpenEditor = 'open_editor',
	OpenWorkspace = 'open_workspace',
	OpenWithSystem = 'open_with_system',
	WorkingDirectory = 'working_directory',
	ShowMessage = 'show_message',
	ClearWebviewPreloads = 'clear_webview_preloads',
}

export enum ErdosOutputLocation {
	Console = 'console',
	Viewer = 'viewer',
	Plot = 'plot',
	Inline = 'inline',
}

export enum RuntimeOnlineState {
	Starting = 'starting',
	Busy = 'busy',
	Idle = 'idle',
}

export enum RuntimeExitReason {
	Shutdown = 'shutdown',
	ExtensionHost = 'extension_host',
}

export enum RuntimeStartMode {
	Starting = 'starting',
}

export enum RuntimeStartupPhase {
	Complete = 'complete',
}

