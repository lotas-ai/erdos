/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../platform/log/common/log.js';
import { IFileService } from '../../platform/files/common/files.js';
import { IModelService } from '../../editor/common/services/model.js';
import { IOpenerService } from '../../platform/opener/common/opener.js';
import { ICommandService } from '../../platform/commands/common/commands.js';
import { ILanguageService } from '../../editor/common/languages/language.js';
import { IContextKeyService } from '../../platform/contextkey/common/contextkey.js';
import { IViewsService } from '../../workbench/services/views/common/viewsService.js';
import { IWorkspaceContextService } from '../../platform/workspace/common/workspace.js';
import { IClipboardService } from '../../platform/clipboard/common/clipboardService.js';
import { IContextMenuService } from '../../platform/contextview/browser/contextView.js';
import { IEditorService } from '../../workbench/services/editor/common/editorService.js';
import { INotificationService } from '../../platform/notification/common/notification.js';
import { IConfigurationService } from '../../platform/configuration/common/configuration.js';
import { IInstantiationService } from '../../platform/instantiation/common/instantiation.js';
import { IErdosPlotsService } from '../../workbench/contrib/erdosPlots/common/erdosPlotsService.js';
import { ISessionManager } from '../../workbench/services/languageRuntime/common/sessionManager.js';
import { ILanguageRuntimeService } from '../../workbench/services/languageRuntime/common/languageRuntimeService.js';
import { IConsoleService } from '../../workbench/services/erdosConsole/common/consoleService.js';
import { IErdosHelpService } from '../../workbench/contrib/erdosHelp/browser/services/helpService.js';
import { ITopicQueryService } from '../../workbench/contrib/erdosHelp/browser/topicQueryService.js';
import { IFunctionParserService } from '../../workbench/services/erdosAiCommands/common/functionParserService.js';
import { IFileResolverService } from '../../workbench/services/erdosAiUtils/common/fileResolverService.js';
import { ISearchService } from '../../workbench/services/search/common/search.js';
import { IContextService } from '../../workbench/services/erdosAiContext/common/contextService.js';
import { IImageAttachmentService } from '../../workbench/services/erdosAiMedia/common/imageAttachmentService.js';
import { IDocumentManager } from '../../workbench/services/erdosAiDocument/common/documentManager.js';
import { IJupytextService } from '../../workbench/services/erdosAiIntegration/common/jupytextService.js';
import { IFileChangeTracker } from '../../workbench/services/erdosAi/common/fileChangeTracker.js';

/**
 * ErdosReactServices class - holds all services needed by React components.
 * This is a module-level singleton that gets initialized once at startup.
 */
export class ErdosReactServices {
	public constructor(
		// Core VSCode services (used in React components)
		@IClipboardService public readonly clipboardService: IClipboardService,
		@ICommandService public readonly commandService: ICommandService,
		@IConfigurationService public readonly configurationService: IConfigurationService,
		@IContextKeyService public readonly contextKeyService: IContextKeyService,
		@IContextMenuService public readonly contextMenuService: IContextMenuService,
		@IEditorService public readonly editorService: IEditorService,
		@IFileService public readonly fileService: IFileService,
		@IInstantiationService public readonly instantiationService: IInstantiationService,
		@ILanguageService public readonly languageService: ILanguageService,
		@ILogService public readonly logService: ILogService,
		@IModelService public readonly modelService: IModelService,
		@INotificationService public readonly notificationService: INotificationService,
		@IOpenerService public readonly openerService: IOpenerService,
		@ISearchService public readonly searchService: ISearchService,
		@IViewsService public readonly viewsService: IViewsService,
		@IWorkspaceContextService public readonly workspaceContextService: IWorkspaceContextService,

		// Erdos-specific services
		@IConsoleService public readonly erdosConsoleService: IConsoleService,
		@IErdosHelpService public readonly erdosHelpService: IErdosHelpService,
		@IErdosPlotsService public readonly erdosPlotsService: IErdosPlotsService,
		@ILanguageRuntimeService public readonly languageRuntimeService: ILanguageRuntimeService,
		@ISessionManager public readonly sessionManager: ISessionManager,
		@ITopicQueryService public readonly topicQueryService: ITopicQueryService,

		// AI-specific services
		@IContextService public readonly contextService: IContextService,
		@IDocumentManager public readonly documentManager: IDocumentManager,
		@IFileChangeTracker public readonly fileChangeTracker: IFileChangeTracker,
		@IFileResolverService public readonly fileResolverService: IFileResolverService,
		@IFunctionParserService public readonly functionParserService: IFunctionParserService,
		@IImageAttachmentService public readonly imageAttachmentService: IImageAttachmentService,
		@IJupytextService public readonly jupytextService: IJupytextService
	) { }
}

/**
 * Module-level singleton that holds the services instance.
 * Initialized once at application startup via initializeErdosReactServices().
 */
export let services: ErdosReactServices;

/**
 * Initialize the Erdos React services singleton.
 * Should be called once during application startup.
 */
export function initializeErdosReactServices(instantiationService: IInstantiationService): void {
	if (!services) {
		services = instantiationService.createInstance(ErdosReactServices);
	}
}