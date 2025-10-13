/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Action2, registerAction2, MenuId } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { ERDOS_CONSOLE_VIEW_ID, IConsoleService } from '../../../services/erdosConsole/common/consoleService.js';
import { ISessionManager } from '../../../services/languageRuntime/common/sessionManager.js';
import { LanguageRuntimeSessionMode, ILanguageRuntimeMetadata } from '../../../services/languageRuntime/common/languageRuntimeTypes.js';
import { ILanguageRuntimeService } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { IQuickInputService, IQuickPickItem, IQuickPickSeparator } from '../../../../platform/quickinput/common/quickInput.js';
import { localize, localize2 } from '../../../../nls.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { URI } from '../../../../base/common/uri.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IEditor } from '../../../../editor/common/editorCommon.js';
import { EditorContextKeys } from '../../../../editor/common/editorContextKeys.js';
import { NOTEBOOK_EDITOR_FOCUSED } from '../../notebook/common/notebookContextKeys.js';
import { isWindows, isMacintosh, isLinux } from '../../../../base/common/platform.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IProgressService, ProgressLocation } from '../../../../platform/progress/common/progress.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ITerminalService, ITerminalGroupService } from '../../terminal/browser/terminal.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { CodeAttributionSource } from '../../../services/languageRuntime/common/codeExecution.js';

export const CONSOLE_VIEW_ID = ERDOS_CONSOLE_VIEW_ID;

export const ERDOS_CONSOLE_INSTANCES_EXIST_KEY = 'erdosConsoleInstancesExist';

/**
 * Parse a version string into major, minor, and patch numbers
 */
function parseVersion(version: string): { major: number; minor: number; patch: number } {
	const parts = version.split('.').map(p => {
		const num = parseInt(p, 10);
		return isNaN(num) ? 0 : num;
	});
	return {
		major: parts[0] || 0,
		minor: parts[1] || 0,
		patch: parts[2] || 0
	};
}

/**
 * Helper function to get installation commands based on OS and language
 */
function getInstallationCommands(languageId: 'python' | 'r'): { command: string; args: string[]; description: string } | null {
	if (isWindows) {
		if (languageId === 'python') {
			return {
				command: 'winget',
				args: ['install', 'Python.Python.3.12', '--accept-source-agreements', '--accept-package-agreements'],
				description: 'Installing Python via winget...'
			};
		} else {
			return {
				command: 'winget',
				args: ['install', 'RProject.R', '--accept-source-agreements', '--accept-package-agreements'],
				description: 'Installing R via winget...'
			};
		}
	} else if (isMacintosh) {
		if (languageId === 'python') {
			return {
				command: 'brew',
				args: ['install', 'python@3.12'],
				description: 'Installing Python via Homebrew...'
			};
		} else {
			return {
				command: 'brew',
				args: ['install', 'r'],
				description: 'Installing R via Homebrew...'
			};
		}
	} else if (isLinux) {
		if (languageId === 'python') {
			return {
				command: 'sh',
				args: ['-c', 'if command -v apt >/dev/null 2>&1; then sudo apt update && sudo apt install -y python3 python3-pip; elif command -v yum >/dev/null 2>&1; then sudo yum install -y python3 python3-pip; elif command -v dnf >/dev/null 2>&1; then sudo dnf install -y python3 python3-pip; elif command -v pacman >/dev/null 2>&1; then sudo pacman -S --noconfirm python python-pip; else echo "No supported package manager found"; exit 1; fi'],
				description: 'Installing Python via system package manager...'
			};
		} else {
			return {
				command: 'sh',
				args: ['-c', 'if command -v apt >/dev/null 2>&1; then sudo apt update && sudo apt install -y r-base r-base-dev; elif command -v yum >/dev/null 2>&1; then sudo yum install -y R R-devel; elif command -v dnf >/dev/null 2>&1; then sudo dnf install -y R R-devel; elif command -v pacman >/dev/null 2>&1; then sudo pacman -S --noconfirm r; else echo "No supported package manager found"; exit 1; fi'],
				description: 'Installing R via system package manager...'
			};
		}
	}
	return null;
}

/**
 * Helper function to install an interpreter using system package managers
 */
