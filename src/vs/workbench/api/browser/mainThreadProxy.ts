/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { extHostNamedCustomer, IExtHostContext } from '../../services/extensions/common/extHostCustomers.js';
import { ExtHostContext, ExtHostProxyShape, MainContext, MainThreadProxyShape, ProxyOptions } from '../common/extHost.protocol.js';
import { IProxyService } from '../../services/proxy/common/proxy.js';

@extHostNamedCustomer(MainContext.MainThreadProxy)
export class MainThreadProxy extends Disposable implements MainThreadProxyShape {
	private readonly _proxy: ExtHostProxyShape;

	constructor(
		extHostContext: IExtHostContext,
		@IProxyService private readonly _proxyService: IProxyService
	) {
		super();
		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostProxy);
		this._proxyService.setProxy(this);
	}

	async $createProxy(targetOrigin: string, options: ProxyOptions): Promise<string> {
		return this._proxy.$createProxy(targetOrigin, options);
	}

	async $disposeProxy(proxyId: string): Promise<void> {
		return this._proxy.$disposeProxy(proxyId);
	}

	override dispose(): void {
		super.dispose();
	}
}

