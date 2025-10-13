/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IMainThreadProxy } from '../../../api/common/extHost.protocol.js';

export const IProxyService = createDecorator<IProxyService>('proxyService');

export interface IProxyService {
	readonly _serviceBrand: undefined;

	setProxy(proxy: IMainThreadProxy): void;
	createHelpProxy(targetOrigin: string, helpStyles?: Record<string, string | number>): Promise<string>;
	createHtmlProxy(targetOrigin: string, htmlPath: string): Promise<string>;
	createHttpProxy(targetOrigin: string, htmlPath: string): Promise<string>;
}

