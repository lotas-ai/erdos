/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IErdosPlotsService, IErdosPlotClient, IPlotHistoryGroup } from '../../common/erdosPlotsService.js';
import { ILanguageRuntimeService } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { StaticPlotInstance } from '../../common/erdosPlotsService.js';
import { ISessionManager } from '../../../../services/languageRuntime/common/sessionManager.js';
import { ILanguageRuntimeSession, ILanguageRuntimeMetadata, LanguageRuntimeSessionMode, RuntimeOutputKind, UiFrontendEvent } from '../../../../services/languageRuntime/common/languageRuntimeTypes.js';
import {
	ILanguageRuntimeMessageOutput,
	ILanguageRuntimeMessageWebOutput,
	IErdosPlotMetadata
} from '../../../../services/languageRuntime/common/languageRuntimeMessageTypes.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IErdosNotebookOutputWebviewService } from '../../../erdosOutputWebview/browser/notebookOutputWebviewService.js';
import { NOTEBOOK_PLOT_MIRRORING_KEY, QUARTO_PLOT_MIRRORING_KEY } from '../../../notebook/browser/notebookConfig.js';
import { IConsoleCodeAttribution, ILanguageRuntimeCodeExecutedEvent } from '../../../../services/languageRuntime/common/codeExecution.js';
import { IConsoleService } from '../../../../services/erdosConsole/common/consoleService.js';
import { PlotInstanceRegistry } from './plotInstanceRegistry.js';
import { HistoryGroupManager } from './historyGroupManager.js';
import { ExecutionAttributionTracker } from './executionAttributionTracker.js';
import { NotebookWidgetClient } from '../clients/notebookWidgetClient.js';
import { MultiMessageWidgetClient } from '../clients/multiMessageWidgetClient.js';

/**
 * Check if a runtime message is a webview display message (Holoviews, Bokeh, Plotly).
 * These messages should trigger immediate plot creation rather than being buffered.
 */
function isWebviewDisplayMessage(msg: ILanguageRuntimeMessageWebOutput | string[]): boolean {
	const MIME_HOLOVIEWS_EXEC = 'application/vnd.holoviews_exec.v0+json';
	const MIME_BOKEH_EXEC = 'application/vnd.bokehjs_exec.v0+json';
	const MIME_PLOTLY = 'application/vnd.plotly.v1+json';
	const MIME_HTML = 'text/html';
	const MIME_PLAIN = 'text/plain';

	const mimeTypes = new Set(Array.isArray(msg) ? msg : Object.keys(msg.data));

	// Holoviews display bundle contains HOLOVIEWS_EXEC + HTML + PLAIN
	const isHoloviews = mimeTypes.has(MIME_HOLOVIEWS_EXEC) && 
	                    mimeTypes.has(MIME_HTML) && 
	                    mimeTypes.has(MIME_PLAIN);

	return isHoloviews || 
	       mimeTypes.has(MIME_BOKEH_EXEC) || 
	       mimeTypes.has(MIME_PLOTLY);
}

/**
 * Main orchestrator coordinating plot management, runtime integration, and UI updates.
 */
export class PlotsOrchestrator extends Disposable implements IErdosPlotsService {
	readonly _serviceBrand: undefined;

	private readonly _instanceRegistry = this._register(new PlotInstanceRegistry());
	private readonly _historyManager = this._register(new HistoryGroupManager());
	private readonly _attributionTracker = this._register(new ExecutionAttributionTracker());

	private readonly _webviewMessagesBySessionId = new Map<string, ILanguageRuntimeMessageWebOutput[]>();
	private _webviewSessionDisposables = new Map<string, DisposableStore>();

	constructor(
		@ILanguageRuntimeService private readonly _languageRuntimeService: ILanguageRuntimeService,
		@ISessionManager private readonly _sessionManager: ISessionManager,
		@IStorageService private readonly _storageService: IStorageService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IErdosNotebookOutputWebviewService private readonly _webviewService: IErdosNotebookOutputWebviewService,
		@IConsoleService private readonly _consoleService: IConsoleService,
	) {
		super();
		this._attachRuntimeHooks();
		this._initializeWebviewPreloadHandling();
	}

	initialize(): void {
		// Called by external code if needed, but initialization now happens in constructor
	}

	private _initializeWebviewPreloadHandling(): void {
		this._sessionManager.activeSessions.forEach(session => {
			this._attachWebviewSession(session);
		});

		this._register(this._sessionManager.onDidStartSession((session) => {
			this._attachWebviewSession(session);
		}));
	}

