/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { URI } from '../../../../base/common/uri.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { ISessionManager } from '../../../services/languageRuntime/common/sessionManager.js';
import { ILanguageRuntimeSession } from '../../../services/languageRuntime/common/languageRuntimeTypes.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IErdosEnvironmentService } from '../../erdosEnvironment/common/environmentTypes.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IWorkingCopyService } from '../../../services/workingCopy/common/workingCopyService.js';
import { INotebookService } from '../../notebook/common/notebookService.js';
import { CellKind } from '../../notebook/common/notebookCommon.js';
import { IPackageCheckerService } from '../common/packageChecker.js';

export class PackageCheckerService extends Disposable implements IWorkbenchContribution, IPackageCheckerService {

	static readonly ID = 'workbench.contrib.packageChecker';
	readonly _serviceBrand: undefined;

	private readonly _checkedFiles = new Set<string>();

	constructor(
		@IModelService private readonly _modelService: IModelService,
		@INotificationService private readonly _notificationService: INotificationService,
		@ISessionManager private readonly _sessionManager: ISessionManager,
		@IStorageService private readonly _storageService: IStorageService,
		@IErdosEnvironmentService private readonly _environmentService: IErdosEnvironmentService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IWorkingCopyService private readonly _workingCopyService: IWorkingCopyService,
		@INotebookService private readonly _notebookService: INotebookService,
	) {
		super();

		// Check models when they're added (opened)
		this._register(this._modelService.onModelAdded(model => {
			if (this._isEnabled('checkOnOpen')) {
				// Skip notebooks here - they're handled separately
				const isNotebook = model.uri.path.endsWith('.ipynb');
				if (!isNotebook) {
					this._checkModel(model, 'open');
				}
			}
		}));

		// Check notebooks when they're opened
		this._register(this._notebookService.onDidAddNotebookDocument(notebook => {
			if (this._isEnabled('checkOnOpen')) {
				this._checkNotebook(notebook.uri, 'open');
			}
		}));

		// Check models when they're saved
		this._register(this._workingCopyService.onDidSave(e => {
			if (this._isEnabled('checkOnSave')) {
				// Check if it's a notebook
				const isNotebook = e.workingCopy.resource.path.endsWith('.ipynb');
				if (isNotebook) {
					this._checkNotebook(e.workingCopy.resource, 'save');
				} else {
					const model = this._modelService.getModel(e.workingCopy.resource);
					if (model) {
						this._checkModel(model, 'save');
					}
				}
			}
		}));

		// Check existing models
		const existingModels = this._modelService.getModels();
		if (this._isEnabled('checkOnOpen')) {
			for (const model of existingModels) {
				this._checkModel(model, 'open');
			}
		}

		// Register this service with Quarto extension for preview/knit support
		this._registerWithQuartoExtension();
	}

	private async _registerWithQuartoExtension(): Promise<void> {
		// Wait a bit for extensions to load, then register
		setTimeout(async () => {
			try {
				const vscode = await import('vscode');
				await vscode.commands.executeCommand('quarto._setPackageCheckerService', this);
			} catch (error) {
				// Quarto extension might not be installed, that's okay
			}
		}, 1000);
	}

	private _isEnabled(setting?: 'checkOnOpen' | 'checkOnSave' | 'checkOnExecute'): boolean {
		const enabled = this._configurationService.getValue<boolean>('packageChecker.enabled');
		if (!enabled) {
			return false;
		}
		if (setting) {
			return this._configurationService.getValue<boolean>(`packageChecker.${setting}`) ?? true;
		}
		return true;
	}

	private async _checkModel(model: ITextModel, trigger: 'open' | 'save'): Promise<void> {
		const uri = model.uri;
		const languageId = model.getLanguageId();

		// Map language IDs to effective language for package checking
		let effectiveLanguageId = languageId;
		if (languageId === 'quarto') {
			effectiveLanguageId = 'r';
		} else if (languageId === 'jupyter' || languageId === 'ipynb') {
			effectiveLanguageId = 'python';
		}

		// Only check Python and R documents (including quarto and jupyter)
		if (effectiveLanguageId !== 'python' && effectiveLanguageId !== 'r') {
			return;
		}

		// For 'open' trigger, don't check twice in this session
		const key = uri.toString();
		if (trigger === 'open' && this._checkedFiles.has(key)) {
			return;
		}

		// Don't check if user dismissed for this file
		const storageKey = `packageChecker.dismissed.${key}`;
		if (this._storageService.getBoolean(storageKey, StorageScope.WORKSPACE)) {
			return;
		}

		if (trigger === 'open') {
			this._checkedFiles.add(key);
		}

		// Get the appropriate runtime session
		const session = this._getSessionForLanguage(effectiveLanguageId);
		if (!session) {
			return;
		}

		// Get file contents
		const content = model.getValue();

		try {
			const missingPackages = await this._environmentService.checkMissingPackages(
				content,
				uri.path,
				effectiveLanguageId as 'python' | 'r',
				session.runtimeMetadata.runtimeId
			);
			
			if (missingPackages.length > 0) {
				this._showInstallPrompt(missingPackages, session, effectiveLanguageId, storageKey);
			}
		} catch (error) {
			console.error('[PackageChecker] Package checker error:', error);
		}
	}

