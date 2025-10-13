/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISessionManager } from '../../../services/languageRuntime/common/sessionManager.js';
import { ILanguageRuntimeSession } from '../../../services/languageRuntime/common/languageRuntimeTypes.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { $, append } from '../../../../base/browser/dom.js';
import { OutputDisplay } from './outputDisplay.js';
import { MonacoInput } from './monacoInput.js';
import { SessionTabList } from './sessionTabList.js';
import { SplitView, Sizing, Orientation, LayoutPriority } from '../../../../base/browser/ui/splitview/splitview.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { Emitter } from '../../../../base/common/event.js';
import { IConsoleService } from '../../../services/erdosConsole/common/consoleService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { ILanguageRuntimeService } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { ConsoleStartupScreen } from './consoleStartupScreen.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { NOTEBOOK_CONSOLE_MIRRORING_KEY } from '../../notebook/browser/notebookConfig.js';
import { CodeAttributionSource } from '../../../services/languageRuntime/common/codeExecution.js';

export interface IConsoleViewProps {
	container: HTMLElement;
	sessionManager: ISessionManager;
	modelService: IModelService;
	languageService: ILanguageService;
	instantiationService: IInstantiationService;
	themeService: IThemeService;
	consoleService: IConsoleService;
	configurationService: IConfigurationService;
	workspaceContextService: IWorkspaceContextService;
	languageFeaturesService: ILanguageFeaturesService;
	languageRuntimeService: ILanguageRuntimeService;
	commandService: ICommandService;
}

export class ConsoleView extends Disposable {
	private readonly _mainContainer: HTMLElement;
	private readonly _tabListContainer: HTMLElement;
	private readonly _splitView: SplitView;
	private readonly _startupScreen: ConsoleStartupScreen;

	private readonly _sessionComponents: Map<string, {
		outputDisplay: OutputDisplay;
		monacoInput: MonacoInput;
		container: HTMLElement;
		focusTimeout?: number;
	}> = new Map();

	private _currentSession: ILanguageRuntimeSession | undefined;
	private _lastExecutionSource: CodeAttributionSource | undefined;
	constructor(props: IConsoleViewProps) {
		super();

		props.container.classList.add('repl-console');

	this._splitView = this._register(new SplitView(props.container, {
		orientation: Orientation.HORIZONTAL,
		proportionalLayout: false
	}));

	this._register(this._splitView.onDidSashChange(() => {
		if (this._currentSession) {
			const components = this._sessionComponents.get(this._currentSession.sessionId);
			if (components) {
				const width = this._mainContainer.offsetWidth || 300;
				components.monacoInput.layout(width);
			}
		}
	}));

	this._mainContainer = $('.console-grid');
	
	// Create startup screen
	this._startupScreen = this._register(new ConsoleStartupScreen({
		container: this._mainContainer,
		sessionManager: props.sessionManager,
		languageRuntimeService: props.languageRuntimeService,
		commandService: props.commandService
	}));
	
	// Show startup screen if no sessions exist
	if (props.sessionManager.activeSessions.length === 0) {
		this._startupScreen.show();
	} else {
		this._startupScreen.hide();
	}
	
	this._splitView.addView({
		element: this._mainContainer,
		minimumSize: 120,
		maximumSize: Number.POSITIVE_INFINITY,
		onDidChange: new Emitter<number | undefined>().event,
		layout: (size) => {
			this._layoutCurrentSession(size);
		},
		priority: LayoutPriority.High
	}, Sizing.Distribute, 0);

	this._tabListContainer = $('.console-panel');
	
	// Add tab list to split view, starting with 0 size if no sessions
	const initialTabListSize = props.sessionManager.activeSessions.length === 0 ? 0 : 120;
	
	this._splitView.addView({
		element: this._tabListContainer,
		minimumSize: 0,
		maximumSize: 500,
		onDidChange: new Emitter<number | undefined>().event,
		layout: () => { },
		priority: LayoutPriority.Low
	}, initialTabListSize, 1);

	this._register(new SessionTabList({
		container: this._tabListContainer,
		sessionManager: props.sessionManager
	}));

	this._register(props.sessionManager.onDidChangeForegroundSession(() => {
		this._switchToSession(props.sessionManager.foregroundSession, props);
	}));

	this._register(props.sessionManager.onDidStartSession(session => {
		this._startupScreen.hide();
		// Resize tab list to show it
		this._splitView.resizeView(1, 120);
		this._createSessionComponents(session, props);
		this._switchToSession(session, props);
		
		const components = this._sessionComponents.get(session.sessionId);
		if (components) {
			const runtimeName = session.runtimeMetadata.runtimeName;
			components.outputDisplay.write(`${runtimeName} started.\n`);
		}
	}));

	this._register(props.sessionManager.onDidEndSession((sessionId: string) => {
		this._disposeSessionComponents(sessionId);
		
		// Show startup screen and hide tab list if no sessions remain
		if (props.sessionManager.activeSessions.length === 0) {
			this._startupScreen.show();
			// Resize tab list to 0 to hide it completely
			this._splitView.resizeView(1, 0);
		}
	}));

	if (props.sessionManager.foregroundSession) {
		this._createSessionComponents(props.sessionManager.foregroundSession, props);
		this._switchToSession(props.sessionManager.foregroundSession, props);
	}

	this._register(props.consoleService.onDidRequestClear(() => {
		if (this._currentSession) {
			const components = this._sessionComponents.get(this._currentSession.sessionId);
			if (components) {
				components.outputDisplay.clear();
			}
		}
	}));

	this._register(props.consoleService.onDidExecuteCode(async (event) => {
		// Track the attribution source of the last execution
		this._lastExecutionSource = event.attribution.source;
		
		// Check if this is a notebook execution and console mirroring is disabled
		const consoleMirroringEnabled = props.configurationService.getValue<boolean>(NOTEBOOK_CONSOLE_MIRRORING_KEY) ?? true;
		if (!consoleMirroringEnabled && props.consoleService.isNotebookExecution(event.executionId)) {
			return;
		}

		// Skip displaying input for Interactive (console) executions since onWillExecute already handles it
		if (event.attribution.source === CodeAttributionSource.Interactive) {
			return;
		}

		const components = this._sessionComponents.get(event.sessionId);
		if (components) {
			const styledHtml = components.monacoInput.formatCodeAsHtml(event.code);
			components.outputDisplay.writeHtml(styledHtml);
			// Add code executed from files to history
			components.monacoInput.addToHistory(event.code);
		}
	}));
}

