/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IConsoleService } from '../../../services/erdosConsole/common/consoleService.js';
import { ConsoleServiceImpl } from '../../../services/erdosConsole/browser/consoleServiceImpl.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IViewsRegistry, Extensions as ViewExtensions, IViewContainersRegistry, Extensions as ViewContainerExtensions, ViewContainerLocation } from '../../../common/views.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { ConsoleViewPane } from './consoleViewPane.js';
import { registerConsoleActions } from './consoleActions.js';
import './media/erdosConsole.css';
import './media/consoleTabList.css';
import { Codicon } from '../../../../base/common/codicons.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { localize, localize2 } from '../../../../nls.js';

const consoleIcon = registerIcon('console-view-icon', Codicon.terminal, localize('consoleViewIcon', 'View icon of the console view.'));

registerSingleton(IConsoleService, ConsoleServiceImpl, InstantiationType.Eager);

const VIEW_CONTAINER = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer({
	id: 'workbench.panel.erdosConsole',
	title: localize2('console', 'Console'),
	icon: consoleIcon,
	order: 3,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, ['workbench.panel.erdosConsole', { mergeViewWithContainerWhenSingleView: true }])
}, ViewContainerLocation.Panel);

Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([{
	id: 'workbench.panel.erdosConsole',
	name: localize2('console', 'Console'),
	containerIcon: consoleIcon,
	ctorDescriptor: new SyncDescriptor(ConsoleViewPane),
	canToggleVisibility: false,
	workspace: true,
	canMoveView: true
}], VIEW_CONTAINER);

registerConsoleActions();

