/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IEditor } from '../../../../editor/common/editorCommon.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { Action2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IErdosHelpService } from './services/helpService.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { ISessionManager } from '../../../services/languageRuntime/common/sessionManager.js';

export class SearchDocumentation extends Action2 {
	constructor() {
		super({
			id: 'erdos.help.lookupHelpTopic',
			title: {
				value: localize('erdos.help.lookupHelpTopic', 'Look Up Help Topic'),
				original: 'Look Up Help Topic'
			},
			category: Categories.Help,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorAccess = accessor.get(IEditorService);
		const documentationAccess: IErdosHelpService = accessor.get(IErdosHelpService);
		const sessionManager = accessor.get(ISessionManager);
		const inputDialog = accessor.get(IQuickInputService);
		const notifier = accessor.get(INotificationService);
		const languageInfo = accessor.get(ILanguageService);

		let detectedLanguageId = undefined;
		const currentEditor = editorAccess.activeTextEditorControl as IEditor;
		if (currentEditor) {
			const documentModel = currentEditor.getModel() as ITextModel;
			detectedLanguageId = documentModel.getLanguageId();
		}

		if (!detectedLanguageId) {
			const primarySession = sessionManager.foregroundSession;
			if (primarySession) {
				detectedLanguageId = primarySession.runtimeMetadata.languageId;
			} else {
				const alertMessage = localize('erdos.help.noInterpreters', "There are no interpreters running. Start an interpreter to look up help topics.");
				notifier.info(alertMessage);
				return;
			}
		}

		const runningSessions = sessionManager.activeSessions;
		let sessionExists = false;
		for (const session of runningSessions) {
			if (session.runtimeMetadata.languageId === detectedLanguageId) {
				sessionExists = true;
				break;
			}
		}
		if (!sessionExists) {
			const alertMessage = localize('erdos.help.noLanguage', "Open a file for the language you want to look up help topics for, or start an interpreter for that language.");
			notifier.info(alertMessage);
			return;
		}

		const languageDisplayName = languageInfo.getLanguageName(detectedLanguageId);

		const userInput = await inputDialog.input({
			prompt: localize('erdos.help.enterHelpTopic', "Enter {0} help topic", languageDisplayName),
			value: '',
			ignoreFocusLost: true,
			validateInput: async (value: string) => {
				if (value.length === 0) {
					return localize('erdos.help.noTopic', "No help topic provided.");
				}
				return undefined;
			}
		});

		if (userInput) {
			try {
				const wasLocated = await documentationAccess.showHelpTopic(detectedLanguageId, userInput);
				if (!wasLocated) {
					const alertMessage = localize('erdos.help.helpTopicUnavailable',
						"No help found for '{0}'.", userInput);
					notifier.info(alertMessage);
					return;
				}
			} catch (err: any) {
				const alertMessage = localize('erdos.help.errorLookingUpTopic',
					"Error finding help on '{0}': {1} ({2}).", userInput, err.message, err.code);
				notifier.warn(alertMessage);
				return;
			}
		}
	}
}
