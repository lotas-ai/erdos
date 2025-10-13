/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from '../../../../platform/registry/common/platform.js';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from '../../../common/contributions.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { PackageCheckerService } from './packageCheckerService.js';
import { IPackageCheckerService } from '../common/packageChecker.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import '../common/packageCheckerConfiguration.js';

// Register the package checker service as a singleton
registerSingleton(IPackageCheckerService, PackageCheckerService, InstantiationType.Eager);

// Register the package checker service
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
	.registerWorkbenchContribution(PackageCheckerService, LifecyclePhase.Eventually);


