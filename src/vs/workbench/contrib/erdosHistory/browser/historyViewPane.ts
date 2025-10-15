/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IViewPaneOptions } from '../../../browser/parts/views/viewPane.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { ICommandHistoryService } from '../../../services/erdosHistory/common/historyService.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { $, append, addDisposableListener, clearNode } from '../../../../base/browser/dom.js';
import { SplitView, Sizing, Orientation, LayoutPriority } from '../../../../base/browser/ui/splitview/splitview.js';
import { Emitter } from '../../../../base/common/event.js';
import { ISessionManager } from '../../../services/languageRuntime/common/sessionManager.js';
import { IConsoleService } from '../../../services/erdosConsole/common/consoleService.js';
import { CodeAttributionSource } from '../../../services/languageRuntime/common/codeExecution.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';

const ERDOS_CONSOLE_VIEW_ID = 'workbench.panel.erdosConsole';

export class HistoryViewPane extends ViewPane {
	private _historyView?: HistoryView;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@ICommandHistoryService private readonly _historyService: ICommandHistoryService,
		@ISessionManager private readonly _sessionManager: ISessionManager,
		@IConsoleService private readonly _consoleService: IConsoleService,
		@IViewsService private readonly _viewsService: IViewsService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		
		container.classList.add('erdos-history-view');

		this._historyView = this._register(new HistoryView({
			container,
			historyService: this._historyService,
			sessionManager: this._sessionManager,
			consoleService: this._consoleService,
			configurationService: this.configurationService,
			viewsService: this._viewsService
		}));
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this._historyView?.layout(width, height);
	}
}

interface IHistoryViewProps {
	container: HTMLElement;
	historyService: ICommandHistoryService;
	sessionManager: ISessionManager;
	consoleService: IConsoleService;
	configurationService: IConfigurationService;
	viewsService: IViewsService;
}

class HistoryView extends Disposable {
	private readonly _mainContainer: HTMLElement;
	private readonly _tabListContainer: HTMLElement;
	private readonly _splitView: SplitView;
	private readonly _historyService: ICommandHistoryService;
	private readonly _sessionManager: ISessionManager;
	private readonly _consoleService: IConsoleService;
	private readonly _configurationService: IConfigurationService;
	private readonly _viewsService: IViewsService;
	
	private readonly _sessionContainers: Map<string, HTMLElement> = new Map();
	private readonly _sessionTabs: Map<string, HTMLElement> = new Map();
	private _currentSessionId: string | undefined;

	constructor(props: IHistoryViewProps) {
		super();
		
		props.container.classList.add('repl-console');
		
		this._historyService = props.historyService;
		this._sessionManager = props.sessionManager;
		this._consoleService = props.consoleService;
		this._configurationService = props.configurationService;
		this._viewsService = props.viewsService;
		
		this._splitView = this._register(new SplitView(props.container, {
			orientation: Orientation.HORIZONTAL,
			proportionalLayout: false
		}));
		
		this._mainContainer = $('.history-grid');
		
		this._splitView.addView({
			element: this._mainContainer,
			minimumSize: 120,
			maximumSize: Number.POSITIVE_INFINITY,
			onDidChange: new Emitter<number | undefined>().event,
			layout: () => {},
			priority: LayoutPriority.High
		}, Sizing.Distribute, 0);
		
		this._tabListContainer = $('.console-panel');
		const initialTabListSize = this._sessionManager.activeSessions.length === 0 ? 0 : 120;
		
		this._splitView.addView({
			element: this._tabListContainer,
			minimumSize: 0,
			maximumSize: 500,
			onDidChange: new Emitter<number | undefined>().event,
			layout: () => {},
			priority: LayoutPriority.Low
		}, initialTabListSize, 1);
		
		this._createSessionTabs();
		
		this._register(this._sessionManager.onDidStartSession(() => {
			this._createSessionTabs();
			this._splitView.resizeView(1, 120);
		}));
		
		this._register(this._sessionManager.onDidEndSession(() => {
			this._createSessionTabs();
			if (this._sessionManager.activeSessions.length === 0) {
				this._splitView.resizeView(1, 0);
			}
		}));
		
		this._register(this._sessionManager.onDidChangeForegroundSession(() => {
			this._switchToSession(this._sessionManager.foregroundSession?.sessionId);
		}));
		
		this._register(this._historyService.onDidAddEntry(() => {
			this._renderHistory();
		}));
		
		this._register(this._historyService.onDidClearHistory(() => {
			this._renderHistory();
		}));
		
		this._register(this._historyService.onDidRemoveEntry(() => {
			this._renderHistory();
		}));
		
		this._renderHistory();
		
		if (this._sessionManager.foregroundSession) {
			this._switchToSession(this._sessionManager.foregroundSession.sessionId);
		}
	}
	
