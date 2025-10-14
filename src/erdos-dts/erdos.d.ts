/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'erdos' {
	import * as vscode from 'vscode';

	export enum RuntimeState {
		Uninitialized = 'uninitialized',
		Initializing = 'initializing',
		Starting = 'starting',
		Idle = 'idle',
		Busy = 'busy',
		Ready = 'ready',
		Offline = 'offline',
		Exited = 'exited'
	}

	export enum RuntimeOnlineState {
		Starting = 'starting',
		Idle = 'idle',
		Busy = 'busy'
	}

	export enum RuntimeExitReason {
		Unknown = 'unknown',
		Shutdown = 'shutdown',
		Error = 'error',
		ForcedQuit = 'forced_quit',
		StartupFailed = 'startup_failed',
		ExtensionHost = 'extension_host'
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

	export enum RuntimeCodeFragmentStatus {
		Complete = 'complete',
		Incomplete = 'incomplete',
		Invalid = 'invalid',
		Unknown = 'unknown'
	}

	export enum RuntimeClientType {
		Variables = 'variables',
		Plot = 'plot',
		IPyWidget = 'ipywidget',
		Environment = 'environment',
		Help = 'help',
		Connection = 'connection',
		Lsp = 'lsp'
	}

	export enum LanguageRuntimeMessageType {
		Output = 'output',
		Result = 'result',
		Stream = 'stream',
		Input = 'input',
		Error = 'error',
		Prompt = 'prompt',
		State = 'state',
		CommOpen = 'comm_open',
		CommData = 'comm_data',
		CommClosed = 'comm_closed',
		IPyWidget = 'ipywidget',
		WebOutput = 'web_output'
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
		Unknown = 'unknown'
	}

	export enum LanguageRuntimeSessionChannel {
		Kernel = 'kernel',
		LSP = 'lsp',
		Other = 'other'
	}

	export enum LanguageRuntimeSessionMode {
		Console = 0,
		Notebook = 1,
		Background = 2
	}

	export enum ErdosOutputLocation {
		Notebook = 'notebook',
		Console = 'console',
		Viewer = 'viewer',
		Plot = 'plot'
	}

	export enum LanguageRuntimeStartupBehavior {
		Immediate = 'immediate',
		Implicit = 'implicit',
		Explicit = 'explicit'
	}

	export enum LanguageRuntimeSessionLocation {
		Browser = 'browser',
		Workspace = 'workspace',
		Machine = 'machine'
	}

	export type RuntimeMethodError = { code: number; message: string; name: string; data?: any }

	export interface LanguageRuntimeExit {
		runtime_name: string;
		session_name?: string;
		exit_code: number;
		reason: RuntimeExitReason;
		message: string;
	}

	export interface LanguageRuntimeClientEvent {
		name: string;
		data: Record<string, unknown>;
	}

	export interface LanguageRuntimeMessage {
		id: string;
		parent_id: string;
		when: string;
		[key: string]: any;
	}

	export interface LanguageRuntimeInfo {
		runtime_id: string;
		runtime_name: string;
		runtime_version: string;
		runtime_path: string;
		language_id: string;
		language_name: string;
		language_version: string;
		base_env_path?: string;
		[key: string]: any;
	}

	export interface LanguageRuntimeMetadata {
		runtimeId: string;
		runtimeName: string;
		runtimeShortName?: string;
		runtimeVersion: string;
		runtimePath: string;
		runtimeSource?: string;
		languageId: string;
		languageName: string;
		languageVersion: string;
		sessionLocation?: LanguageRuntimeSessionLocation;
		startupBehavior?: LanguageRuntimeStartupBehavior;
		base64EncodedIconSvg?: string;
		uiSubscriptions?: string[];
		extraRuntimeData?: Record<string, any>;
	}

	export interface RuntimeSessionMetadata {
		sessionId: string;
		sessionName: string;
		sessionMode: number;
		notebookUri?: vscode.Uri;
		workingDirectory?: string;
	}

	export interface LanguageRuntimeDynState {
		inputPrompt: string;
		continuationPrompt: string;
		currentWorkingDirectory: string;
		busy: boolean;
	}

	export interface RuntimeClientInstance {
		client_id: string;
		client_type: string;
		send(data: unknown): void;
		close(): void;
		onDidReceiveData?(callback: (data: unknown) => void): void;
	}

	export interface LanguageRuntimeSession {
		metadata: RuntimeSessionMetadata;
		sessionId: string;
		sessionName: string;
		sessionMode: number;
		notebookUri?: vscode.Uri;
		runtimeMetadata: LanguageRuntimeMetadata;
		dynState: LanguageRuntimeDynState;

		onDidReceiveRuntimeMessage: vscode.Event<LanguageRuntimeMessage>;
		onDidChangeRuntimeState: vscode.Event<RuntimeState>;
		onDidEndSession: vscode.Event<LanguageRuntimeExit>;
		onDidReceiveRuntimeClientEvent: vscode.Event<LanguageRuntimeClientEvent>;

		execute(code: string, id: string, mode?: RuntimeCodeExecutionMode, errorBehavior?: RuntimeErrorBehavior): void;
		isCodeFragmentComplete(code: string): Thenable<RuntimeCodeFragmentStatus>;
		createClient(type: RuntimeClientType, params: any, metadata?: any): Thenable<any>;
		listClients(type?: RuntimeClientType): Thenable<RuntimeClientInstance[]>;
		start(): Promise<LanguageRuntimeInfo>;
		shutdown(exitReason: RuntimeExitReason): Promise<void>;
		restart(workingDirectory?: string): Promise<void>;
		interrupt(): Promise<void>;
		replyToInput(parentId: string, value: string): void;
		callMethod(method: string, ...args: any[]): Thenable<any>;
		setWorkingDirectory(dir: string): Promise<void>;
		getRuntimeState(): RuntimeState;
		dispose(): void;
	}

	export interface LanguageRuntimeOutput extends LanguageRuntimeMessage {
		type: LanguageRuntimeMessageType.Output;
		data: Record<string, any>;
		kind: RuntimeOutputKind;
	}

	export interface LanguageRuntimeWebOutput extends LanguageRuntimeOutput {
		resource_roots?: (string | Record<string, unknown>)[];
		output_location?: ErdosOutputLocation;
	}

	export interface LanguageRuntimeError extends LanguageRuntimeMessage {
		type: LanguageRuntimeMessageType.Error;
		name: string;
		message: string;
		traceback: string[];
	}

	export interface LanguageRuntimeInput extends LanguageRuntimeMessage {
		type: LanguageRuntimeMessageType.Input;
		prompt: string;
		password: boolean;
	}

	export interface LanguageRuntimeCommOpen extends LanguageRuntimeMessage {
		type: LanguageRuntimeMessageType.CommOpen;
		comm_id: string;
		target_name: string;
		data: any;
	}

	export interface LanguageRuntimeCommMessage extends LanguageRuntimeMessage {
		type: LanguageRuntimeMessageType.CommData;
		comm_id: string;
		data: any;
	}

	export interface LanguageRuntimeCommClosed extends LanguageRuntimeMessage {
		type: LanguageRuntimeMessageType.CommClosed;
		comm_id: string;
		data: any;
	}

	export interface LanguageRuntimeState extends LanguageRuntimeMessage {
		type: LanguageRuntimeMessageType.State;
		state: string;
	}

	export interface LanguageRuntimeMessageIPyWidget extends LanguageRuntimeMessage {
		type: LanguageRuntimeMessageType.IPyWidget;
		comm_id: string;
		original_message: LanguageRuntimeMessage;
	}

	export interface StatementRange {
		readonly range: vscode.Range;
		readonly code?: string;
	}

	export interface StatementRangeProvider {
		provideStatementRange(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<StatementRange>;
	}

	export interface HelpTopicProvider {
		provideHelpTopic(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<string>;
	}

	export interface ViewerOptions extends vscode.WebviewPanelOptions, vscode.WebviewOptions {
	}

	export interface ViewerPanelOnDidChangeViewStateEvent {
		readonly viewerPanel: ViewerPanel;
	}

	export interface ViewerPanel {
		readonly viewType: string;
		title: string;
		readonly webview: vscode.Webview;
		readonly active: boolean;
		readonly visible: boolean;
		readonly onDidChangeViewState: vscode.Event<ViewerPanelOnDidChangeViewStateEvent>;
		readonly onDidDispose: vscode.Event<void>;
		reveal(preserveFocus?: boolean): void;
		dispose(): any;
	}

	export interface PreviewOptions extends vscode.WebviewPanelOptions, vscode.WebviewOptions {
	}

	export interface PreviewPanelOnDidChangeViewStateEvent {
		readonly previewPanel: PreviewPanel;
	}

	export interface PreviewPanel {
		readonly viewType: string;
		title: string;
		readonly webview: vscode.Webview;
		readonly active: boolean;
		readonly visible: boolean;
		readonly onDidChangeViewState: vscode.Event<PreviewPanelOnDidChangeViewStateEvent>;
		readonly onDidDispose: vscode.Event<void>;
		reveal(preserveFocus?: boolean): void;
		dispose(): any;
	}

	export interface ExecutionObserver {
		token?: vscode.CancellationToken;
		onStarted?: () => void;
		onOutput?: (message: string) => void;
		onError?: (message: string) => void;
		onPlot?: (plotData: string) => void;
		onData?: (data: any) => void;
		onCompleted?: (result: Record<string, any>) => void;
		onFailed?: (error: Error) => void;
		onFinished?: () => void;
	}

	export namespace languages {
		export function registerStatementRangeProvider(selector: vscode.DocumentSelector, provider: StatementRangeProvider): vscode.Disposable;
		export function registerHelpTopicProvider(selector: vscode.DocumentSelector, provider: HelpTopicProvider): vscode.Disposable;
	}

	export namespace window {
		// Primary Viewer API (preferred)
		export function createViewerPanel(viewType: string, title: string, preserveFocus?: boolean, options?: ViewerOptions): ViewerPanel;
		export function viewUrl(url: vscode.Uri): ViewerPanel;
		export function viewHtml(path: string): void;
		
		// Backward compatibility aliases (for Quarto extension)
		export function createPreviewPanel(viewType: string, title: string, preserveFocus?: boolean, options?: PreviewOptions): PreviewPanel;
		export function previewUrl(url: vscode.Uri): PreviewPanel;
		export function previewHtml(path: string): void;
		export function onDidChangeConsoleWidth(listener: (width: number) => void): vscode.Disposable;
		export function getConsoleWidth(): number;
	}

	export interface LanguageRuntimeManager {
		onDidDiscoverRuntime: vscode.Event<LanguageRuntimeMetadata>;
		discoverAllRuntimes(): AsyncGenerator<LanguageRuntimeMetadata>;
		registerLanguageRuntime(runtime: LanguageRuntimeMetadata): void;
		recommendedWorkspaceRuntime(): Promise<LanguageRuntimeMetadata | undefined>;
		createSession(runtimeMetadata: LanguageRuntimeMetadata, sessionMetadata: RuntimeSessionMetadata): Thenable<LanguageRuntimeSession>;
		validateMetadata(metadata: LanguageRuntimeMetadata): Promise<LanguageRuntimeMetadata>;
		validateSession(sessionId: string): Promise<boolean>;
		restoreSession(runtimeMetadata: LanguageRuntimeMetadata, sessionMetadata: RuntimeSessionMetadata, sessionName: string): Thenable<LanguageRuntimeSession>;
	}

	export namespace runtime {
		export function executeCode(languageId: string, code: string, focus: boolean, allowIncomplete?: boolean, mode?: RuntimeCodeExecutionMode, errorBehavior?: RuntimeErrorBehavior, observer?: ExecutionObserver, executionId?: string, batchId?: string, filePath?: string): Thenable<Record<string, any>>;
		export function getNotebookSession(notebookUri: vscode.Uri): Thenable<LanguageRuntimeSession | undefined>;
		export function getPreferredRuntime(languageId: string): Thenable<LanguageRuntimeMetadata | undefined>;
		export function selectLanguageRuntime(languageId: string): Thenable<LanguageRuntimeMetadata | undefined>;
		export function startSession(runtimeId: string, sessionName: string, sessionMode: LanguageRuntimeSessionMode, notebookUri?: vscode.Uri): Thenable<string>;
		export function restartSession(sessionId: string): Thenable<void>;
		export function getForegroundSession(): Thenable<LanguageRuntimeSession | undefined>;
		export function getActiveSessions(): Thenable<LanguageRuntimeSession[]>;
		export function onDidChangeForegroundSession(listener: (sessionId: string) => void): vscode.Disposable;
		export function registerLanguageRuntimeManager(languageId: string, manager: LanguageRuntimeManager): vscode.Disposable;
	}
}

