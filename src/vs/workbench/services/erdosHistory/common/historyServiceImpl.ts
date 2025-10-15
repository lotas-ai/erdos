/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICommandHistoryService, ICommandHistoryEntry } from './historyService.js';
import { Emitter, Event } from '../../../../base/common/event.js';

export class CommandHistoryServiceImpl implements ICommandHistoryService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidAddEntry = new Emitter<ICommandHistoryEntry>();
	readonly onDidAddEntry: Event<ICommandHistoryEntry> = this._onDidAddEntry.event;

	private readonly _onDidClearHistory = new Emitter<string>();
	readonly onDidClearHistory: Event<string> = this._onDidClearHistory.event;

	private readonly _onDidRemoveEntry = new Emitter<number>();
	readonly onDidRemoveEntry: Event<number> = this._onDidRemoveEntry.event;

	private readonly _history: ICommandHistoryEntry[] = [];

	addEntry(sessionId: string, sessionName: string, code: string): void {
		const entry: ICommandHistoryEntry = {
			sessionId,
			sessionName,
			code,
			timestamp: Date.now()
		};
		this._history.push(entry);
		this._onDidAddEntry.fire(entry);
	}

	getHistory(sessionId?: string): ICommandHistoryEntry[] {
		if (sessionId) {
			return this._history.filter(entry => entry.sessionId === sessionId);
		}
		return [...this._history];
	}

	clearHistory(sessionId?: string): void {
		if (sessionId) {
			const indicesToRemove: number[] = [];
			for (let i = this._history.length - 1; i >= 0; i--) {
				if (this._history[i].sessionId === sessionId) {
					indicesToRemove.push(i);
				}
			}
			for (const index of indicesToRemove) {
				this._history.splice(index, 1);
			}
			this._onDidClearHistory.fire(sessionId);
		} else {
			this._history.length = 0;
			this._onDidClearHistory.fire('');
		}
	}

	removeEntry(timestamp: number): void {
		const index = this._history.findIndex(entry => entry.timestamp === timestamp);
		if (index !== -1) {
			this._history.splice(index, 1);
			this._onDidRemoveEntry.fire(timestamp);
		}
	}
}