	private _createSessionTabs(): void {
		clearNode(this._tabListContainer);
		this._sessionTabs.clear();
		
		const tabList = append(this._tabListContainer, $('.sidebar-list'));
		tabList.setAttribute('role', 'tablist');
		tabList.setAttribute('aria-orientation', 'vertical');
		
		this._sessionManager.activeSessions.forEach(session => {
			const tab = append(tabList, $('.item-cell'));
			tab.setAttribute('role', 'tab');
			tab.setAttribute('tabindex', '0');
			tab.setAttribute('aria-label', session.runtimeMetadata.runtimeName);
			
			const sessionName = append(tab, $('p.label-text'));
			sessionName.textContent = session.runtimeMetadata.runtimeName;
			
			this._register(addDisposableListener(tab, 'click', () => {
				this._sessionManager.foregroundSession = session;
				this._switchToSession(session.sessionId);
			}));
			
			this._sessionTabs.set(session.sessionId, tab);
		});
		
		this._updateActiveTab();
	}
	
	private _updateActiveTab(): void {
		const activeSessionId = this._sessionManager.foregroundSession?.sessionId;
		
		this._sessionTabs.forEach((tab, sessionId) => {
			if (sessionId === activeSessionId) {
				tab.classList.add('item-cell--selected');
				tab.setAttribute('aria-selected', 'true');
			} else {
				tab.classList.remove('item-cell--selected');
				tab.setAttribute('aria-selected', 'false');
			}
		});
	}
	
	private _switchToSession(sessionId: string | undefined): void {
		this._sessionContainers.forEach(container => {
			container.style.display = 'none';
		});
		
		if (sessionId) {
			const container = this._sessionContainers.get(sessionId);
			if (container) {
				container.style.display = 'block';
			}
			this._currentSessionId = sessionId;
		}
		
		this._updateActiveTab();
	}
	
	private _renderHistory(): void {
		// Clear all session containers
		this._sessionContainers.forEach(container => container.remove());
		this._sessionContainers.clear();
		
		const allHistory = this._historyService.getHistory();
		
		// Group history by session
		const historyBySession = new Map<string, typeof allHistory>();
		this._sessionManager.activeSessions.forEach(session => {
			historyBySession.set(session.sessionId, []);
		});
		
		allHistory.forEach(entry => {
			const sessionHistory = historyBySession.get(entry.sessionId);
			if (sessionHistory) {
				sessionHistory.push(entry);
			}
		});
		
		// Create containers for each session
		this._sessionManager.activeSessions.forEach(session => {
			const container = append(this._mainContainer, $('.history-session-container'));
			container.style.height = '100%';
			container.style.overflow = 'auto';
			container.style.paddingLeft = '10px';
			container.style.paddingRight = '10px';
			container.style.whiteSpace = 'pre-wrap';
			container.style.display = 'none';
			container.style.fontFamily = 'var(--monaco-monospace-font)';
			
			// Apply console font configuration (2px smaller than console)
			const fontSize = this._configurationService.getValue<number>('console.fontSize') || 13;
			container.style.fontSize = `${fontSize - 2}px`;
			
			const sessionHistory = historyBySession.get(session.sessionId) || [];
			
			if (sessionHistory.length === 0) {
				const emptyMessage = append(container, $('.history-empty'));
				emptyMessage.textContent = `No command history for ${session.runtimeMetadata.runtimeName} yet.`;
				emptyMessage.style.padding = '20px';
				emptyMessage.style.opacity = '0.6';
			} else {
				// Render in reverse order (newest first)
				sessionHistory.reverse().forEach(entry => {
					this._renderHistoryEntry(container, entry);
				});
			}
			
			this._sessionContainers.set(session.sessionId, container);
		});
		
		// Switch to current session if available
		if (this._currentSessionId) {
			this._switchToSession(this._currentSessionId);
		}
	}
	
