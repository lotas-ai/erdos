/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as http from 'http';
import type { Server } from 'http';
import { Disposable } from '../../../base/common/lifecycle.js';
import { IExtHostRpcService } from '../common/extHostRpcService.js';
import { ExtHostProxyShape, ProxyOptions } from '../common/extHost.protocol.js';
import { URI } from '../../../base/common/uri.js';
import { IExtHostWindow } from '../common/extHostWindow.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { findFreePortFaster } from '../../../base/node/ports.js';

export const IExtHostProxy = createDecorator<IExtHostProxy>('IExtHostProxy');

export interface IExtHostProxy extends ExtHostProxyShape {
}

interface ProxyServerInfo {
	server: Server;
	targetOrigin: string;
	proxyOrigin: string;
	externalUri: string;
}

export class ExtHostProxy extends Disposable implements IExtHostProxy {
	private readonly _proxies = new Map<string, ProxyServerInfo>();
	private _nextId = 1;

	constructor(
		@IExtHostRpcService extHostRpc: IExtHostRpcService,
		@IExtHostWindow private readonly _extHostWindow: IExtHostWindow
	) {
		super();
	}

	async $createProxy(targetOrigin: string, options: ProxyOptions): Promise<string> {
		const proxyId = `proxy-${this._nextId++}`;
		const port = await findFreePortFaster(9000, 1000, 5000);
		if (port === 0) {
			throw new Error('Could not find free port for proxy server');
		}
		const serverOrigin = `http://127.0.0.1:${port}`;

		const express = await import('express' as any) as any;
		const proxyMiddleware = await import('http-proxy-middleware' as any) as any;
		
		const app = express.default ? express.default() : express();
		const server = http.createServer(app);

		await new Promise<void>((resolve, reject) => {
			server.once('error', reject);
			server.listen(port, '127.0.0.1', () => {
				server.off('error', reject);
				resolve();
			});
		});

		const externalUri = await this._extHostWindow.asExternalUri(URI.parse(serverOrigin), {});

		const createProxy = proxyMiddleware.createProxyMiddleware || proxyMiddleware.default?.createProxyMiddleware;
		const interceptor = proxyMiddleware.responseInterceptor || proxyMiddleware.default?.responseInterceptor;

		app.use('/', createProxy({
			target: targetOrigin,
			changeOrigin: true,
			selfHandleResponse: true,
			ws: options.enableWebSocket ?? false,
			on: {
				proxyRes: interceptor(async (responseBuffer: Buffer, proxyRes: http.IncomingMessage, req: http.IncomingMessage, _res: http.ServerResponse) => {
					const contentType = proxyRes.headers['content-type'] || '';
					if (contentType.includes('text/html')) {
						let content = responseBuffer.toString('utf8');
						
						if (options.htmlTransform === 'help') {
							content = this.transformHelpHtml(content, externalUri.toString(), options);
						} else if (options.htmlTransform === 'plot') {
							content = this.transformPlotHtml(content, options);
						}
						
						return Buffer.from(content, 'utf8');
					}
					return responseBuffer;
				}),
			},
		}));

		this._proxies.set(proxyId, {
			server,
			targetOrigin,
			proxyOrigin: serverOrigin,
			externalUri: externalUri.toString()
		});

		return externalUri.toString();
	}

	async $disposeProxy(proxyId: string): Promise<void> {
		const info = this._proxies.get(proxyId);
		if (info) {
			await new Promise<void>((resolve) => {
				info.server.close(() => resolve());
			});
			this._proxies.delete(proxyId);
		}
	}

	private transformHelpHtml(content: string, proxyUrl: string, options: ProxyOptions): string {
		const proxyPath = new URL(proxyUrl).pathname;
		content = this.rewriteUrlsWithProxyPath(content, proxyPath);
		content = this.injectResources(content, options);
		return content;
	}

	private transformPlotHtml(content: string, options: ProxyOptions): string {
		return this.injectResources(content, options);
	}

	private rewriteUrlsWithProxyPath(content: string, proxyPath: string): string {
		const relativeLinkPattern = /(href|src)="(?!http|\/\/|data:|#)([^"]*)"/g;
		return content.replace(relativeLinkPattern, (_match, attr, url) => {
			// Ensure we don't create double slashes
			const separator = proxyPath.endsWith('/') ? '' : '/';
			const newUrl = `${proxyPath}${separator}${url}`;
			return `${attr}="${newUrl}"`;
		});
	}

	private injectResources(content: string, options: ProxyOptions): string {
		const headStartIndex = content.toLowerCase().indexOf('<head>');
		const headEndIndex = content.toLowerCase().indexOf('</head>');
		
		if (headEndIndex === -1) {
			return content;
		}

		let headStartInjection = '';
		let headEndInjection = '';

		// Inject CSS variables for help styles (like Positron does)
		if (options.helpStyles && Object.keys(options.helpStyles).length > 0) {
			headStartInjection += '<style id="help-vars">\n';
			headStartInjection += '    body {\n';
			for (const [key, value] of Object.entries(options.helpStyles)) {
				headStartInjection += `        --${key}: ${value};\n`;
			}
			headStartInjection += '    }\n';
			headStartInjection += '</style>\n';
		}

		// Inject style defaults and overrides
		if (options.styles && options.styles.length > 0) {
			headStartInjection += options.styles.join('\n') + '\n';
		}

		// Inject scripts before </head>
		if (options.scripts && options.scripts.length > 0) {
			headEndInjection += options.scripts.join('\n') + '\n';
		}

		// Inject help vars and styles after <head>, scripts before </head>
		let result = content;
		if (headStartIndex !== -1 && headStartInjection) {
			result = result.slice(0, headStartIndex + 6) + '\n' + headStartInjection + result.slice(headStartIndex + 6);
		}
		if (headEndInjection) {
			const updatedHeadEndIndex = result.toLowerCase().indexOf('</head>');
			result = result.slice(0, updatedHeadEndIndex) + headEndInjection + result.slice(updatedHeadEndIndex);
		}

		return result;
	}

	override dispose(): void {
		for (const [proxyId] of this._proxies) {
			this.$disposeProxy(proxyId);
		}
		this._proxies.clear();
		super.dispose();
	}
}

