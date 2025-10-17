/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ISessionManager } from '../../../services/languageRuntime/common/sessionManager.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from '../../../common/contributions.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';

export class KernelWorkspaceSync extends Disposable implements IWorkbenchContribution {

	constructor(
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@ISessionManager private readonly sessionManager: ISessionManager
	) {
		super();

		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(async () => {
			await this.syncWorkspaceToKernels();
		}));

		this.syncWorkspaceToKernels();
	}

	private async syncWorkspaceToKernels(): Promise<void> {
		const workspace = this.workspaceContextService.getWorkspace();
		if (workspace.folders.length === 0) {
			return;
		}

		const workspacePath = workspace.folders[0].uri.fsPath;
		const sessions = this.sessionManager.activeSessions;

		for (const session of sessions) {
			if (session.setWorkingDirectory) {
				await session.setWorkingDirectory(workspacePath);
			}
		}
	}
}

const workbenchRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);
workbenchRegistry.registerWorkbenchContribution(KernelWorkspaceSync, LifecyclePhase.Restored);

