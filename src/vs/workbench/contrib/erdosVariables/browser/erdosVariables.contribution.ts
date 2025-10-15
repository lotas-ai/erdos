/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IWorkbenchContribution, IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from '../../../common/contributions.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IErdosVariablesService } from '../common/variablesTypes.js';
import { VariablesService } from './variablesService.js';

// Register the Variables Service as a singleton
registerSingleton(IErdosVariablesService, VariablesService, InstantiationType.Delayed);

// Bootstrap contribution to ensure service is initialized
class VariablesServiceBootstrap extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.erdosVariables';

	constructor(
		@IErdosVariablesService _variablesService: IErdosVariablesService
	) {
		super();
		// Service is automatically initialized when injected
	}
}

// Register the bootstrap contribution
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(
	VariablesServiceBootstrap,
	LifecyclePhase.Restored
);