	private _attachWebviewSession(session: ILanguageRuntimeSession): void {
		if (this._webviewSessionDisposables.has(session.sessionId)) {
			return;
		}

		const disposables = new DisposableStore();
		this._webviewSessionDisposables.set(session.sessionId, disposables);
		this._webviewMessagesBySessionId.set(session.sessionId, []);

		if (session.metadata.sessionMode !== LanguageRuntimeSessionMode.Console) {
			return;
		}

		const handleMessage = (msg: ILanguageRuntimeMessageOutput) => {
			if (msg.kind !== RuntimeOutputKind.WebviewPreload) {
				return;
			}
			// Convert output message to web output message for webview handling
			const webMsg: ILanguageRuntimeMessageWebOutput = {
				id: msg.id,
				parent_id: msg.parent_id,
				when: msg.when,
				type: 'web_output',
				data: msg.data,
				metadata: msg.metadata
			};
			this._handleWebviewMessage(session, webMsg);
		};

		disposables.add(session.onDidReceiveRuntimeClientEvent((e) => {
			if (e.name !== UiFrontendEvent.ClearWebviewPreloads) { return; }
			this._webviewMessagesBySessionId.set(session.sessionId, []);
		}));

		disposables.add(session.onDidReceiveRuntimeMessageResult(handleMessage));
		disposables.add(session.onDidReceiveRuntimeMessageOutput(handleMessage));
	}

	private _handleWebviewMessage(session: ILanguageRuntimeSession, msg: ILanguageRuntimeMessageWebOutput): void {
		if (isWebviewDisplayMessage(msg)) {
			this._createWebviewPlot(session, msg);
			return;
		}

		const messagesForSession = this._webviewMessagesBySessionId.get(session.sessionId);
		if (!messagesForSession) {
			console.error('[PlotsOrchestrator] Session not found:', session.sessionId);
			return;
		}
		messagesForSession.push(msg);
	}

	private async _createWebviewPlot(session: ILanguageRuntimeSession, displayMessage: ILanguageRuntimeMessageWebOutput): Promise<void> {
		const storedMessages = this._webviewMessagesBySessionId.get(session.sessionId) ?? [];
		const client = new MultiMessageWidgetClient(
			this._webviewService, session, storedMessages, displayMessage
		);
		this._enrollNewClient(client);
	}

	readonly onPlotCreated: Event<IErdosPlotClient> = this._instanceRegistry.onClientAdded;
	readonly onPlotActivated: Event<string> = this._instanceRegistry.onClientSelected;
	readonly onPlotDeleted: Event<string> = this._instanceRegistry.onClientRemoved;
	readonly onPlotsReplaced: Event<IErdosPlotClient[]> = this._instanceRegistry.onClientsReplaced;
	readonly onPlotMetadataChanged: Event<IErdosPlotClient> = this._instanceRegistry.onMetadataModified;
	readonly onHistoryChanged: Event<void> = this._historyManager.onGroupModified;

	get allPlots(): IErdosPlotClient[] {
		return this._instanceRegistry.getAllClients();
	}

	get activePlotId(): string | undefined {
		return this._instanceRegistry.getActiveClientIdentifier();
	}

	get historyGroups(): IPlotHistoryGroup[] {
		return this._historyManager.getAllGroups();
	}

	fetchPlotsInGroup(groupId: string): IErdosPlotClient[] {
		return this._historyManager.retrieveMembersOfGroup(groupId, (id) => this._instanceRegistry.lookupClient(id));
	}

	activatePlot(plotId: string): void {
		this._instanceRegistry.activateClient(plotId);
	}

	activatePreviousPlot(): void {
		this._instanceRegistry.navigateToPreviousClient();
	}

	activateNextPlot(): void {
		this._instanceRegistry.navigateToNextClient();
	}

	deletePlot(plotId: string, suppressHistoryUpdate: boolean = false): void {
		this._instanceRegistry.discardClient(plotId, suppressHistoryUpdate);
		if (!suppressHistoryUpdate) {
			this._historyManager.removeClient(plotId);
		}
	}

	deletePlots(plotIds: string[]): void {
		this._instanceRegistry.discardMultipleClients(plotIds);
		this._historyManager.removeMultipleClients(plotIds);
	}

	deleteAllPlots(): void {
		this._instanceRegistry.purgeAllClients();
		this._historyManager.purgeAllGroups();
	}

	modifyPlotMetadata(plotId: string, updates: Partial<IErdosPlotMetadata>): void {
		this._instanceRegistry.modifyClientMetadata(plotId, updates);
	}

	fetchPlotAtIndex(index: number): IErdosPlotClient | undefined {
		return this._instanceRegistry.retrieveClientByPosition(index);
	}

