/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IProxyService } from '../../../../services/proxy/common/proxy.js';
import { WebviewThemeDataProvider } from '../../../webview/browser/themeing.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';

export class HelpProxyManager {
	private _proxyServers = new Map<string, string>();
	private _stylesSet = false;
	private _currentThemeStyles?: Record<string, string | number>;

	constructor(
		private readonly _proxyService: IProxyService,
		private readonly _instantiationService: IInstantiationService
	) { }

	async activateProxyServer(targetOrigin: string): Promise<string | undefined> {
		let proxyOrigin = this._proxyServers.get(targetOrigin);
		if (proxyOrigin) {
			return proxyOrigin;
		}

		if (!this._stylesSet) {
			await this.applyCurrentTheme();
		}

		proxyOrigin = await this._proxyService.createHelpProxy(targetOrigin, this._currentThemeStyles);

		if (proxyOrigin) {
			this._proxyServers.set(targetOrigin, proxyOrigin);
		}

		return proxyOrigin;
	}

	async applyCurrentTheme(): Promise<void> {
		const webviewThemeDataProvider = this._instantiationService.createInstance(WebviewThemeDataProvider);
		const { styles } = webviewThemeDataProvider.getWebviewThemeData();
		webviewThemeDataProvider.dispose();
		
		this._currentThemeStyles = styles;
		this._stylesSet = true;
	}

	async deactivateProxyServer(targetOrigin: string): Promise<void> {
		if (this._proxyServers.has(targetOrigin)) {
			this._proxyServers.delete(targetOrigin);
		}
	}
}


