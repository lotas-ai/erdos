/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ISessionManagement } from '../common/sessionManagement.js';
import { ISessionManager } from '../../../services/languageRuntime/common/sessionManager.js';
import { LanguageRuntimeSessionMode } from '../../../services/languageRuntime/common/languageRuntimeTypes.js';

export class SessionManagement extends Disposable implements ISessionManagement {
	readonly _serviceBrand: undefined;

	constructor(
		@ISessionManager private readonly sessionManager: ISessionManager
	) {
		super();
	}

	/**
	 * Ensure R session is available
	 */
	async ensureRSession(): Promise<void> {
		const existingRSession = this.sessionManager.getConsoleSessionForLanguage('r');
		if (existingRSession) {
			return;
		}

		const rRuntime = this.sessionManager.getPreferredRuntime('r');
		if (!rRuntime) {
			throw new Error('No R interpreter is available. Please start an R console session first.');
		}

		await this.sessionManager.startSession(
			rRuntime,
			LanguageRuntimeSessionMode.Console,
			'R Console'
		);

		await new Promise(resolve => setTimeout(resolve, 1000));
	}

	/**
	 * Ensure Python session is available
	 */
	async ensurePythonSession(): Promise<void> {
		const existingPythonSession = this.sessionManager.getConsoleSessionForLanguage('python');
		if (existingPythonSession) {
			return;
		}

		const pythonRuntime = this.sessionManager.getPreferredRuntime('python');
		if (!pythonRuntime) {
			throw new Error('No Python interpreter is available. Please start a Python console session first.');
		}

		await this.sessionManager.startSession(
			pythonRuntime,
			LanguageRuntimeSessionMode.Console,
			'Python Console'
		);

		await new Promise(resolve => setTimeout(resolve, 1000));
	}
}
