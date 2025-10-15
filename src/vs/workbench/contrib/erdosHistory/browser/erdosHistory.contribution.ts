/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { ICommandHistoryService } from '../../../services/erdosHistory/common/historyService.js';
import { CommandHistoryServiceImpl } from '../../../services/erdosHistory/common/historyServiceImpl.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IViewsRegistry, Extensions as ViewExtensions, IViewContainersRegistry, Extensions as ViewContainerExtensions, ViewContainerLocation } from '../../../common/views.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { HistoryViewPane } from './historyViewPane.js';
import './media/erdosHistory.css';
import '../../erdosConsole/browser/media/consoleTabList.css';
import { Codicon } from '../../../../base/common/codicons.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { localize, localize2 } from '../../../../nls.js';

const historyIcon = registerIcon('history-view-icon', Codicon.history, localize('historyViewIcon', 'View icon of the history view.'));

registerSingleton(ICommandHistoryService, CommandHistoryServiceImpl, InstantiationType.Eager);

const VIEW_CONTAINER = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer({
	id: 'workbench.panel.erdosHistory',
	title: localize2('history', 'History'),
	icon: historyIcon,
	order: 4,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, ['workbench.panel.erdosHistory', { mergeViewWithContainerWhenSingleView: true }])
}, ViewContainerLocation.Panel, { isDefault: true });

Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([{
	id: 'workbench.panel.erdosHistory',
	name: localize2('history', 'History'),
	containerIcon: historyIcon,
	ctorDescriptor: new SyncDescriptor(HistoryViewPane),
	canToggleVisibility: false,
	workspace: true,
	canMoveView: true
}], VIEW_CONTAINER);