	private async _checkNotebook(uri: URI, trigger: 'open' | 'save'): Promise<void> {
		// For 'open' trigger, don't check twice in this session
		const key = uri.toString();
		if (trigger === 'open' && this._checkedFiles.has(key)) {
			return;
		}

		// Don't check if user dismissed for this file
		const storageKey = `packageChecker.dismissed.${key}`;
		if (this._storageService.getBoolean(storageKey, StorageScope.WORKSPACE)) {
			return;
		}

		if (trigger === 'open') {
			this._checkedFiles.add(key);
		}

		// Get the notebook model
		const notebookModel = this._notebookService.getNotebookTextModel(uri);
		if (!notebookModel) {
			return;
		}

		// Extract code from all Python/R code cells
		const codeCells = notebookModel.cells.filter(cell => 
			cell.cellKind === CellKind.Code && 
			(cell.language === 'python' || cell.language === 'r')
		);

		if (codeCells.length === 0) {
			return;
		}

		// Use the language of the first code cell
		const languageId = codeCells[0].language as 'python' | 'r';

		// Get appropriate session
		const session = this._getSessionForLanguage(languageId);
		if (!session) {
			return;
		}

		// Concatenate all code cell contents
		const allCode = codeCells.map(cell => cell.getValue()).join('\n\n');

		try {
			const missingPackages = await this._environmentService.checkMissingPackages(
				allCode,
				uri.path,
				languageId,
				session.runtimeMetadata.runtimeId
			);
			
			if (missingPackages.length > 0) {
				this._showInstallPrompt(missingPackages, session, languageId, storageKey);
			}
		} catch (error) {
			console.error('[PackageChecker] Package checker error:', error);
		}
	}

	private _getSessionForLanguage(languageId: string): ILanguageRuntimeSession | undefined {
		return this._sessionManager.activeSessions.find(s => s.runtimeMetadata.languageId === languageId);
	}

	private _showInstallPrompt(
		packages: string[],
		session: ILanguageRuntimeSession,
		languageId: string,
		storageKey: string
	): void {
		const packageList = packages.length <= 5
			? packages.join(', ')
			: `${packages.slice(0, 5).join(', ')} and ${packages.length - 5} more`;

		const message = `This file requires packages: ${packageList}. Would you like to install them?`;

		this._notificationService.prompt(
			Severity.Info,
			message,
			[
			{
				label: `Install All (${packages.length})`,
				run: () => {
					this._installPackages(packages, session, languageId);
				}
			},
				{
					label: 'Not Now',
					run: () => {
						// User dismissed
					},
					isSecondary: true
				},
				{
					label: 'Don\'t Ask Again for This File',
					run: () => {
						this._storageService.store(storageKey, true, StorageScope.WORKSPACE, StorageTarget.USER);
					},
					isSecondary: true
				}
			]
		);
	}

	private async _installPackages(
		packages: string[],
		session: ILanguageRuntimeSession,
		languageId: string
	): Promise<void> {
		let installed = 0;
		let failed = 0;

		for (const pkg of packages) {
			try {
				if (languageId === 'python') {
					await this._environmentService.installPythonPackage(pkg, session.runtimeMetadata.runtimeId);
					installed++;
				} else if (languageId === 'r') {
					await this._environmentService.installRPackage(pkg, session.runtimeMetadata.runtimeId);
					installed++;
				}
			} catch (error) {
				console.error(`[PackageChecker] Failed to install ${pkg}:`, error);
				failed++;
			}
		}

		if (installed > 0) {
			this._notificationService.info(`Successfully installed ${installed} package${installed === 1 ? '' : 's'}`);
		}
		if (failed > 0) {
			this._notificationService.error(`Failed to install ${failed} package${failed === 1 ? '' : 's'}`);
		}
	}

	/**
	 * Public method to check packages before code execution.
	 * BLOCKS execution until user makes a decision about missing packages.
	 * Returns true if execution should proceed, false if it should be cancelled.
	 */
	async checkPackagesBeforeExecution(code: string, languageId: 'python' | 'r', isAICommand: boolean = false): Promise<boolean> {
		if (!this._isEnabled('checkOnExecute')) {
			return true;
		}

		const session = this._getSessionForLanguage(languageId);
		if (!session) {
			return true;
		}

		try {
			const missingPackages = await this._environmentService.checkMissingPackages(
				code,
				isAICommand ? '<command execution>' : '<execution>',
				languageId,
				session.runtimeMetadata.runtimeId
			);

			if (missingPackages.length > 0) {
				return await this._showInstallPromptAndWait(missingPackages, session, languageId, isAICommand);
			}

			return true;
		} catch (error) {
			console.error('[PackageChecker] Error checking packages before execution:', error);
			return true;
		}
	}

	/**
	 * Show install prompt and BLOCK until user makes a decision.
	 * Returns true if execution should proceed (after install or user chose to continue anyway).
	 * Returns false if user cancelled.
	 */
	private async _showInstallPromptAndWait(
		packages: string[],
		session: ILanguageRuntimeSession,
		languageId: string,
		isAICommand: boolean
	): Promise<boolean> {
		return new Promise<boolean>((resolve) => {
			const packageList = packages.length <= 5
				? packages.join(', ')
				: `${packages.slice(0, 5).join(', ')} and ${packages.length - 5} more`;

			const subject = isAICommand ? 'This command' : 'This code';
			const message = `${subject} requires packages: ${packageList}. Install before running?`;

			this._notificationService.prompt(
				Severity.Warning,
				message,
				[
					{
						label: `Install and Run (${packages.length})`,
						run: async () => {
							try {
								await this._installPackages(packages, session, languageId);
								resolve(true);
							} catch (error) {
								console.error(`[PackageChecker] Installation failed:`, error);
								this._notificationService.error(`Failed to install packages. Execution cancelled.`);
								resolve(false);
							}
						}
					},
					{
						label: 'Run Anyway',
						run: () => {
							resolve(true);
						},
						isSecondary: true
					},
					{
						label: 'Cancel',
						run: () => {
							resolve(false);
						},
						isSecondary: true
					}
				]
			);
		});
	}
}

