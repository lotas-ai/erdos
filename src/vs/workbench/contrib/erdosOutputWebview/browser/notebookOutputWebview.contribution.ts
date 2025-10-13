/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IErdosNotebookOutputWebviewService } from './notebookOutputWebviewService.js';
import { ErdosNotebookOutputWebviewService } from './notebookOutputWebviewServiceImpl.js';

registerSingleton(
	IErdosNotebookOutputWebviewService,
	ErdosNotebookOutputWebviewService,
	InstantiationType.Delayed
);

