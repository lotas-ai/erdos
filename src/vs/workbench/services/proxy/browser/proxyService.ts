/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IProxyService } from '../common/proxy.js';
import { IMainThreadProxy } from '../../../api/common/extHost.protocol.js';
import { loadProxyResources, ProxyResources } from './proxyResourceLoader.js';

export class ProxyService extends Disposable implements IProxyService {
	declare readonly _serviceBrand: undefined;

	private _proxy: IMainThreadProxy | null = null;
	private _resources: ProxyResources | null = null;
	private _resourcesPromise: Promise<ProxyResources> | null = null;

	constructor() {
		super();
	}

	setProxy(proxy: IMainThreadProxy): void {
		this._proxy = proxy;
	}

	private async _ensureResources(): Promise<ProxyResources> {
		if (this._resources) {
			return this._resources;
		}
		if (!this._resourcesPromise) {
			this._resourcesPromise = loadProxyResources();
		}
		this._resources = await this._resourcesPromise;
		return this._resources;
	}

	async createHelpProxy(targetOrigin: string, helpStyles?: Record<string, string | number>): Promise<string> {
		if (!this._proxy) {
			throw new Error('Proxy not initialized');
		}
		const resources = await this._ensureResources();
		return await this._proxy.$createProxy(targetOrigin, {
			htmlTransform: 'help',
			enableWebSocket: true,
			styles: [`<style>${resources.styleDefaults}</style>`, `<style>${resources.styleOverrides}</style>`],
			scripts: [`<script type="module">${resources.helpScript}</script>`],
			helpStyles
		});
	}

	async createHtmlProxy(targetOrigin: string, htmlPath: string): Promise<string> {
		if (!this._proxy) {
			throw new Error('Proxy not initialized');
		}
		const resources = await this._ensureResources();
		return this._proxy.$createProxy(targetOrigin, {
			htmlTransform: 'plot',
			enableWebSocket: false,
			styles: [`<style>${resources.styleDefaults}</style>`],
			scripts: []
		});
	}

	async createHttpProxy(targetOrigin: string, htmlPath: string): Promise<string> {
		if (!this._proxy) {
			throw new Error('Proxy not initialized');
		}
		const resources = await this._ensureResources();
		return this._proxy.$createProxy(targetOrigin, {
			enableWebSocket: false,
			styles: [`<style>${resources.styleDefaults}</style>`],
			scripts: []
		});
	}
}

