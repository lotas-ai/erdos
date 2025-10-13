/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILanguageRuntimeSession } from '../../../../services/languageRuntime/common/languageRuntimeTypes.js';
import { RuntimeQueryHandler } from '../../../../services/languageRuntime/common/runtimeQueryHandler.js';

export class HelpClientManager {
	private _handlers = new Map<string, RuntimeQueryHandler>();

	async registerSession(session: ILanguageRuntimeSession): Promise<RuntimeQueryHandler> {
		const sessionId = session.sessionId;

		if (this._handlers.has(sessionId)) {
			this._handlers.get(sessionId)!.dispose();
		}

		// Get or create a help channel via the kernel
		const existingChannels = await session.listClients('help');		
		let channel;
		if (existingChannels.length > 0) {
			channel = existingChannels[existingChannels.length - 1];
		} else {
			channel = await session.createClient('help', {});
		}

		const handler = new RuntimeQueryHandler(session, channel, session.runtimeMetadata.languageId, sessionId);
		this._handlers.set(sessionId, handler);

		return handler;
	}

	unregisterSession(sessionId: string): void {
		const handler = this._handlers.get(sessionId);
		if (handler) {
			handler.dispose();
			this._handlers.delete(sessionId);
		}
	}

	findClientsByLanguage(languageId: string): RuntimeQueryHandler[] {
		const allHandlers = Array.from(this._handlers.values());
		const matchingHandlers = allHandlers.filter(h => h.languageId === languageId);
		return matchingHandlers;
	}

	retrieveAllClients(): RuntimeQueryHandler[] {
		return Array.from(this._handlers.values());
	}

	dispose(): void {
		this._handlers.forEach(h => h.dispose());
		this._handlers.clear();
	}
}


