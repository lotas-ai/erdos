/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isMacintosh } from '../../../../../base/common/platform.js';
import { Emitter } from '../../../../../base/common/event.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IOverlayWebview } from '../../../webview/browser/webview.js';

export class WebviewMessageHandler {
	constructor(
		private readonly _clipboardService: IClipboardService,
		private readonly _commandService: ICommandService,
		private readonly _onChangeTitleEmitter: Emitter<string>,
		private readonly _onNavigateEmitter: Emitter<string>,
		private readonly _onNavigateBackwardEmitter: Emitter<void>,
		private readonly _onNavigateForwardEmitter: Emitter<void>,
		private readonly _getWebview: () => IOverlayWebview | undefined
	) { }

	async handleMessage(message: any): Promise<void> {
		switch (message.id) {
			case 'erdos-help-complete':
				if (message.title) {
					this._onChangeTitleEmitter.fire(message.title);
				}
				break;

			case 'erdos-help-navigate':
				this._onNavigateEmitter.fire(message.url);
				break;

			case 'erdos-help-navigate-backward':
				this._onNavigateBackwardEmitter.fire();
				break;

			case 'erdos-help-navigate-forward':
				this._onNavigateForwardEmitter.fire();
				break;

			case 'erdos-help-keydown': {
				// Check if Cmd+C (Mac) or Ctrl+C (other platforms)
				const cmdOrCtrlKey = isMacintosh ? message.metaKey : message.ctrlKey;
				if (cmdOrCtrlKey && message.code === 'KeyC') {
					// Send copy-selection command back to webview
					this._getWebview()?.postMessage({
						id: 'erdos-help-copy-selection'
					});
				}
				break;
			}

			case 'erdos-help-copy-selection':
				if (message.selection) {
					await this._clipboardService.writeText(message.selection);
				}
				break;

			case 'erdos-help-execute-command':
				if (message.command) {
					await this._commandService.executeCommand(message.command);
				}
				break;
		}
	}
}


