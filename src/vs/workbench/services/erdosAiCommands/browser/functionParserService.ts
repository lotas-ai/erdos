/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IErdosAiSettingsService } from '../../erdosAiSettings/common/settingsService.js';
import { ISessionManager } from '../../languageRuntime/common/sessionManager.js';
import { RuntimeQueryHandler } from '../../languageRuntime/common/runtimeQueryHandler.js';
import { IFunctionParserService, ParseFunctionsResult } from '../common/functionParserService.js';

export class FunctionParserService extends Disposable implements IFunctionParserService {
	readonly _serviceBrand: undefined;

	constructor(
		@IErdosAiSettingsService private readonly settingsService: IErdosAiSettingsService,
		@ISessionManager private readonly sessionManager: ISessionManager
	) {
		super();
	}

	/**
	 * Parse code to extract function calls using the help comm system
	 */
	public async parseFunctions(code: string, language: string): Promise<ParseFunctionsResult> {
		
		try {
			const sessions = this.sessionManager.activeSessions;
			let targetSession = null;
			
			for (const session of sessions) {
				if (session.runtimeMetadata.languageId === language) {
					targetSession = session;
					break;
				}
			}

			if (!targetSession) {
				return {
					functions: [],
					success: false,
					error: `No active ${language} session found`
				};
			}

			const existingChannels = await targetSession.listClients('help');
			const channel = existingChannels.length > 0 ?
				existingChannels[existingChannels.length - 1] :
				await targetSession.createClient('help', {});

			if (!channel) {
				return {
					functions: [],
					success: false,
					error: `Could not create help channel for ${language} session`
				};
			}

			const handler = new RuntimeQueryHandler(targetSession, channel, targetSession.runtimeMetadata.languageId, targetSession.sessionId);

			try {
				const result = await handler.parseFunctions(code, language);
				return result;
			} finally {
				handler.dispose();
			}

		} catch (error) {
			return {
				functions: [],
				success: false,
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}

	/**
	 * Check if code should be auto-accepted based on function calls and settings
	 */
	public async checkAutoAccept(code: string, language: 'python' | 'r'): Promise<boolean> {
		const autoAcceptConsole = await this.settingsService.getAutoAcceptConsole();
		if (!autoAcceptConsole) {
			return false;
		}

		// Check language filter
		const languageFilter = await this.settingsService.getConsoleLanguageFilter();
		if (languageFilter !== 'both' && languageFilter !== language) {
			return false;
		}

		const mode = await this.settingsService.getConsoleAutoAcceptMode();
		const allowList = await this.settingsService.getConsoleAllowList();
		const denyList = await this.settingsService.getConsoleDenyList();
		
		// Filter lists by language
		const languageAllowList = allowList.filter(item => item.language === language).map(item => item.function);
		const languageDenyList = denyList.filter(item => item.language === language).map(item => item.function);
		
		// Parse the code to get function calls
		const parseResult = await this.parseFunctions(code, language);
		if (!parseResult.success) {
			return false;
		}

		const functions = parseResult.functions;
		if (functions.length === 0) {
			return false;
		}

		let shouldAutoAccept: boolean;
		if (mode === 'allow-list') {
			// All functions must be in allow list
			shouldAutoAccept = functions.every(func => languageAllowList.includes(func));
		} else {
			// No functions should be in deny list
			shouldAutoAccept = !functions.some(func => languageDenyList.includes(func));
		}

		return shouldAutoAccept;
	}

	/**
	 * Extract function calls for display purposes (e.g., for allow-list buttons)
	 */
	public async extractFunctionCallsForDisplay(code: string, language: 'python' | 'r'): Promise<string> {
		const parseResult = await this.parseFunctions(code, language);
		if (!parseResult.success || parseResult.functions.length === 0) {
			return '';
		}

		return parseResult.functions.join(', ');
	}
}