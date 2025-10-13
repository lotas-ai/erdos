/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from '../../../../platform/registry/common/platform.js';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions } from '../../../../platform/configuration/common/configurationRegistry.js';
import { localize } from '../../../../nls.js';

const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);

configurationRegistry.registerConfiguration({
	id: 'packageChecker',
	order: 100,
	title: localize('packageChecker', "Package Checker"),
	type: 'object',
	properties: {
		'packageChecker.enabled': {
			type: 'boolean',
			default: true,
			description: localize('packageChecker.enabled', "Enable automatic package checking when opening, saving, or executing R/Python files.")
		},
		'packageChecker.checkOnOpen': {
			type: 'boolean',
			default: true,
			description: localize('packageChecker.checkOnOpen', "Check for missing packages when opening R/Python files.")
		},
		'packageChecker.checkOnSave': {
			type: 'boolean',
			default: true,
			description: localize('packageChecker.checkOnSave', "Check for missing packages when saving R/Python files.")
		},
		'packageChecker.checkOnExecute': {
			type: 'boolean',
			default: true,
			description: localize('packageChecker.checkOnExecute', "Check for missing packages before executing R/Python code.")
		}
	}
});

