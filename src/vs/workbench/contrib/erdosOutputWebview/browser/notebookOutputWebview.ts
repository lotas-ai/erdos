/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IOverlayWebview } from '../../webview/browser/webview.js';
import { IScopedRendererMessaging } from '../../notebook/common/notebookRendererMessagingService.js';
import { INotebookOutputWebview } from './notebookOutputWebviewService.js';

export class NotebookOutputWebview extends Disposable implements INotebookOutputWebview {

	private readonly _onDidInitialize = this._register(new Emitter<void>());
	private readonly _onDidRender = this._register(new Emitter<void>());

	readonly id: string;
	readonly sessionId: string;
	readonly webview: IOverlayWebview;

	onDidInitialize = this._onDidInitialize.event;
	onDidRender = this._onDidRender.event;

	constructor(
		id: string,
		sessionId: string,
		webview: IOverlayWebview,
		rendererMessaging?: IScopedRendererMessaging
	) {
		super();
		this._register(webview);

		this.id = id;
		this.sessionId = sessionId;
		this.webview = webview;

		if (rendererMessaging) {
			this._register(rendererMessaging);
			rendererMessaging.receiveMessageHandler = async (rendererId, message) => {
				webview.postMessage({
					__vscode_notebook_message: true,
					type: 'customRendererMessage',
					rendererId,
					message,
				});
				return true;
			};
		}

		this._register(webview.onMessage(e => {
			const data = e.message;
			if (!data?.__vscode_notebook_message) {
				return;
			}

			switch (data.type) {
				case 'initialized':
					this._onDidInitialize.fire();
					break;
				case 'customRendererMessage':
					rendererMessaging?.postMessage(data.rendererId, data.message);
					break;
				case 'erdosRenderComplete':
					this._onDidRender.fire();
					break;
			}
		}));
	}
}

