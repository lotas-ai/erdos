/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const ISessionManagement = createDecorator<ISessionManagement>('sessionManagement');

export interface ISessionManagement {
	readonly _serviceBrand: undefined;

	ensureRSession(): Promise<void>;
	ensurePythonSession(): Promise<void>;
}
