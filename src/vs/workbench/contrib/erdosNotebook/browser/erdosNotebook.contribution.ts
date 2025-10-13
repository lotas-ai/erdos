/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from '../../../common/contributions.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { IErdosNotebookKernelService } from './notebookKernelService.js';
import { Disposable } from '../../../../base/common/lifecycle.js';

/**
 * Contribution that ensures the Erdos Notebook Kernel Service is instantiated.
 */
class ErdosNotebookKernelContribution extends Disposable {
	constructor(
		@IErdosNotebookKernelService _erdosNotebookKernelService: IErdosNotebookKernelService,
	) {
		super();
		// Service is now instantiated
	}
}

// Register to run at Restored phase to ensure services are available
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
	.registerWorkbenchContribution(ErdosNotebookKernelContribution, LifecyclePhase.Restored);

