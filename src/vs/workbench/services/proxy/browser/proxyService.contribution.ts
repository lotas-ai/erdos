/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IProxyService } from '../common/proxy.js';
import { ProxyService } from './proxyService.js';

registerSingleton(IProxyService, ProxyService, InstantiationType.Delayed);