	private _renderHistoryEntry(container: HTMLElement, entry: any): void {
		const entryContainer = append(container, $('.history-entry'));
		entryContainer.style.position = 'relative';
		entryContainer.style.marginBottom = '8px';
		entryContainer.style.paddingTop = '4px';
		entryContainer.style.paddingBottom = '4px';
		entryContainer.style.paddingRight = '80px';
		
		// Code element - selectable and copyable
		const codeElement = append(entryContainer, $('.history-code'));
		codeElement.textContent = entry.code;
		codeElement.style.userSelect = 'text';
		codeElement.style.cursor = 'text';
		codeElement.style.display = 'block';
		codeElement.style.wordWrap = 'break-word';
		
		// Actions container (top right)
		const actionsContainer = append(entryContainer, $('.history-actions'));
		actionsContainer.style.position = 'absolute';
		actionsContainer.style.top = '4px';
		actionsContainer.style.right = '8px';
		actionsContainer.style.display = 'flex';
		actionsContainer.style.gap = '8px';
		actionsContainer.style.opacity = '0.7';
		
		// Time display
		const timeDisplay = append(actionsContainer, $('.history-time'));
		const date = new Date(entry.timestamp);
		timeDisplay.textContent = date.toLocaleTimeString();
		timeDisplay.style.fontSize = '11px';
		timeDisplay.style.opacity = '0.6';
		timeDisplay.style.marginRight = '8px';
		
		// Play button
		const playButton = append(actionsContainer, $('button.history-action-button'));
		playButton.title = 'Run again';
		append(playButton, $('span.codicon.codicon-play'));
		playButton.style.background = 'none';
		playButton.style.border = 'none';
		playButton.style.cursor = 'pointer';
		playButton.style.padding = '2px';
		playButton.style.display = 'flex';
		playButton.style.alignItems = 'center';
		
		this._register(addDisposableListener(playButton, 'click', async () => {
			const session = this._sessionManager.activeSessions.find(s => s.sessionId === entry.sessionId);
			if (session) {
				// Switch to console view and set the session as foreground
				await this._viewsService.openView(ERDOS_CONSOLE_VIEW_ID, true);
				this._sessionManager.foregroundSession = session;
				
				// Execute the code
				await this._consoleService.executeCode(entry.code, session.runtimeMetadata.languageId, CodeAttributionSource.Interactive);
			}
		}));
		
		// Delete button
		const deleteButton = append(actionsContainer, $('button.history-action-button'));
		deleteButton.title = 'Delete from history';
		append(deleteButton, $('span.codicon.codicon-trash'));
		deleteButton.style.background = 'none';
		deleteButton.style.border = 'none';
		deleteButton.style.cursor = 'pointer';
		deleteButton.style.padding = '2px';
		deleteButton.style.display = 'flex';
		deleteButton.style.alignItems = 'center';
		
		this._register(addDisposableListener(deleteButton, 'click', () => {
			// Remove from history service using timestamp as unique identifier
			this._historyService.removeEntry(entry.timestamp);
			
			// Also remove from MonacoInput history for this session
			const consoleView = this._viewsService.getViewWithId(ERDOS_CONSOLE_VIEW_ID);
			if (consoleView) {
				const consoleViewPane = consoleView as any;
				const monacoInput = consoleViewPane.getConsoleView?.()?.getMonacoInputForSession(entry.sessionId);
				if (monacoInput) {
					monacoInput.removeFromHistory(entry.code);
				}
			}
		}));
		
		// Hover effects
		this._register(addDisposableListener(entryContainer, 'mouseenter', () => {
			actionsContainer.style.opacity = '1';
		}));
		
		this._register(addDisposableListener(entryContainer, 'mouseleave', () => {
			actionsContainer.style.opacity = '0.7';
		}));
	}

	layout(width: number, height: number): void {
		this._splitView.layout(width);
	}
}