async function installInterpreter(
	languageId: 'python' | 'r',
	progressService: IProgressService,
	notificationService: INotificationService,
	logService: ILogService,
	terminalService: ITerminalService,
	terminalGroupService: ITerminalGroupService
): Promise<boolean> {
	const installCommand = getInstallationCommands(languageId);
	if (!installCommand) {
		notificationService.error(localize('unsupportedOS', 'Automatic installation is not supported on this operating system.'));
		return false;
	}

	return new Promise<boolean>((resolve) => {
		progressService.withProgress({
			location: ProgressLocation.Notification,
			title: installCommand.description,
			cancellable: false
		}, async (progress) => {
			try {
				progress.report({ increment: 10, message: localize('startingInstallation', 'Starting installation...') });
				
				const fullCommand = `${installCommand.command} ${installCommand.args.join(' ')}`;
				
				progress.report({ increment: 20, message: localize('creatingTerminal', 'Creating terminal...') });
				
				const terminal = await terminalService.createTerminal({
					config: {
						name: `${languageId === 'python' ? 'Python' : 'R'} Installation`
					}
				});
				
				// Show the terminal panel and set this terminal as active
				await terminalGroupService.showPanel(true);
				terminalService.setActiveInstance(terminal);
				
				progress.report({ increment: 30, message: localize('runningInstallation', 'Running installation command...') });
				
				await terminal.sendText(fullCommand, true);
				
				progress.report({ increment: 40, message: localize('installationComplete', 'Installation started!') });
				
				notificationService.info(localize('installationStarted', 
					'{0} installation has been started in the terminal. Please check the terminal output to verify successful installation.',
					languageId === 'python' ? 'Python' : 'R'));
				
				setTimeout(() => {
					resolve(true);
				}, 1000);
				
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				notificationService.error(localize('installationError', 'Failed to start installation of {0}: {1}', 
					languageId === 'python' ? 'Python' : 'R', errorMessage));
				resolve(false);
			}
		});
	});
}

/**
 * Helper function to browse for and add a custom interpreter
 * Returns the discovered runtime if successful, undefined otherwise
 */
