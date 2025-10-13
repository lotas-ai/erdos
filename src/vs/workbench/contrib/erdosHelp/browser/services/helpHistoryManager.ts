/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IHelpEntry } from '../topicViewContract.js';

export class HelpHistoryManager {
	private _entries: IHelpEntry[] = [];
	private _currentIndex = -1;
	private readonly MAX_ENTRIES = 10;

	recordEntry(entry: IHelpEntry): void {
		if (this._currentIndex < this._entries.length - 1) {
			const deleted = this._entries.splice(this._currentIndex + 1);
			deleted.forEach(e => e.dispose());
		}

		if (this._entries[this._currentIndex]?.sourceUrl === entry.sourceUrl) {
			return;
		}

		this._entries.push(entry);
		this._currentIndex++;

		if (this._entries.length > this.MAX_ENTRIES) {
			const removed = this._entries.shift()!;
			removed.dispose();
			this._currentIndex--;
		}
	}

	clearSessionEntries(sessionId: string): void {
		const toRemove = this._entries.filter(e => e.sessionId === sessionId);
		this._entries = this._entries.filter(e => e.sessionId !== sessionId);
		toRemove.forEach(e => e.dispose());

		if (this._currentIndex >= this._entries.length) {
			this._currentIndex = this._entries.length - 1;
		}
	}

	moveBackward(): IHelpEntry | undefined {
		if (this._currentIndex > 0) {
			return this._entries[--this._currentIndex];
		}
		return undefined;
	}

	moveForward(): IHelpEntry | undefined {
		if (this._currentIndex < this._entries.length - 1) {
			return this._entries[++this._currentIndex];
		}
		return undefined;
	}

	getActiveEntry(): IHelpEntry | undefined {
		return this._entries[this._currentIndex];
	}

	getAllEntries(): ReadonlyArray<IHelpEntry> {
		return this._entries;
	}

	jumpToIndex(index: number): IHelpEntry | undefined {
		if (index >= 0 && index < this._entries.length) {
			this._currentIndex = index;
			return this._entries[index];
		}
		return undefined;
	}

	removeAll(): void {
		this._entries.forEach(e => e.dispose());
		this._entries = [];
		this._currentIndex = -1;
	}

	hasBackHistory(): boolean {
		return this._currentIndex > 0;
	}

	hasForwardHistory(): boolean {
		return this._currentIndex < this._entries.length - 1;
	}
}





