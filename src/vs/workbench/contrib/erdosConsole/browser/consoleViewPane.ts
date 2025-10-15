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
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IViewPaneOptions } from '../../../browser/parts/views/viewPane.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { ConsoleView } from './consoleView.js';
import { ISessionManager } from '../../../services/languageRuntime/common/sessionManager.js';
import { ILanguageRuntimeSession, LanguageRuntimeSessionMode } from '../../../services/languageRuntime/common/languageRuntimeTypes.js';
import { ILanguageRuntimeService } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { ErdosConsoleInstancesExistContext } from '../../../common/contextkeys.js';
import { IActionViewItem } from '../../../../base/browser/ui/actionbar/actionbar.js';
import { BaseActionViewItem } from '../../../../base/browser/ui/actionbar/actionViewItems.js';
import { IAction, Action } from '../../../../base/common/actions.js';
import { IDropdownMenuActionViewItemOptions } from '../../../../base/browser/ui/dropdown/dropdownActionViewItem.js';
import { DropdownWithPrimaryActionViewItem } from '../../../../platform/actions/browser/dropdownWithPrimaryActionViewItem.js';
import { MenuItemAction } from '../../../../platform/actions/common/actions.js';
import { MutableDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';

// Action IDs
const LANGUAGE_RUNTIME_DUPLICATE_ACTIVE_SESSION_ID = 'erdos.languageRuntime.duplicateSession';
import { IAccessibilityService } from '../../../../platform/accessibility/common/accessibility.js';
import { IConsoleService } from '../../../services/erdosConsole/common/consoleService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ICommandHistoryService } from '../../../services/erdosHistory/common/historyService.js';

export class ConsoleViewPane extends ViewPane {
	private readonly _erdosConsoleInstancesExistContextKey: IContextKey<boolean>;
	private _consoleView?: ConsoleView;
	private readonly _sessionDropdown: MutableDisposable<DropdownWithPrimaryActionViewItem> = this._register(new MutableDisposable());

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@ISessionManager private readonly _sessionManager: ISessionManager,
		@IModelService private readonly _modelService: IModelService,
		@ILanguageService private readonly _languageService: ILanguageService,
		@ILanguageFeaturesService private readonly _languageFeaturesService: ILanguageFeaturesService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IAccessibilityService private readonly _accessibilityService: IAccessibilityService,
		@IConsoleService private readonly _consoleService: IConsoleService,
		@ILanguageRuntimeService private readonly _languageRuntimeService: ILanguageRuntimeService,
		@ICommandService private readonly _commandService: ICommandService,
		@ICommandHistoryService private readonly _historyService: ICommandHistoryService
	) {
		super(options, keybindingService, contextMenuService, _configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
		
		this._erdosConsoleInstancesExistContextKey = ErdosConsoleInstancesExistContext.bindTo(contextKeyService);
		this._updateConsoleInstancesExistContext();
		
		this._register(_sessionManager.onDidStartSession(() => {
			this._updateConsoleInstancesExistContext();
			this.updateActions();
		}));
		this._register(_sessionManager.onDidEndSession(() => {
			this._updateConsoleInstancesExistContext();
			this.updateActions();
		}));
		this._register(_sessionManager.onDidChangeForegroundSession(() => {
			this.updateActions();
		}));
	}
	
	private _updateConsoleInstancesExistContext(): void {
		const hasInstances = this._sessionManager.activeSessions.length > 0;
		this._erdosConsoleInstancesExistContextKey.set(hasInstances);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		
		container.classList.add('repl-console-view');

		this._consoleView = this._register(new ConsoleView({
			container,
			sessionManager: this._sessionManager,
			modelService: this._modelService,
			languageService: this._languageService,
			instantiationService: this.instantiationService,
			themeService: this.themeService,
			consoleService: this._consoleService,
			configurationService: this._configurationService,
			workspaceContextService: this._workspaceContextService,
			languageFeaturesService: this._languageFeaturesService,
			languageRuntimeService: this._languageRuntimeService,
			commandService: this._commandService,
			historyService: this._historyService
		}));
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this._consoleView?.layout(width, height);
	}

	public getConsoleView(): ConsoleView | undefined {
		return this._consoleView;
	}

	override createActionViewItem(action: IAction, options?: IDropdownMenuActionViewItemOptions): IActionViewItem | undefined {
		if (action.id === 'workbench.action.erdosConsole.showWorkingDirectory') {
			return new WorkingDirectoryActionViewItem(action, this._sessionManager, this._consoleService, this._commandService);
		}

		if (action.id === LANGUAGE_RUNTIME_DUPLICATE_ACTIVE_SESSION_ID && this._sessionManager.activeSessions.length > 0) {
			if (action instanceof MenuItemAction) {
				const dropdownAction = new Action('console.session.quickLaunch', localize('console.session.quickLaunch', 'Quick Launch Session...'), 'codicon-chevron-down', true);
				this._register(dropdownAction);

				this._sessionDropdown.value = new DropdownWithPrimaryActionViewItem(
					action,
					dropdownAction,
					[],
					'',
					{},
					this.contextMenuService, this.keybindingService, this._notificationService, this.contextKeyService, this.themeService, this._accessibilityService);
				this.updateSessionDropdown(dropdownAction);

				return this._sessionDropdown.value;
			}
		}

		return super.createActionViewItem(action, options);
	}

	private updateSessionDropdown(dropdownAction: Action): void {
		const currentRuntime = this._sessionManager.foregroundSession?.runtimeMetadata;

		// Get active runtimes (from currently running sessions)
		let activeRuntimes = this._sessionManager.activeSessions
			.map(session => session.runtimeMetadata)
			.filter((runtime, index, runtimes) =>
				runtime.runtimeId !== currentRuntime?.runtimeId && runtimes.findIndex(r => r.runtimeId === runtime.runtimeId) === index
			);

		if (currentRuntime) {
			activeRuntimes.unshift(currentRuntime);
		}

		activeRuntimes = activeRuntimes.slice(0, 5);

		// Create actions for active runtimes
		const dropdownMenuActions = activeRuntimes.map(runtime => new Action(
			`console.startSession.${runtime.runtimeId}`,
			runtime.runtimeName,
			undefined,
			true,
			() => {
				const sessionName = `${runtime.languageName} ${new Date().toLocaleTimeString()}`;
				this._sessionManager.startSession(
					runtime,
					LanguageRuntimeSessionMode.Console,
					sessionName
				);
			})
		);

		if (dropdownMenuActions.length === 0) {
			dropdownMenuActions.push(
				new Action(
					'console.startSession.none',
					localize('console.startSession.none', 'No Sessions'),
					undefined,
					false
				)
			);
		}

		// Add "Start Another..." option that opens the full runtime picker with browse/install options
		dropdownMenuActions.push(new Action(
			'console.startSession.other',
			localize('console.startSession.other', 'Start Another...'),
			undefined,
			true,
			async () => {
				// Use the command service to execute the full start new session action
				await this._commandService.executeCommand('erdos.languageRuntime.startNewSession');
			})
		);

		dropdownMenuActions.forEach(action => this._register(action));

		this._sessionDropdown.value?.update(dropdownAction, dropdownMenuActions, 'codicon-chevron-down');
	}
}

/**
 * Custom action view item that displays working directory with icon and text
 */
class WorkingDirectoryActionViewItem extends BaseActionViewItem {
	private sessionManager: ISessionManager;
	private consoleService: IConsoleService;
	private commandService: ICommandService;
	private labelElement?: HTMLElement;
	private iconElement?: HTMLElement;

	constructor(action: IAction, sessionManager: ISessionManager, consoleService: IConsoleService, commandService: ICommandService) {
		super(null, action);
		this.sessionManager = sessionManager;
		this.consoleService = consoleService;
		this.commandService = commandService;
	}

	override render(container: HTMLElement): void {
		super.render(container);

		container.classList.add('working-directory-action');
		container.style.display = 'flex';
		container.style.alignItems = 'center';
		container.style.cursor = 'pointer';
		container.style.padding = '0 8px';

		this.iconElement = document.createElement('span');
		this.iconElement.className = 'codicon codicon-folder';
		this.iconElement.style.marginRight = '5px';
		container.appendChild(this.iconElement);

		this.labelElement = document.createElement('span');
		this.labelElement.style.overflow = 'hidden';
		this.labelElement.style.textOverflow = 'ellipsis';
		this.labelElement.style.whiteSpace = 'nowrap';
		this.labelElement.style.maxWidth = '200px';
		this.labelElement.style.fontSize = '12px';
		container.appendChild(this.labelElement);

		this.updateDirectoryLabel();
		this.setupListeners();
	}

	private setupListeners(): void {
		this._register(this.sessionManager.onDidChangeForegroundSession(() => {
			this.updateDirectoryLabel();
			this.attachToRuntimeSession(this.sessionManager.foregroundSession);
		}));

		const session = this.sessionManager.foregroundSession;
		if (session) {
			this.attachToRuntimeSession(session);
		}
	}

	private attachToRuntimeSession(session: ILanguageRuntimeSession | undefined): void {
		if (!session) {
			return;
		}

		this._register(session.onDidReceiveRuntimeClientEvent((event) => {
			if (event.name === 'working_directory') {
				const directory = (event.data as { directory?: string })?.directory;
				this.updateDirectoryLabel(directory);
			} else if (event.name === 'clear_console') {
				const sessionMode = (event.data as { session_mode?: string })?.session_mode || 'console';
				
				// For console mode, clear the console
				if (sessionMode === 'console') {
					this.consoleService.requestClearConsole();
				} else if (sessionMode === 'notebook') {
					// For notebook mode, clear all cell outputs in the active notebook
					this.commandService.executeCommand('notebook.clearAllCellsOutputs').catch((_err: any) => {
						// Ignore error if no notebook is active
					});
				}
			}
		}));
	}

	private updateDirectoryLabel(directoryFromEvent?: string): void {
		if (!this.labelElement) {
			return;
		}

		const session = this.sessionManager.foregroundSession;
		if (session) {
			// Prefer directory from event (real-time update), fallback to dynState
			const workingDirectory = directoryFromEvent || session.dynState.currentWorkingDirectory;

			if (workingDirectory) {
				const parts = workingDirectory.split(/[/\\]/);
				const dirName = parts[parts.length - 1] || workingDirectory;
				this.labelElement.textContent = dirName;
				this.labelElement.title = workingDirectory;
			} else {
				this.labelElement.textContent = 'No working directory';
				this.labelElement.title = '';
			}
		} else {
			this.labelElement.textContent = 'No session';
			this.labelElement.title = '';
		}
	}
}

