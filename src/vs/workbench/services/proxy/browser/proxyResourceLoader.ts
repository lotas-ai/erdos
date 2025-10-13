/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FileAccess } from '../../../../base/common/network.js';

export interface ProxyResources {
	styleDefaults: string;
	styleOverrides: string;
	helpScript: string;
}

function extractElement(html: string, id: string): string {
	const styleMatch = html.match(new RegExp(`<style id="${id}"[^>]*>([\\s\\S]*?)</style>`));
	if (styleMatch) {
		return styleMatch[1].trim();
	}
	const scriptMatch = html.match(new RegExp(`<script id="${id}"[^>]*>([\\s\\S]*?)</script>`));
	if (scriptMatch) {
		return scriptMatch[1].trim();
	}
	return '';
}

export async function loadProxyResources(): Promise<ProxyResources> {
	const helpHtmlUrl = FileAccess.asBrowserUri('vs/workbench/services/proxy/resources/scripts_help.html').toString();
	const response = await fetch(helpHtmlUrl);
	const html = await response.text();

	return {
		styleDefaults: extractElement(html, 'help-style-defaults'),
		styleOverrides: extractElement(html, 'help-style-overrides'),
		helpScript: extractElement(html, 'help-script')
	};
}

