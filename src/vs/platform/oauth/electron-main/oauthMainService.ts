/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { shell } from 'electron';
import { createServer } from 'http';
import { existsSync, readFileSync } from 'fs';
import { dirname, extname, join } from 'path';
import { fileURLToPath } from 'url';
import { Disposable } from '../../../base/common/lifecycle.js';
import { Event, Emitter } from '../../../base/common/event.js';
import { IOAuthMainService, IOAuthResult } from '../common/oauth.js';
import { ILogService } from '../../log/common/log.js';

// Paths are relative to the compiled Electron main bundle. Replace these files to customize imagery.
const NODE_DIRNAME = dirname(fileURLToPath(import.meta.url));
const SUCCESS_PAGE_CHECKMARK_IMAGE_PATH = join(NODE_DIRNAME, 'resources', 'lotas-square.png');
const ERROR_PAGE_ICON_IMAGE_PATH = join(NODE_DIRNAME, 'resources', 'lotas-square.png');
const NOTIFICATION_PAGE_FONT_FAMILY = `'Inter', 'Helvetica Neue', 'Segoe UI', Arial, sans-serif`;

export class OAuthMainService extends Disposable implements IOAuthMainService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidCompleteOAuth = this._register(new Emitter<IOAuthResult>());
	readonly onDidCompleteOAuth: Event<IOAuthResult> = this._onDidCompleteOAuth.event;

	private _server: any = null;

	constructor(
		@ILogService private readonly logService: ILogService
	) {
		super();
	}

	async startOAuthFlow(authUrl: string): Promise<void> {
		// Ignore authUrl parameter - we build our own URL for OAuth flow
		if (this._server) {
			this.logService.warn('OAuth flow already in progress, stopping previous server');
			await this.stopOAuthServer();
		}

		try {
			// Create HTTP server for OAuth callback
			const loopbackInfo = await this.startAuthLoopbackServer();
			const loopbackUrl = `http://${loopbackInfo.address}:${loopbackInfo.port}/auth_callback`;
			
			// Determine backend environment for OAuth redirect
			const backendEnv = await this.detectBackendEnvironment();
			let finalAuthUrl: string;
			
			if (backendEnv === "local") {
				finalAuthUrl = `http://localhost:3000/rao-callback?redirect_uri=${encodeURIComponent(loopbackUrl)}`;
			} else {
				finalAuthUrl = `https://www.lotas.ai/rao-callback?redirect_uri=${encodeURIComponent(loopbackUrl)}`;
			}
			
			this.logService.info('OAuth callback server started on:', loopbackUrl);
			this.logService.info('Opening OAuth URL in external browser:', finalAuthUrl);

			// Open OAuth URL in external browser to leverage existing authentication cookies
			await shell.openExternal(finalAuthUrl);

		} catch (error) {
			this.logService.error('Failed to start OAuth flow:', error);
			this._onDidCompleteOAuth.fire({
				error: 'oauth_error',
				error_description: error instanceof Error ? error.message : 'Unknown OAuth error'
			});
		}
	}

	// Start authentication loopback server
	private async startAuthLoopbackServer(): Promise<{ address: string; port: number }> {
		// Try both IPv4 and IPv6 loopback as recommended by RFC 8252
		const loopbackAddresses = ['127.0.0.1', '::1'];

		for (const address of loopbackAddresses) {
			// Try ephemeral port range (49152-65535 as recommended by IANA)
			const startPort = Math.floor(Math.random() * (65535 - 49152 + 1)) + 49152;

							for (let i = 0; i < 100; i++) { // Try up to 100 ports
				let port = startPort + i;
				if (port > 65535) port = 49152 + (port - 65536); // Wrap around to beginning of range

				try {
					await this.tryStartServer(address, port);
					return { address, port };
				} catch (error: any) {
					if (error.code === 'EADDRINUSE') {
						continue; // Try next port
					}
					throw error;
				}
			}
		}

		throw new Error('Unable to start OAuth callback server: no available ports');
	}

	// Start HTTP server with OAuth callback handling
	private async tryStartServer(address: string, port: number): Promise<void> {
		return new Promise((resolve, reject) => {
			const server = createServer((req: any, res: any) => {
				this.logService.info('OAuth HTTP request received:', req.url);
				
				if (req.url && req.url.includes('/auth_callback')) {
					this.logService.info('OAuth callback detected, parsing URL:', req.url);
					const url = new URL(req.url, `http://${req.headers.host}`);
					const apiKey = url.searchParams.get('api_key');
					const error = url.searchParams.get('error');

					this.logService.info('OAuth callback params - api_key:', apiKey ? `${apiKey.substring(0, 10)}...` : 'null', 'error:', error || 'null');

					if (apiKey && apiKey !== "") {
						// Save the API key and notify UI
						this._onDidCompleteOAuth.fire({ api_key: apiKey });

						// Schedule server cleanup after 3 seconds
						setTimeout(() => {
							this.stopOAuthServer();
						}, 3000);

						// Return success page
						const successHtml = this.buildSuccessHtml();
						res.writeHead(200, { 'Content-Type': 'text/html' });
						res.end(successHtml);
						return;
					} else {
						// Handle error case
						const errorHtml = this.buildErrorHtml();
						res.writeHead(400, { 'Content-Type': 'text/html' });
						res.end(errorHtml);
						return;
					}
				}

				// Default 404 response
				res.writeHead(404, { 'Content-Type': 'text/plain' });
				res.end('Not Found');
			});

			server.listen(port, address, () => {
				this._server = server;
				this.logService.info('OAuth HTTP server started on:', `${address}:${port}`);
				resolve();
			});

			server.on('error', (error: any) => {
				reject(error);
			});
		});
	}

	private buildSuccessHtml(): string {
		const iconMarkup = this.getInlineImageMarkup(
			SUCCESS_PAGE_CHECKMARK_IMAGE_PATH,
			'Authentication successful',
			'&#10003;',
			'#1FAA59'
		);

		return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Signed in to Erdos</title>
<style>
	body {
		font-family: ${NOTIFICATION_PAGE_FONT_FAMILY};
		text-align: center;
		margin: 60px 32px;
		color: #1f2933;
	}
	h2 {
		font-size: 28px;
		font-weight: 600;
		margin: 16px 0 8px;
	}
	p {
		color: #6b7280;
		font-size: 16px;
		margin: 0;
	}
	.icon-wrapper {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		margin-bottom: 20px;
	}
</style>
</head>
<body>
	<div class="icon-wrapper">${iconMarkup}</div>
	<h2>Signed in to Erdos</h2>
	<p>You may now close this page.</p>
	<script>setTimeout(function(){ window.close(); }, 3000);</script>
</body>
</html>`;
	}

	private buildErrorHtml(): string {
		const iconMarkup = this.getInlineImageMarkup(
			ERROR_PAGE_ICON_IMAGE_PATH,
			'Authentication failed',
			'&#10007;',
			'#d13438'
		);

		return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Authentication Failed</title>
<style>
	body {
		font-family: ${NOTIFICATION_PAGE_FONT_FAMILY};
		text-align: center;
		margin: 60px 32px;
		color: #1f2933;
	}
	h2 {
		font-size: 28px;
		font-weight: 600;
		margin: 16px 0 8px;
	}
	p {
		color: #6b7280;
		font-size: 16px;
		margin: 0;
	}
	.icon-wrapper {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		margin-bottom: 20px;
	}
</style>
</head>
<body>
	<div class="icon-wrapper">${iconMarkup}</div>
	<h2>Authentication Failed</h2>
	<p>We couldn't retrieve an API key. Close this tab and try again.</p>
</body>
</html>`;
	}

	private getInlineImageMarkup(filePath: string, altText: string, fallbackGlyph: string, fallbackColor: string): string {
		if (filePath && existsSync(filePath)) {
			try {
				const fileBuffer = readFileSync(filePath);
				const extension = extname(filePath).toLowerCase();
				let mimeType: string | undefined;
				switch (extension) {
					case '.svg':
						mimeType = 'image/svg+xml';
						break;
					case '.png':
						mimeType = 'image/png';
						break;
					case '.jpg':
					case '.jpeg':
						mimeType = 'image/jpeg';
						break;
					case '.gif':
						mimeType = 'image/gif';
						break;
				}

				if (mimeType) {
					const base64 = fileBuffer.toString('base64');
					const dataUrl = `data:${mimeType};base64,${base64}`;
					return `<img src="${dataUrl}" alt="${altText}" style="height:72px;width:auto;" />`;
				}

				this.logService.warn(`Unsupported icon format for OAuth notification page: ${extension}. Falling back to glyph.`);
			} catch (error) {
				this.logService.warn('Failed to load OAuth notification icon. Falling back to glyph.', error);
			}
		}

		return `<div style="color:${fallbackColor};font-size:64px;">${fallbackGlyph}</div>`;
	}

	   // Detect backend environment for OAuth redirect
	private async detectBackendEnvironment(): Promise<string> {
		// Check if localhost:8080 backend is available
		this.logService.info('OAuth: Starting backend environment detection...');
		this.logService.info('OAuth: Checking localhost backend at: http://localhost:8080/actuator/health');
		
		try {
			const startTime = Date.now();
			const response = await fetch('http://localhost:8080/actuator/health', {
				method: 'GET',
				signal: AbortSignal.timeout(3000) // 3 second timeout
			});
			const endTime = Date.now();
			
			this.logService.info('OAuth: Health check response received in', endTime - startTime, 'ms');
			this.logService.info('OAuth: Response status:', response.status);
			this.logService.info('OAuth: Response ok:', response.ok);
			
			if (response.status === 200) {
				try {
					const responseText = await response.text();
					this.logService.info('OAuth: Response body:', responseText);
				} catch (textError) {
					this.logService.warn('OAuth: Failed to read response body:', textError);
				}
				this.logService.info('OAuth: Local RAO backend detected at localhost:8080');
				return 'local';
			} else {
				this.logService.warn('OAuth: Local backend responded with status:', response.status);
			}
		} catch (error) {
			// Local backend not available, use production
			this.logService.warn('OAuth: Local RAO backend not available:', error);
			this.logService.info('OAuth: Error details:', {
				name: error instanceof Error ? error.name : 'Unknown',
				message: error instanceof Error ? error.message : String(error),
				isTimeoutError: error instanceof Error && error.name === 'TimeoutError',
				isAbortError: error instanceof Error && error.name === 'AbortError',
				isNetworkError: error instanceof Error && error.message.includes('Failed to fetch'),
				isCORSError: error instanceof Error && error.message.includes('CORS'),
				isTypeError: error instanceof TypeError
			});
		}
		
		// Default to production environment
		this.logService.info('OAuth: Using production environment');
		return 'production';
	}

	private stopOAuthServer(): void {
		if (this._server) {
			try {
				this._server.close();
				this.logService.info('OAuth HTTP server stopped');
			} catch (error) {
				this.logService.error('Error stopping OAuth server:', error);
			}
			this._server = null;
		}
	}

	async stopOAuthFlow(): Promise<void> {
		this.logService.info('Stopping OAuth flow');
		this.stopOAuthServer();
	}

	override dispose(): void {
		this.stopOAuthFlow();
		super.dispose();
	}
}