async function browseForInterpreter(
	languageId: 'python' | 'r',
	fileDialogService: IFileDialogService,
	fileService: IFileService,
	configurationService: IConfigurationService,
	languageRuntimeService: ILanguageRuntimeService,
	notificationService: INotificationService,
	logService: ILogService
): Promise<ILanguageRuntimeMetadata | undefined> {
	const configKey = languageId === 'python' ? 'python.interpreters.include' : 'erdos.r.customBinaries';
	const dialogTitle = languageId === 'python'
		? localize('selectPythonInterpreter', 'Select Python Interpreter')
		: localize('selectRInterpreter', 'Select R Interpreter');
	
	const dialogFilters = isWindows ? [{ name: 'Executables', extensions: ['exe'] }] : undefined;
	
	const result = await fileDialogService.showOpenDialog({
		title: dialogTitle,
		filters: dialogFilters,
		canSelectMany: false,
		canSelectFiles: true,
		canSelectFolders: true
	});

	if (result && result.length > 0) {
		const interpreterPath = result[0];
		
		try {
			const stat = await fileService.stat(interpreterPath);
			
			// First, check if this path is in the exclusion list and remove it
			const excludeKey = languageId === 'python' ? 'python.interpreters.exclude' : 'erdos.r.excludedBinaries';
			const excludedPaths = configurationService.getValue<string[]>(excludeKey) || [];
			const wasExcluded = excludedPaths.includes(interpreterPath.fsPath);
			
			if (wasExcluded) {
				logService.info(`[browseForInterpreter] Removing ${interpreterPath.fsPath} from exclusion list`);
				const newExcludedPaths = excludedPaths.filter(p => p !== interpreterPath.fsPath);
				await configurationService.updateValue(excludeKey, newExcludedPaths);
			}
			
			// Now check if it's already in the include list
			const currentPaths = configurationService.getValue<string[]>(configKey) || [];
			const alreadyIncluded = currentPaths.includes(interpreterPath.fsPath);
			
			if (!alreadyIncluded) {
				logService.info(`[browseForInterpreter] Adding ${languageId} path: ${interpreterPath.fsPath} (isFile: ${stat.isFile}, isDirectory: ${stat.isDirectory}, wasExcluded: ${wasExcluded})`);
				await configurationService.updateValue(configKey, 
					[...currentPaths, interpreterPath.fsPath]
				);
			} else {
				logService.info(`[browseForInterpreter] Path already in include list: ${interpreterPath.fsPath} (wasExcluded: ${wasExcluded})`);
			}

			let discoveredRuntime: ILanguageRuntimeMetadata | undefined;
			
			// First check if a matching runtime is already registered
			const existingRuntimes = languageRuntimeService.registeredRuntimes.filter(r => r.languageId === languageId);
			for (const runtime of existingRuntimes) {
				// For Python runtimes, runtimePath is the sysPrefix (environment root), 
				// and the actual executable is in extraRuntimeData.pythonPath
				const pythonPath = (runtime.extraRuntimeData as any)?.pythonPath;
				const actualExecutable = languageId === 'python' && pythonPath ? pythonPath : runtime.runtimePath;
				
				logService.info(`[browseForInterpreter] Checking existing runtime: ${runtime.runtimePath} (executable: ${actualExecutable}) against ${interpreterPath.fsPath}`);
				
				const isMatch = 
					actualExecutable === interpreterPath.fsPath || // Exact match with actual executable
					runtime.runtimePath === interpreterPath.fsPath || // Exact match with sysPrefix
					(stat.isDirectory && runtime.runtimePath.startsWith(interpreterPath.fsPath)) || // User selected dir contains runtime
					(stat.isDirectory && actualExecutable.startsWith(interpreterPath.fsPath)) || // User selected dir contains executable
					(stat.isFile && interpreterPath.fsPath.startsWith(runtime.runtimePath)); // User selected file is inside runtime dir
				
				if (isMatch) {
					logService.info(`[browseForInterpreter] Found existing matching runtime: ${runtime.runtimeName}`);
					discoveredRuntime = runtime;
					break;
				}
			}
			
			// If not found, wait for new runtime registration
			if (!discoveredRuntime) {
				logService.info(`[browseForInterpreter] No existing runtime found, waiting for discovery...`);
				const discoveryTimeout = 10000;
				let discoveryTimer: any;
				let listenerDisposable: import('../../../../base/common/lifecycle.js').IDisposable | undefined;

				const discoveryPromise = new Promise<ILanguageRuntimeMetadata | undefined>((resolve) => {
					listenerDisposable = languageRuntimeService.onDidRegisterRuntime((runtime) => {
						if (runtime.languageId === languageId) {
							// For Python runtimes, runtimePath is the sysPrefix (environment root), 
							// and the actual executable is in extraRuntimeData.pythonPath
							const pythonPath = (runtime.extraRuntimeData as any)?.pythonPath;
							const actualExecutable = languageId === 'python' && pythonPath ? pythonPath : runtime.runtimePath;
							
							logService.info(`[browseForInterpreter] New runtime discovered: ${runtime.runtimePath} (executable: ${actualExecutable}), looking for: ${interpreterPath.fsPath}`);
							
							const isMatch = 
								actualExecutable === interpreterPath.fsPath || // Exact match with actual executable
								runtime.runtimePath === interpreterPath.fsPath || // Exact match with sysPrefix
								(stat.isDirectory && runtime.runtimePath.startsWith(interpreterPath.fsPath)) || // User selected dir contains runtime
								(stat.isDirectory && actualExecutable.startsWith(interpreterPath.fsPath)) || // User selected dir contains executable
								(stat.isFile && interpreterPath.fsPath.startsWith(runtime.runtimePath)); // User selected file is inside runtime dir
							
							if (isMatch) {
								if (discoveryTimer) {
									clearTimeout(discoveryTimer);
								}
								discoveredRuntime = runtime;
								resolve(runtime);
							}
						}
					});

					discoveryTimer = setTimeout(() => {
						logService.warn(`[browseForInterpreter] Discovery timeout reached after ${discoveryTimeout}ms`);
						resolve(undefined);
					}, discoveryTimeout);
				});

				discoveredRuntime = await discoveryPromise;
				
				if (listenerDisposable) {
					listenerDisposable.dispose();
				}
			}

			if (discoveredRuntime) {
				notificationService.info(localize('interpreterDiscovered',
					'{0} interpreter was successfully discovered and added: {1}',
					languageId === 'python' ? 'Python' : 'R',
					discoveredRuntime.runtimeName));
				return discoveredRuntime;
			} else {
				// Discovery failed - rollback all changes
				logService.warn(`[browseForInterpreter] Discovery failed for ${interpreterPath.fsPath}, rolling back changes`);
				
				// Remove from include list if we added it
				if (!alreadyIncluded) {
					await configurationService.updateValue(configKey, currentPaths);
				}
				
				// Restore to exclude list if it was previously excluded
				if (wasExcluded) {
					await configurationService.updateValue(excludeKey, excludedPaths);
				}
				
				notificationService.error(localize('interpreterNotDiscovered',
					'No {0} interpreter was discovered at the selected path. Please verify the path is correct and contains a valid {1} executable.',
					languageId === 'python' ? 'Python' : 'R',
					languageId === 'python' ? 'python' : 'R'));
				return undefined;
			}
		} catch (error) {
			notificationService.error(localize('fileValidationFailed', 'Failed to add interpreter: {0}',
				error instanceof Error ? error.message : String(error)));
			logService.error('[browseForInterpreter] Error:', error);
			return undefined;
		}
	}
	return undefined;
}

