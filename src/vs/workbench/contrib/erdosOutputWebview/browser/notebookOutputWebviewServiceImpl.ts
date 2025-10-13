/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Schemas } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';
import { dirname } from '../../../../base/common/resources.js';
import { IWorkspaceTrustManagementService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { INotebookService } from '../../notebook/common/notebookService.js';
import { INotebookRendererMessagingService } from '../../notebook/common/notebookRendererMessagingService.js';
import { IWebviewService } from '../../webview/browser/webview.js';
import { asWebviewUri } from '../../webview/common/webview.js';
import { preloadsScriptStr } from '../../notebook/browser/view/renderers/webviewPreloads.js';
import { IErdosRenderMessage, RendererMetadata, StaticPreloadMetadata } from '../../notebook/browser/view/renderers/webviewMessages.js';
import { INotebookRendererInfo, RENDERER_NOT_AVAILABLE, RendererMessagingSpec } from '../../notebook/common/notebookCommon.js';
import { ILanguageRuntimeSession } from '../../../services/languageRuntime/common/languageRuntimeTypes.js';
import { ILanguageRuntimeMessageOutput, ILanguageRuntimeMessageWebOutput } from '../../../services/languageRuntime/common/languageRuntimeMessageTypes.js';
import { INotebookOutputWebview, IErdosNotebookOutputWebviewService } from './notebookOutputWebviewService.js';
import { NotebookOutputWebview } from './notebookOutputWebview.js';

type MessageRenderInfo = {
	mimeType: string;
	renderer: INotebookRendererInfo;
	output: ILanguageRuntimeMessageWebOutput;
};

export class ErdosNotebookOutputWebviewService implements IErdosNotebookOutputWebviewService {

	readonly _serviceBrand: undefined;

	constructor(
		@IWebviewService private readonly _webviewService: IWebviewService,
		@INotebookService private readonly _notebookService: INotebookService,
		@IWorkspaceTrustManagementService private readonly _workspaceTrustService: IWorkspaceTrustManagementService,
		@INotebookRendererMessagingService private readonly _rendererMessaging: INotebookRendererMessagingService,
		@ILogService private readonly _logService: ILogService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService
	) { }

	async createNotebookOutputWebview(opts: {
		id: string;
		runtime: ILanguageRuntimeSession;
		output: ILanguageRuntimeMessageOutput;
		viewType?: string;
	}): Promise<INotebookOutputWebview | undefined> {
		for (const mimeType of Object.keys(opts.output.data)) {
			if (mimeType === 'text/plain' || mimeType === 'image/png') {
				continue;
			}

			const renderer = this._notebookService.getPreferredRenderer(mimeType);
			if (renderer) {
				return this._createNotebookRenderOutput({
					id: opts.id,
					runtimeId: opts.runtime.sessionId,
					displayMessageInfo: { mimeType, renderer, output: opts.output as unknown as ILanguageRuntimeMessageWebOutput },
					viewType: opts.viewType,
				});
			}
		}

		return undefined;
	}

	async createMultiMessageWebview(opts: {
		runtimeId: string;
		preReqMessages: ILanguageRuntimeMessageWebOutput[];
		displayMessage: ILanguageRuntimeMessageWebOutput;
		viewType?: string;
	}): Promise<INotebookOutputWebview | undefined> {
		const displayInfo = this._findRendererForOutput(opts.displayMessage, opts.viewType);
		if (!displayInfo) {
			this._logService.error('Failed to find renderer for output message with mime types: ' + Object.keys(opts.displayMessage.data).join(', '));
			return undefined;
		}

		return this._createNotebookRenderOutput({
			id: opts.displayMessage.id,
			runtimeId: opts.runtimeId,
			displayMessageInfo: displayInfo,
			preReqMessagesInfo: this._findRenderersForOutputs(opts.preReqMessages, opts.viewType),
			viewType: opts.viewType,
		});
	}

	private _findRenderersForOutputs(outputs: ILanguageRuntimeMessageWebOutput[], viewType?: string): MessageRenderInfo[] {
		return outputs
			.map(output => {
				const info = this._findRendererForOutput(output, viewType);
				if (!info) {
					this._logService.warn('Failed to find renderer for output with mime types: ' + Object.keys(output.data).join(', ') + '. Output will be ignored.');
				}
				return info;
			})
			.filter((info): info is MessageRenderInfo => Boolean(info));
	}

	private _findRendererForOutput(output: ILanguageRuntimeMessageWebOutput, viewType?: string): MessageRenderInfo | undefined {
		const mimeTypes = this._notebookService.getMimeTypeInfo(viewType, undefined, Object.keys(output.data));
		const picked = mimeTypes.find(m => m.rendererId !== RENDERER_NOT_AVAILABLE && m.isTrusted);
		if (!picked) {
			return undefined;
		}

		const renderer = this._notebookService.getRendererInfo(picked.rendererId);
		return renderer ? { mimeType: picked.mimeType, renderer, output } : undefined;
	}

	private async _createNotebookRenderOutput(opts: {
		id: string;
		runtimeId: string;
		displayMessageInfo: MessageRenderInfo;
		preReqMessagesInfo?: MessageRenderInfo[];
		viewType?: string;
	}): Promise<INotebookOutputWebview> {
		const messagesInfo = [...opts.preReqMessagesInfo ?? [], opts.displayMessageInfo];

		const rendererData = this._notebookService.getRenderers().map((r): RendererMetadata => ({
			id: r.id,
			entrypoint: {
				extends: r.entrypoint.extends,
				path: this._asWebviewUri(r.entrypoint.path, r.extensionLocation).toString()
			},
			mimeTypes: r.mimeTypes,
			messaging: r.messaging !== RendererMessagingSpec.Never,
			isBuiltin: r.isBuiltin
		}));

		const staticPreloads: StaticPreloadMetadata[] = opts.viewType
			? Array.from(this._notebookService.getStaticPreloads(opts.viewType), p => ({
				entrypoint: this._asWebviewUri(p.entrypoint, p.extensionLocation).toString()
			}))
			: [];

		const resourceRoots = this._getResourceRoots(messagesInfo.map(info => info.output), opts.viewType);

		const preloads = preloadsScriptStr(
			{ outputNodeLeftPadding: 0, outputNodePadding: 0, tokenizationCss: '' },
			{ dragAndDropEnabled: false },
			{ lineLimit: 1000, outputScrolling: true, outputWordWrap: false, linkifyFilePaths: false, minimalError: false },
			rendererData,
			staticPreloads,
			this._workspaceTrustService.isWorkspaceTrusted(),
			opts.id
		);

		const webview = this._webviewService.createWebviewOverlay({
			origin: DOM.getActiveWindow().origin,
			contentOptions: {
				allowScripts: true,
				allowMultipleAPIAcquire: true,
				localResourceRoots: resourceRoots,
			},
			extension: {
				id: opts.displayMessageInfo.renderer.extensionId,
			},
			options: {
				retainContextWhenHidden: true,
			},
			title: '',
		});

		webview.setHtml(`
<!DOCTYPE html>
<html>
<head>
	<style nonce="${opts.id}">
		#_defaultColorPalatte {
			color: var(--vscode-editor-findMatchHighlightBackground);
			background-color: var(--vscode-editor-findMatchBackground);
		}
		.vega-actions a:not([download]) { display: none; }
		div:has(> .bk-notebook-logo) { display: none; }
	</style>
	<script>
		window.prompt = (message, _default) => _default ?? 'Untitled';
		(function() {
			const vscode = acquireVsCodeApi();
			const sendSize = () => {
				vscode.postMessage({
					type: 'webviewMetrics',
					bodyScrollHeight: document.documentElement.scrollHeight,
					bodyScrollWidth: document.documentElement.scrollWidth
				});
			};
			new ResizeObserver(sendSize).observe(document.documentElement);
			window.onload = sendSize;
		})();
	</script>
</head>
<body>
	<div id='container'></div>
	<div id="_defaultColorPalatte"></div>
	<script type="module">${preloads}</script>
</body>
</html>
		`);

		const notebookWebview = this._instantiationService.createInstance(
			NotebookOutputWebview,
			opts.id,
			opts.runtimeId,
			webview,
			this._rendererMessaging.getScoped(opts.id)
		);

		notebookWebview.onDidInitialize(() => {
			messagesInfo.forEach((msg, i) => {
				const data = msg.output.data[msg.mimeType];
				const vsbuffer = typeof data === 'string' ? VSBuffer.fromString(data) : VSBuffer.fromString(JSON.stringify(data));
				const message: IErdosRenderMessage = {
					__vscode_notebook_message: true,
					type: 'erdosRender',
					outputId: msg.output.id,
					elementId: `erdos-container-${i}`,
					rendererId: msg.renderer.id,
					mimeType: msg.mimeType,
					metadata: msg.output.metadata,
					valueBytes: new Uint8Array(vsbuffer.buffer).buffer,
				};
				webview.postMessage(message, []);
			});
		});

		return notebookWebview;
	}

	private _asWebviewUri(uri: URI, fromExtension: URI | undefined): URI {
		return asWebviewUri(uri, fromExtension?.scheme === Schemas.vscodeRemote ? { isRemote: true, authority: fromExtension.authority } : undefined);
	}

	private _getResourceRoots(messages: ILanguageRuntimeMessageWebOutput[], viewType?: string): URI[] {
		const roots: URI[] = [];

		for (const renderer of this._notebookService.getRenderers()) {
			roots.push(dirname(renderer.entrypoint.path));
		}

		if (viewType) {
			for (const preload of this._notebookService.getStaticPreloads(viewType)) {
				roots.push(dirname(preload.entrypoint), ...preload.localResourceRoots);
			}
		}

		for (const message of messages) {
			if (message.resource_roots && Array.isArray(message.resource_roots)) {
				for (const root of message.resource_roots) {
					if (typeof root === 'string') {
						roots.push(URI.parse(root));
					}
				}
			}
		}

		return roots;
	}
}

