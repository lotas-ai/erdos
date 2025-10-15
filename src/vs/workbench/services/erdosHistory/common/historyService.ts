/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';

export const ICommandHistoryService = createDecorator<ICommandHistoryService>('commandHistoryService');

export interface ICommandHistoryEntry {
	readonly sessionId: string;
	readonly sessionName: string;
	readonly code: string;
	readonly timestamp: number;
}

export interface ICommandHistoryService {
	readonly _serviceBrand: undefined;

	readonly onDidAddEntry: Event<ICommandHistoryEntry>;
	readonly onDidClearHistory: Event<string>;
	readonly onDidRemoveEntry: Event<number>;

	addEntry(sessionId: string, sessionName: string, code: string): void;
	getHistory(sessionId?: string): ICommandHistoryEntry[];
	clearHistory(sessionId?: string): void;
	removeEntry(timestamp: number): void;
}

