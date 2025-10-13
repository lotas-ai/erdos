/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { IOverlayWebview } from '../../webview/browser/webview.js';
import { ILanguageRuntimeSession } from '../../../services/languageRuntime/common/languageRuntimeTypes.js';
import { ILanguageRuntimeMessageOutput, ILanguageRuntimeMessageWebOutput } from '../../../services/languageRuntime/common/languageRuntimeMessageTypes.js';

export const IErdosNotebookOutputWebviewService = createDecorator<IErdosNotebookOutputWebviewService>('erdosNotebookOutputWebview');

export interface INotebookOutputWebview extends IDisposable {
	readonly id: string;
	readonly sessionId: string;
	readonly webview: IOverlayWebview;
	readonly onDidRender: Event<void>;
}

export interface IErdosNotebookOutputWebviewService {
	readonly _serviceBrand: undefined;

	createNotebookOutputWebview(opts: {
		id: string;
		runtime: ILanguageRuntimeSession;
		output: ILanguageRuntimeMessageOutput;
		viewType?: string;
	}): Promise<INotebookOutputWebview | undefined>;

	createMultiMessageWebview(opts: {
		runtimeId: string;
		preReqMessages: ILanguageRuntimeMessageWebOutput[];
		displayMessage: ILanguageRuntimeMessageWebOutput;
		viewType?: string;
	}): Promise<INotebookOutputWebview | undefined>;
}