	private _attachRuntimeHooks(): void {
		this._register(this._languageRuntimeService.onDidRegisterRuntime((runtime: ILanguageRuntimeMetadata) => {
			// Hook for future runtime-specific initialization
		}));

		// Track console/extension code execution
		this._register(this._consoleService.onDidExecuteCode((event: ILanguageRuntimeCodeExecutedEvent) => {
			if (!event.executionId) {
				return;
			}
			this._attributionTracker.recordExecution(event.executionId, event.code, event.attribution);
		}));

		// Attach to existing sessions
		this._sessionManager.activeSessions.forEach(session => {
			this._attachSessionMonitors(session);
		});

		// Monitor new sessions for plot output
		this._register(this._sessionManager.onDidStartSession((session) => {
			this._attachSessionMonitors(session);
		}));
	}

	private _attachSessionMonitors(session: ILanguageRuntimeSession): void {
		this._register(session.onDidReceiveRuntimeMessageOutput((message: ILanguageRuntimeMessageOutput) => {
			this._processOutputMessage(message, session);
		}));

		this._register(session.onDidReceiveRuntimeMessageResult?.((message: ILanguageRuntimeMessageOutput) => {
			this._processOutputMessage(message, session);
		}) ?? { dispose: () => { } });

		// Note: onDidReceiveRuntimeMessageInput and onDidCreateClientInstance are optional
		// and may not be present on all session implementations
	}

	private _processOutputMessage(message: ILanguageRuntimeMessageOutput, session: ILanguageRuntimeSession): void {
		if (message.kind !== RuntimeOutputKind.StaticImage && message.kind !== RuntimeOutputKind.PlotWidget) {
			return;
		}

		if (this._instanceRegistry.containsClient(message.id)) {
			return;
		}

		if (message.parent_id && this._consoleService.isNotebookExecution(message.parent_id)) {
			const mirroringEnabled = this._configurationService.getValue<boolean>(NOTEBOOK_PLOT_MIRRORING_KEY) ?? true;
			if (!mirroringEnabled) {
				return;
			}
		}

		if (message.parent_id && this._consoleService.isQuartoExecution(message.parent_id)) {
			const mirroringEnabled = this._configurationService.getValue<boolean>(QUARTO_PLOT_MIRRORING_KEY) ?? true;
			if (!mirroringEnabled) {
				return;
			}
		}

		const client = this._constructClientFromMessage(message, session);
		if (client) {
			this._enrollNewClient(client);
		}
	}

	private _constructClientFromMessage(message: ILanguageRuntimeMessageOutput, session: ILanguageRuntimeSession): IErdosPlotClient | undefined {
		const sourceCode = message.parent_id ? this._attributionTracker.extractCode(message.parent_id) : '';
		const attributionData = message.parent_id ? this._attributionTracker.extractAttribution(message.parent_id) : undefined;

		if (message.kind === RuntimeOutputKind.StaticImage) {
			return this._buildStaticClient(message, session.sessionId, sourceCode, attributionData, session);
		} else if (message.kind === RuntimeOutputKind.PlotWidget) {
			return new NotebookWidgetClient(this._webviewService, session, message, sourceCode, attributionData);
		}

		return undefined;
	}

	private _buildStaticClient(message: ILanguageRuntimeMessageOutput, sessionId: string, sourceCode?: string, attributionData?: IConsoleCodeAttribution, session?: ILanguageRuntimeSession): StaticPlotInstance | undefined {
		try {
			let imageContent: string | null = null;
			let contentType = 'image/png';

			if (message.data) {
				const supportedTypes = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/gif'];
				for (const mimeType of supportedTypes) {
					if (message.data[mimeType] && typeof message.data[mimeType] === 'string') {
						imageContent = message.data[mimeType] as string;
						contentType = mimeType;
						break;
					}
				}

				if (!imageContent && typeof message.data === 'string') {
					imageContent = message.data as string;
				}
			}

			if (!imageContent) {
				console.warn('PlotsOrchestrator: No image content in message');
				return undefined;
			}

			if (!imageContent.startsWith('data:')) {
				imageContent = `data:${contentType};base64,${imageContent}`;
			}

			let sourceFile: string | undefined;
			let sourceType: string | undefined;
			let batchId: string | undefined;

			if (attributionData) {
				sourceType = attributionData.source;
				batchId = attributionData.batchId;
				if (attributionData.metadata?.filePath) {
					sourceFile = attributionData.metadata.filePath;
				} else if (attributionData.metadata?.notebook) {
					sourceFile = attributionData.metadata.notebook;
				}
			}

			const languageId = session?.runtimeMetadata.languageId;

			return StaticPlotInstance.createFromRuntimeMessage(
				this._storageService,
				sessionId,
				message,
				sourceFile,
				sourceType,
				batchId,
				languageId
			);
		} catch (error) {
			console.error('PlotsOrchestrator: Failed to build static client:', error);
			return undefined;
		}
	}


	private _enrollNewClient(client: IErdosPlotClient): void {
		this._instanceRegistry.registerClient(client);
		this._historyManager.incorporateClient(client);
	}

}
