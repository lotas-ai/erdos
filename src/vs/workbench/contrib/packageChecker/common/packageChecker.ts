/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const IPackageCheckerService = createDecorator<IPackageCheckerService>('packageCheckerService');

export interface IPackageCheckerService {
	readonly _serviceBrand: undefined;

	/**
	 * Check packages before code execution.
	 * BLOCKS until user decides. Returns true to proceed, false to cancel.
	 */
	checkPackagesBeforeExecution(code: string, languageId: 'python' | 'r', isAICommand?: boolean): Promise<boolean>;
}

