/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { QUARTO_CONSOLE_MIRRORING_KEY, QUARTO_PLOT_MIRRORING_KEY } from './notebookConfig.js';

const QUARTO_ACTIONS_CATEGORY = localize2('quartoActions.category', "Quarto");

class ToggleQuartoConsoleMirroringAction extends Action2 {
	static readonly ID = 'quarto.toggleConsoleMirroring';

	constructor() {
		super({
			id: ToggleQuartoConsoleMirroringAction.ID,
			title: localize2('quarto.toggleConsoleMirroring', 'Console Mirroring'),
			icon: Codicon.link,
			category: QUARTO_ACTIONS_CATEGORY,
			f1: true,
			toggled: {
				condition: ContextKeyExpr.equals(`config.${QUARTO_CONSOLE_MIRRORING_KEY}`, true),
				title: localize('quarto.consoleMirroringEnabled', 'Console Mirroring'),
			},
			menu: [
				{
					id: MenuId.EditorTitle,
					group: '1_quarto',
					order: 10,
					when: ContextKeyExpr.or(
						ContextKeyExpr.equals('editorLangId', 'quarto'),
						ContextKeyExpr.equals('editorLangId', 'markdown')
					)
				}
			]
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const configurationService = accessor.get(IConfigurationService);
		const currentValue = configurationService.getValue<boolean>(QUARTO_CONSOLE_MIRRORING_KEY) ?? true;
		const newValue = !currentValue;
		await configurationService.updateValue(QUARTO_CONSOLE_MIRRORING_KEY, newValue);
	}
}

class ToggleQuartoPlotMirroringAction extends Action2 {
	static readonly ID = 'quarto.togglePlotMirroring';

	constructor() {
		super({
			id: ToggleQuartoPlotMirroringAction.ID,
			title: localize2('quarto.togglePlotMirroring', 'Plot Mirroring'),
			icon: Codicon.graph,
			category: QUARTO_ACTIONS_CATEGORY,
			f1: true,
			toggled: {
				condition: ContextKeyExpr.equals(`config.${QUARTO_PLOT_MIRRORING_KEY}`, true),
				title: localize('quarto.plotMirroringEnabled', 'Plot Mirroring'),
			},
			menu: [
				{
					id: MenuId.EditorTitle,
					group: '1_quarto',
					order: 11,
					when: ContextKeyExpr.or(
						ContextKeyExpr.equals('editorLangId', 'quarto'),
						ContextKeyExpr.equals('editorLangId', 'markdown')
					)
				}
			]
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const configurationService = accessor.get(IConfigurationService);
		const currentValue = configurationService.getValue<boolean>(QUARTO_PLOT_MIRRORING_KEY) ?? true;
		const newValue = !currentValue;
		await configurationService.updateValue(QUARTO_PLOT_MIRRORING_KEY, newValue);
	}
}

registerAction2(ToggleQuartoConsoleMirroringAction);
registerAction2(ToggleQuartoPlotMirroringAction);