	private _createSessionComponents(session: ILanguageRuntimeSession, props: IConsoleViewProps): void {
		if (this._sessionComponents.has(session.sessionId)) {
			return;
		}

		const container = append(this._mainContainer, $('.console-viewport'));
		container.style.height = '100%';
		container.style.overflow = 'auto';
		container.style.paddingLeft = '10px';
		container.style.whiteSpace = 'pre-wrap';
		container.style.display = 'none';

	const innerContainer = append(container, $('.console-viewport-inner'));

	const outputContainer = append(innerContainer, $('.stream-wrapper'));

	const inputContainer = append(innerContainer, $('.editor-frame'));
	inputContainer.style.display = 'flex';
	inputContainer.style.alignItems = 'flex-start';
	inputContainer.style.paddingBottom = '10px';
	inputContainer.style.position = 'relative';

	const outputDisplay = new OutputDisplay({
		session,
		container: outputContainer,
		themeService: props.themeService,
		configurationService: props.configurationService,
		instantiationService: props.instantiationService,
		workspaceContextService: props.workspaceContextService,
		consoleService: props.consoleService
	});

		const monacoInput = new MonacoInput({
			session,
			container: inputContainer,
			modelService: props.modelService,
			languageService: props.languageService,
			instantiationService: props.instantiationService,
			themeService: props.themeService,
			configurationService: props.configurationService,
			languageFeaturesService: props.languageFeaturesService,
			onExecute: async (code: string) => {
				await props.consoleService.executeCode(code, session.runtimeMetadata.languageId, CodeAttributionSource.Interactive);
			},
			shouldFocusConsole: () => this.shouldFocusConsole(),
			outputDisplay: outputDisplay
		});

	this._register(monacoInput.onWillExecute((styledHtml: string) => {
		outputDisplay.writeHtml(styledHtml);
	}));

	const components = { outputDisplay, monacoInput, container, focusTimeout: undefined as number | undefined };

	container.addEventListener('mousedown', (e: MouseEvent) => {
		if (e.button !== 0) {
			return;
		}

		const selection = window.getSelection();
		if (selection && selection.type === 'Range') {
			let insideSelection = false;
			for (let i = 0; i < selection.rangeCount && !insideSelection; i++) {
				const range = selection.getRangeAt(i);
				const rects = Array.from(range.getClientRects());
				
				for (const rect of rects) {
					if (e.clientX >= rect.x && e.clientX <= rect.right &&
						e.clientY >= rect.y && e.clientY <= rect.bottom) {
						insideSelection = true;
						break;
					}
				}
			}

			if (insideSelection) {
				return;
			}
		}

		if (components.focusTimeout !== undefined) {
			window.clearTimeout(components.focusTimeout);
		}

		components.focusTimeout = window.setTimeout(() => {
			const currentSelection = window.getSelection();
			if (!currentSelection || currentSelection.type !== 'Range') {
				monacoInput.focus();
			}
			components.focusTimeout = undefined;
		}, 400);
	});

	this._sessionComponents.set(session.sessionId, components);
}

	private _switchToSession(session: ILanguageRuntimeSession | undefined, props: IConsoleViewProps): void {
		this._sessionComponents.forEach((components) => {
			components.container.style.display = 'none';
		});

		if (session) {
			if (!this._sessionComponents.has(session.sessionId)) {
				this._createSessionComponents(session, props);
			}

		const components = this._sessionComponents.get(session.sessionId);
		if (components) {
			components.container.style.display = 'block';
			
			setTimeout(() => {
				const contentWidth = components.container.offsetWidth || 300;
				
				components.monacoInput.layout(contentWidth);
				
				// Only focus if the last execution was explicitly from the console (Interactive source)
				if (this._lastExecutionSource === CodeAttributionSource.Interactive) {
					components.monacoInput.focus();
				}
			}, 0);
		}
		}

		this._currentSession = session;
	}

	public shouldFocusConsole(): boolean {
		return this._lastExecutionSource === CodeAttributionSource.Interactive;
	}

	private _disposeSessionComponents(sessionId: string): void {
		const components = this._sessionComponents.get(sessionId);
		if (components) {
			if (components.focusTimeout !== undefined) {
				window.clearTimeout(components.focusTimeout);
			}
			components.outputDisplay.dispose();
			components.monacoInput.dispose();
			components.container.remove();
			this._sessionComponents.delete(sessionId);
		}
	}

	private _layoutCurrentSession(size: number): void {
		if (this._currentSession) {
			const components = this._sessionComponents.get(this._currentSession.sessionId);
			if (components) {
				components.monacoInput.layout(size);
			}
		}
	}

	layout(width: number, height: number): void {
		this._splitView.layout(width);
	}
}