const erdosConsoleRestartIcon = registerIcon('erdos-console-restart', Codicon.refresh, localize('erdosConsoleRestartIcon', "Restart console session"));
const erdosConsoleInterruptIcon = registerIcon('erdos-console-interrupt', Codicon.debugStop, localize('erdosConsoleInterruptIcon', "Interrupt console execution"));
const erdosConsoleClearIcon = registerIcon('erdos-console-clear', Codicon.clearAll, localize('erdosConsoleClearIcon', "Clear console"));
const erdosConsoleDeleteIcon = registerIcon('erdos-console-delete', Codicon.trash, localize('erdosConsoleDeleteIcon', "Delete session"));

export function registerConsoleActions(): void {

	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: 'workbench.action.erdosConsole.showWorkingDirectory',
				title: localize2('showWorkingDirectory', 'Working Directory'),
				icon: Codicon.folder,
				f1: false,
				menu: [{
					id: MenuId.ViewTitle,
					when: ContextKeyExpr.and(
						ContextKeyExpr.equals('view', CONSOLE_VIEW_ID),
						ContextKeyExpr.equals(ERDOS_CONSOLE_INSTANCES_EXIST_KEY, true)
					),
					group: 'navigation',
					order: 0
				}]
			});
		}

		async run(accessor: ServicesAccessor): Promise<void> {
			const sessionManager = accessor.get(ISessionManager);
			const fileDialogService = accessor.get(IFileDialogService);
			const notificationService = accessor.get(INotificationService);
			const session = sessionManager.foregroundSession;

		if (!session) {
			notificationService.warn(
				localize('console.noActiveSession', "No active console session")
			);
			return;
		}

			const currentDirectory = session.dynState.currentWorkingDirectory;

			try {
				const result = await fileDialogService.showOpenDialog({
					title: localize('console.selectWorkingDirectory', "Select Working Directory"),
					canSelectFiles: false,
					canSelectFolders: true,
					canSelectMany: false,
					defaultUri: currentDirectory ? URI.file(currentDirectory) : undefined,
					openLabel: localize('console.selectFolder', "Select Folder")
				});

				if (result && result.length > 0) {
					const newDirectory = result[0].fsPath;
					await session.setWorkingDirectory(newDirectory);
				}
			} catch (error) {
				notificationService.error(
					localize('console.workingDirectoryError', "Failed to change working directory: {0}", error)
				);
			}
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: 'workbench.action.erdosConsole.executeCode',
				title: localize2('executeCode', 'Execute Code'),
				f1: true,
				precondition: ContextKeyExpr.and(
					EditorContextKeys.editorTextFocus,
					NOTEBOOK_EDITOR_FOCUSED.toNegated()
				),
				keybinding: {
					weight: KeybindingWeight.WorkbenchContrib,
					primary: KeyMod.CtrlCmd | KeyCode.Enter,
					mac: {
						primary: KeyMod.CtrlCmd | KeyCode.Enter,
						secondary: [KeyMod.WinCtrl | KeyCode.Enter]
					}
				}
			});
		}

		async run(
			accessor: ServicesAccessor,
			opts: { languageId?: string } = {}
		) {
			const editorService = accessor.get(IEditorService);
			const notificationService = accessor.get(INotificationService);
			const consoleService = accessor.get(IConsoleService);

			const editor = editorService.activeTextEditorControl as IEditor;
			if (!editor) {
				return;
			}

			const selection = editor.getSelection();
			const model = editor.getModel() as ITextModel;
			if (!model) {
				return;
			}

			let code: string | undefined = undefined;
			let endLineNumber: number | undefined = undefined;

			if (selection && !selection.isEmpty()) {
				code = model.getValueInRange(selection);
				endLineNumber = selection.endLineNumber;
			} else {
				const position = editor.getPosition();
				if (position) {
					code = model.getLineContent(position.lineNumber).trim();
					endLineNumber = position.lineNumber;
				}
			}

			if (!code) {
				return;
			}

			const languageId = opts.languageId || editorService.activeTextEditorLanguageId;
			if (!languageId) {
				notificationService.notify({
					severity: Severity.Info,
					message: localize('erdos.executeCode.noLanguage', "Cannot execute code. Unable to detect input language."),
					sticky: false
				});
				return;
			}

			// Get file path from active editor if available
			const activeEditor = editorService.activeEditor;
			const filePath = activeEditor?.resource?.fsPath;
			
			// Generate a batch ID for this execution
			const batchId = `${Date.now()}-${Math.floor(Math.random() * 0x100000000).toString(16)}`;

			try {
				await consoleService.executeCode(code, languageId, CodeAttributionSource.Script, undefined, batchId, undefined, filePath);
				
				// After successful execution, advance cursor to next line
				if (endLineNumber !== undefined) {
					const nextLineNumber = Math.min(endLineNumber + 1, model.getLineCount());
					const nextLineColumn = 1; // Move to beginning of next line
					
					editor.setPosition({
						lineNumber: nextLineNumber,
						column: nextLineColumn
					});
					
					editor.setSelection({
						startLineNumber: nextLineNumber,
						startColumn: nextLineColumn,
						endLineNumber: nextLineNumber,
						endColumn: nextLineColumn
					});
					
					// Ensure editor focus is maintained
					editor.focus();
				}
			} catch (error) {
				notificationService.notify({
					severity: Severity.Error,
					message: localize('erdos.executeCode.error', "Failed to execute code: {0}", error instanceof Error ? error.message : String(error)),
					sticky: false
				});
			}
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: 'workbench.action.erdosConsole.clearConsole',
				title: localize2('clearConsole', 'Clear Console'),
				icon: erdosConsoleClearIcon,
				f1: true,
				keybinding: {
					primary: KeyMod.CtrlCmd | KeyCode.KeyL,
					mac: { primary: KeyMod.WinCtrl | KeyCode.KeyL },
					weight: KeybindingWeight.WorkbenchContrib
				},
				menu: [{
					id: MenuId.ViewTitle,
					when: ContextKeyExpr.and(
						ContextKeyExpr.equals('view', CONSOLE_VIEW_ID),
						ContextKeyExpr.equals(ERDOS_CONSOLE_INSTANCES_EXIST_KEY, true)
					),
					group: 'navigation',
					order: 30
				}]
			});
		}

		run(accessor: ServicesAccessor): void {
			const consoleService = accessor.get(IConsoleService);
			consoleService.requestClearConsole();
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: 'workbench.action.erdosConsole.interruptExecution',
				title: localize2('interruptExecution', 'Interrupt Execution'),
				icon: erdosConsoleInterruptIcon,
				f1: true,
				menu: [{
					id: MenuId.ViewTitle,
					when: ContextKeyExpr.and(
						ContextKeyExpr.equals('view', CONSOLE_VIEW_ID),
						ContextKeyExpr.equals(ERDOS_CONSOLE_INSTANCES_EXIST_KEY, true)
					),
					group: 'navigation',
					order: 10
				}],
				keybinding: {
					primary: KeyMod.CtrlCmd | KeyCode.KeyC,
					weight: KeybindingWeight.WorkbenchContrib - 1, // Lower priority than default copy action
					// Only interrupt when NOT selecting text (allow copy to work)
					when: ContextKeyExpr.and(
						ContextKeyExpr.equals('view', CONSOLE_VIEW_ID),
						EditorContextKeys.editorTextFocus.toNegated()
					)
				}
			});
		}

		async run(accessor: ServicesAccessor): Promise<void> {
			// Check if there's a text selection - if so, let the copy action handle it
			const selection = window.getSelection();
			if (selection && selection.toString().length > 0) {
				// There's a text selection, execute copy instead
				document.execCommand('copy');
				return;
			}

			// No selection, proceed with interrupt
			const sessionManager = accessor.get(ISessionManager);
			const session = sessionManager.foregroundSession;
			
			if (session) {
				session.interrupt();
			}
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: 'workbench.action.erdosConsole.restartSession',
				title: localize2('restartSession', 'Restart Session'),
				icon: erdosConsoleRestartIcon,
				f1: true,
				menu: [{
					id: MenuId.ViewTitle,
					when: ContextKeyExpr.and(
						ContextKeyExpr.equals('view', CONSOLE_VIEW_ID),
						ContextKeyExpr.equals(ERDOS_CONSOLE_INSTANCES_EXIST_KEY, true)
					),
					group: 'navigation',
					order: 20
				}]
			});
		}

		async run(accessor: ServicesAccessor): Promise<void> {
			const sessionManager = accessor.get(ISessionManager);
			const session = sessionManager.foregroundSession;
			if (session) {
				// Restart by disposing and starting a new session
				await sessionManager.shutdownSession(session.sessionId);
				await sessionManager.startSession(
					session.runtimeMetadata,
					session.metadata.sessionMode,
					`${session.runtimeMetadata.languageName} Console`
				);
			}
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: 'workbench.action.erdosConsole.deleteSession',
				title: localize2('deleteSession', 'Delete Session'),
				icon: erdosConsoleDeleteIcon,
				f1: true,
				menu: [{
					id: MenuId.ViewTitle,
					when: ContextKeyExpr.and(
						ContextKeyExpr.equals('view', CONSOLE_VIEW_ID),
						ContextKeyExpr.equals(ERDOS_CONSOLE_INSTANCES_EXIST_KEY, true)
					),
					group: 'navigation',
					order: 21
				}]
			});
		}

		async run(accessor: ServicesAccessor): Promise<void> {
			const sessionManager = accessor.get(ISessionManager);
			const session = sessionManager.foregroundSession;
			if (session) {
				await sessionManager.shutdownSession(session.sessionId);
			}
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: 'erdos.languageRuntime.startNewSession',
				title: localize2('startNewSession', 'Start New Session'),
				icon: Codicon.add,
				f1: true,
				category: localize2('languageRuntime', 'Language Runtime'),
				menu: [{
					id: MenuId.ViewTitle,
					when: ContextKeyExpr.and(
						ContextKeyExpr.equals('view', CONSOLE_VIEW_ID),
						ContextKeyExpr.equals(ERDOS_CONSOLE_INSTANCES_EXIST_KEY, false)
					),
					group: 'navigation',
					order: -1
				}]
			});
		}

		async run(accessor: ServicesAccessor): Promise<void> {
			const sessionManager = accessor.get(ISessionManager);
			const languageRuntimeService = accessor.get(ILanguageRuntimeService);
			const quickInputService = accessor.get(IQuickInputService);
			const notificationService = accessor.get(INotificationService);
			const fileDialogService = accessor.get(IFileDialogService);
			const fileService = accessor.get(IFileService);
			const configurationService = accessor.get(IConfigurationService);
			const logService = accessor.get(ILogService);
			const progressService = accessor.get(IProgressService);
			const terminalService = accessor.get(ITerminalService);
			const terminalGroupService = accessor.get(ITerminalGroupService);
			
			try {
				const runtimes = languageRuntimeService.registeredRuntimes;
				
				// Get excluded interpreters
				const excludedPythonPaths = configurationService.getValue<string[]>('python.interpreters.exclude') || [];
				const excludedRPaths = configurationService.getValue<string[]>('erdos.r.excludedBinaries') || [];
				
				// Build items list with runtimes grouped by language
				const items: Array<IQuickPickItem | IQuickPickSeparator> = [];
				
				// Group runtimes by language, filtering out excluded ones
				const runtimesByLanguage = new Map<string, typeof runtimes>();
				for (const runtime of runtimes) {
					// Skip excluded interpreters
					const isExcluded = (runtime.languageId === 'python' && excludedPythonPaths.includes(runtime.runtimePath)) ||
									   (runtime.languageId === 'r' && excludedRPaths.includes(runtime.runtimePath));
					if (isExcluded) {
						continue;
					}
					
					if (!runtimesByLanguage.has(runtime.languageId)) {
						runtimesByLanguage.set(runtime.languageId, []);
					}
					runtimesByLanguage.get(runtime.languageId)!.push(runtime);
				}
				
				// Add runtimes grouped by language (Python first, then R, then others alphabetically)
				const languageOrder = ['python', 'r'];
				const sortedLanguages = languageOrder.filter(lang => runtimesByLanguage.has(lang));
				
				// Add any other languages not in the explicit order
				for (const lang of Array.from(runtimesByLanguage.keys()).sort()) {
					if (!languageOrder.includes(lang)) {
						sortedLanguages.push(lang);
					}
				}
				
				for (const languageId of sortedLanguages) {
					const langRuntimes = runtimesByLanguage.get(languageId)!;
					const languageName = langRuntimes[0].languageName;
					
					// Sort runtimes by version (highest first)
					langRuntimes.sort((a, b) => {
						const aVersion = parseVersion(a.languageVersion);
						const bVersion = parseVersion(b.languageVersion);
						
						// Compare major, minor, patch
						if (bVersion.major !== aVersion.major) {
							return bVersion.major - aVersion.major;
						}
						if (bVersion.minor !== aVersion.minor) {
							return bVersion.minor - aVersion.minor;
						}
						return bVersion.patch - aVersion.patch;
					});
					
					// Add separator for this language
					items.push({ type: 'separator', label: languageName });
					
					// Add all runtimes for this language with trash buttons
					for (const runtime of langRuntimes) {
						items.push({
							label: runtime.runtimeName,
							detail: runtime.runtimePath,
							id: runtime.runtimeId,
							buttons: [{
								iconClass: ThemeIcon.asClassName(Codicon.trash),
								tooltip: localize('removeInterpreter', 'Remove interpreter from list'),
								alwaysVisible: false
							}]
						});
					}
				}
				
				// Add browse and install options
				const browsePythonId = 'browse-python-' + generateUuid();
				const browseRId = 'browse-r-' + generateUuid();
				const installPythonId = 'install-python-' + generateUuid();
				const installRId = 'install-r-' + generateUuid();
				
				items.push(
					{ type: 'separator', label: localize('browseForInterpreter', 'Browse for Interpreter') },
					{
						id: browsePythonId,
						label: `$(search) ${localize('findPythonInterpreter', 'Find Python Interpreter...')}`,
						detail: localize('browsePythonDetail', 'Browse your file system to find a Python interpreter')
					},
					{
						id: browseRId,
						label: `$(search) ${localize('findRInterpreter', 'Find R Interpreter...')}`,
						detail: localize('browseRDetail', 'Browse your file system to find an R interpreter')
					},
					{ type: 'separator', label: localize('installInterpreter', 'Install Interpreter') },
					{
						id: installPythonId,
						label: `$(cloud-download) ${localize('installPython', 'Install Python...')}`,
						detail: localize('installPythonDetail', 'Install Python using your system package manager')
					},
					{
						id: installRId,
						label: `$(cloud-download) ${localize('installR', 'Install R...')}`,
						detail: localize('installRDetail', 'Install R using your system package manager')
					}
				);
				
				const quickPick = quickInputService.createQuickPick<IQuickPickItem>({ useSeparators: true });
				const disposables = new DisposableStore();
				
				quickPick.items = items;
				quickPick.placeholder = localize('console.selectRuntime', "Select a language runtime to start");
				
				// Handle trash button clicks to exclude interpreters
				disposables.add(quickPick.onDidTriggerItemButton(async (event) => {
					const item = event.item as any;
					if (item.id) {
						const runtime = languageRuntimeService.getRegisteredRuntime(item.id);
						if (runtime) {
							// Add to exclude list
							if (runtime.languageId === 'python') {
								const excludedPaths = configurationService.getValue<string[]>('python.interpreters.exclude') || [];
								if (!excludedPaths.includes(runtime.runtimePath)) {
									excludedPaths.push(runtime.runtimePath);
									await configurationService.updateValue('python.interpreters.exclude', excludedPaths);
								}
							} else if (runtime.languageId === 'r') {
								const excludedPaths = configurationService.getValue<string[]>('erdos.r.excludedBinaries') || [];
								if (!excludedPaths.includes(runtime.runtimePath)) {
									excludedPaths.push(runtime.runtimePath);
									await configurationService.updateValue('erdos.r.excludedBinaries', excludedPaths);
								}
							}
							
							// Remove from quick pick immediately
							notificationService.info(localize('interpreterHidden', '{0} has been hidden from the list.', runtime.runtimeName));
							quickPick.items = quickPick.items.filter((i: any) => i.id !== item.id);
						}
					}
				}));
				
				quickPick.show();
				
				let acceptedItem: IQuickPickItem | undefined;
				const picked = await new Promise<IQuickPickItem | undefined>((resolve) => {
					disposables.add(quickPick.onDidAccept(() => {
						acceptedItem = quickPick.selectedItems[0];
						quickPick.hide();
					}));
					
					disposables.add(quickPick.onDidHide(() => {
						resolve(acceptedItem);
					}));
				});
				
				disposables.dispose();
				quickPick.dispose();
				
				if (!picked) {
					return;
				}
				
				// Handle browse options
				if (picked.id === browsePythonId) {
					const discoveredRuntime = await browseForInterpreter('python', fileDialogService, fileService, configurationService, languageRuntimeService, notificationService, logService);
					if (discoveredRuntime) {
						const sessionName = `${discoveredRuntime.languageName} ${new Date().toLocaleTimeString()}`;
						await sessionManager.startSession(discoveredRuntime, LanguageRuntimeSessionMode.Console, sessionName);
					}
					return;
				}
				if (picked.id === browseRId) {
					const discoveredRuntime = await browseForInterpreter('r', fileDialogService, fileService, configurationService, languageRuntimeService, notificationService, logService);
					if (discoveredRuntime) {
						const sessionName = `${discoveredRuntime.languageName} ${new Date().toLocaleTimeString()}`;
						await sessionManager.startSession(discoveredRuntime, LanguageRuntimeSessionMode.Console, sessionName);
					}
					return;
				}
				
				// Handle install options
				if (picked.id === installPythonId) {
					await installInterpreter('python', progressService, notificationService, logService, terminalService, terminalGroupService);
					return;
				}
				if (picked.id === installRId) {
					await installInterpreter('r', progressService, notificationService, logService, terminalService, terminalGroupService);
					return;
				}
				
				// Handle runtime selection
				const selectedRuntime = languageRuntimeService.getRegisteredRuntime(picked.id!);
				if (!selectedRuntime) {
					notificationService.error(localize('console.runtimeNotFound', "Selected runtime not found"));
					return;
				}

				const sessionName = `${selectedRuntime.languageName} ${new Date().toLocaleTimeString()}`;
				await sessionManager.startSession(selectedRuntime, LanguageRuntimeSessionMode.Console, sessionName);
			} catch (error) {
				notificationService.error(
					localize('console.startSessionFailed', "Failed to start session: {0}", error instanceof Error ? error.message : String(error))
				);
			}
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: 'erdos.languageRuntime.duplicateSession',
				title: localize2('duplicateSession', 'Duplicate Session'),
				f1: true,
				category: localize2('languageRuntime', 'Language Runtime'),
				menu: [{
					id: MenuId.ViewTitle,
					when: ContextKeyExpr.and(
						ContextKeyExpr.equals('view', CONSOLE_VIEW_ID),
						ContextKeyExpr.equals(ERDOS_CONSOLE_INSTANCES_EXIST_KEY, true)
					),
					group: 'navigation',
					order: 10
				}],
				icon: Codicon.add
			});
		}

		async run(accessor: ServicesAccessor): Promise<void> {
			const sessionManager = accessor.get(ISessionManager);
			const notificationService = accessor.get(INotificationService);
			
			const session = sessionManager.foregroundSession;
			if (!session) {
				notificationService.warn(
					localize('console.noActiveSession', "No active console session")
				);
				return;
			}

			try {
				const sessionName = `${session.runtimeMetadata.languageName} ${new Date().toLocaleTimeString()}`;
				await sessionManager.startSession(session.runtimeMetadata, LanguageRuntimeSessionMode.Console, sessionName);
			} catch (error) {
				notificationService.error(
					localize('console.duplicateSessionFailed', "Failed to duplicate session: {0}", error instanceof Error ? error.message : String(error))
				);
			}
		}
	});
}
