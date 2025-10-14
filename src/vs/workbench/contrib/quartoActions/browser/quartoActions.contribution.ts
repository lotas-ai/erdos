/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';

const QUARTO_ACTIONS_CATEGORY = localize2('quartoActions.category', "Quarto");

class ToggleQuartoRenderOnSaveAction extends Action2 {
	static readonly ID = 'quarto.toggleRenderOnSave';

	constructor() {
		super({
			id: ToggleQuartoRenderOnSaveAction.ID,
			title: localize2('quarto.toggleRenderOnSave', 'Render on Save'),
			category: QUARTO_ACTIONS_CATEGORY,
			f1: true,
			toggled: {
				condition: ContextKeyExpr.or(
					ContextKeyExpr.and(
						ContextKeyExpr.equals('quarto.editor.type', 'quarto'),
						ContextKeyExpr.equals('quarto.editor.renderOnSave', true)
					)!,
					ContextKeyExpr.and(
						ContextKeyExpr.equals('quarto.editor.type', 'quarto-shiny'),
						ContextKeyExpr.equals('quarto.editor.renderOnSaveShiny', true)
					)!
				)!,
				title: localize('quarto.renderOnSaveEnabled', 'Render on Save Enabled')
			},
			menu: [
				{
					id: MenuId.EditorTitle,
					group: '1_render',
					order: 1,
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
		
		// Determine which setting to toggle based on editor type
		// We'll use the renderOnSave setting for non-shiny documents
		const currentValue = configurationService.getValue<boolean>('quarto.render.renderOnSave') ?? false;
		const newValue = !currentValue;
		await configurationService.updateValue('quarto.render.renderOnSave', newValue);
	}
}

registerAction2(ToggleQuartoRenderOnSaveAction);

