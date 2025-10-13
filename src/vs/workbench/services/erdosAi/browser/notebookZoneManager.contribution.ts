/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { INotebookZoneManager } from '../common/notebookZoneManager.js';
import { NotebookZoneManager } from './notebookZoneManager.js';

registerSingleton(INotebookZoneManager, NotebookZoneManager, InstantiationType.Delayed);
