/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './variablesView.css';

import { ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IViewPaneOptions } from '../../../browser/parts/views/viewPane.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IErdosVariablesService, IVariable, VariableKind } from '../common/variablesTypes.js';
import { WorkbenchAsyncDataTree } from '../../../../platform/list/browser/listService.js';
import { IAsyncDataSource } from '../../../../base/browser/ui/tree/tree.js';
import { IListVirtualDelegate } from '../../../../base/browser/ui/list/list.js';
import { ITreeRenderer, ITreeNode } from '../../../../base/browser/ui/tree/tree.js';
import { FuzzyScore } from '../../../../base/common/filters.js';
import { IIdentityProvider } from '../../../../base/browser/ui/list/list.js';
import { IListAccessibilityProvider } from '../../../../base/browser/ui/list/listWidget.js';
import { localize } from '../../../../nls.js';
import { getRuntimeIconBase64 } from '../../../contrib/erdosHelp/browser/runtimeIcons.js';

// Tree element types
interface SessionGroup {
	type: 'session';
	sessionId: string;
}

interface VariableGroup {
	type: 'group';
	sessionId: string;
	id: string; // 'data', 'values', 'functions', 'classes'
	title: string;
	variables: IVariable[];
}

interface VariableItem {
	type: 'variable';
	sessionId: string;
	variable: IVariable;
	path: string[]; // Path from root
}

interface VariableChildren {
	type: 'children';
	sessionId: string;
	parentPath: string[];
	children: IVariable[];
}

type VariablesTreeElement = SessionGroup | VariableGroup | VariableItem | VariableChildren;

// Template data interfaces
interface ISessionGroupTemplateData {
	readonly container: HTMLElement;
	readonly icon: HTMLElement;
	readonly label: HTMLElement;
}

interface IVariableGroupTemplateData {
	readonly container: HTMLElement;
	readonly label: HTMLElement;
	readonly badge: HTMLElement;
}

interface IVariableItemTemplateData {
	readonly container: HTMLElement;
	readonly icon: HTMLElement;
	readonly name: HTMLElement;
	readonly value: HTMLElement;
	readonly type: HTMLElement;
	readonly deleteBtn: HTMLElement;
}

interface IVariableChildrenTemplateData {
	readonly container: HTMLElement;
	readonly childrenContainer: HTMLElement;
}

// Virtual delegate
class VariablesVirtualDelegate implements IListVirtualDelegate<{ element: VariablesTreeElement }> {
	getHeight(element: { element: VariablesTreeElement }): number {
		return 22; // All items same height for now
	}

	getTemplateId(element: { element: VariablesTreeElement }): string {
		return element.element.type;
	}
}

// Session group renderer
class SessionGroupRenderer implements ITreeRenderer<{ element: VariablesTreeElement }, FuzzyScore, ISessionGroupTemplateData> {
	templateId = 'session';

	constructor(
		private readonly variablesService: IErdosVariablesService
	) { }

	renderTemplate(container: HTMLElement): ISessionGroupTemplateData {
		container.classList.add('variables-session-group');

		const icon = document.createElement('img');
		icon.className = 'session-icon';
		container.appendChild(icon);

		const label = document.createElement('div');
		label.className = 'session-label';
		container.appendChild(label);

		return { container, icon, label };
	}

	renderElement(element: ITreeNode<{ element: VariablesTreeElement }, FuzzyScore>, index: number, templateData: ISessionGroupTemplateData): void {
		const session = element.element.element as SessionGroup;
		const displayName = this.variablesService.getSessionDisplayName(session.sessionId);
		templateData.label.textContent = displayName;

		// Get and set the language icon
		const languageId = this.variablesService.getSessionLanguageId(session.sessionId);
		if (languageId) {
			const base64EncodedIconSvg = getRuntimeIconBase64(languageId);
			if (base64EncodedIconSvg) {
				const iconSrc = `data:image/svg+xml;base64,${base64EncodedIconSvg}`;
				(templateData.icon as HTMLImageElement).src = iconSrc;
				templateData.icon.style.display = 'block';
			} else {
				templateData.icon.style.display = 'none';
			}
		} else {
			templateData.icon.style.display = 'none';
		}
	}

	disposeTemplate(templateData: ISessionGroupTemplateData): void {
	}
}

// Variable group renderer
class VariableGroupRenderer implements ITreeRenderer<{ element: VariablesTreeElement }, FuzzyScore, IVariableGroupTemplateData> {
	templateId = 'group';

	renderTemplate(container: HTMLElement): IVariableGroupTemplateData {
		container.classList.add('variables-group');

		const label = document.createElement('div');
		label.className = 'group-label';
		container.appendChild(label);

		const badge = document.createElement('div');
		badge.className = 'group-badge';
		container.appendChild(badge);

		return { container, label, badge };
	}

	renderElement(element: ITreeNode<{ element: VariablesTreeElement }, FuzzyScore>, index: number, templateData: IVariableGroupTemplateData): void {
		const group = element.element.element as VariableGroup;
		templateData.label.textContent = group.title.toUpperCase();
		templateData.badge.textContent = group.variables.length.toString();
	}

	disposeTemplate(templateData: IVariableGroupTemplateData): void {
	}
}

// Variable item renderer
class VariableItemRenderer implements ITreeRenderer<{ element: VariablesTreeElement }, FuzzyScore, IVariableItemTemplateData> {
	templateId = 'variable';

	constructor(
		private readonly variablesService: IErdosVariablesService
	) { }

	renderTemplate(container: HTMLElement): IVariableItemTemplateData {
		container.classList.add('variables-item-row');

		// Left section: icon + name
		const leftSection = document.createElement('div');
		leftSection.className = 'variables-left';

		const icon = document.createElement('div');
		icon.className = 'variables-icon codicon';

		const name = document.createElement('div');
		name.className = 'variables-name';

		leftSection.append(icon, name);

		// Middle section: value
		const value = document.createElement('div');
		value.className = 'variables-value';

		// Right section: type + viewer button
		const rightSection = document.createElement('div');
		rightSection.className = 'variables-right';

		const type = document.createElement('span');
		type.className = 'variables-type';

		const deleteBtn = document.createElement('div');
		deleteBtn.className = 'codicon codicon-trash variables-delete-btn';
		deleteBtn.title = 'Delete variable';

		rightSection.append(type, deleteBtn);

		container.append(leftSection, value, rightSection);

		return { container, icon, name, value, type, deleteBtn };
	}

	renderElement(element: ITreeNode<{ element: VariablesTreeElement }, FuzzyScore>, index: number, templateData: IVariableItemTemplateData): void {
		const item = element.element.element as VariableItem;
		const variable = item.variable;
		

		// Set icon based on kind
		templateData.icon.className = `variables-icon codicon ${this.getIconForKind(variable.kind)}`;

		// Set content
		templateData.name.textContent = variable.display_name;
		templateData.value.textContent = variable.display_value;
		templateData.type.textContent = variable.display_type;

		// Show delete button for top-level variables only
		if (item.path.length === 1) {
			templateData.deleteBtn.style.display = 'block';
			
			// Remove any existing event listeners
			const newDeleteBtn = templateData.deleteBtn.cloneNode(true) as HTMLElement;
			templateData.deleteBtn.parentNode?.replaceChild(newDeleteBtn, templateData.deleteBtn);
			(templateData as any).deleteBtn = newDeleteBtn;
			
			newDeleteBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				e.preventDefault();
				this.variablesService.deleteVariables(item.sessionId, [variable.access_key]);
			});
			
			newDeleteBtn.addEventListener('mousedown', (e) => {
				e.stopPropagation();
			});
		} else {
			templateData.deleteBtn.style.display = 'none';
		}
	}

	disposeTemplate(templateData: IVariableItemTemplateData): void {
	}

	private getIconForKind(kind: VariableKind): string {
		switch (kind) {
			case VariableKind.Table:
				return 'codicon-table';
			case VariableKind.Function:
				return 'codicon-symbol-function';
			case VariableKind.Class:
				return 'codicon-symbol-class';
			case VariableKind.String:
				return 'codicon-symbol-string';
			case VariableKind.Number:
				return 'codicon-symbol-number';
			case VariableKind.Boolean:
				return 'codicon-symbol-boolean';
			case VariableKind.Collection:
				return 'codicon-symbol-array';
			case VariableKind.Map:
				return 'codicon-symbol-object';
			default:
				return 'codicon-symbol-variable';
		}
	}
}

// Variable children renderer (for child lists)
class VariableChildrenRenderer implements ITreeRenderer<{ element: VariablesTreeElement }, FuzzyScore, IVariableChildrenTemplateData> {
	templateId = 'children';

	renderTemplate(container: HTMLElement): IVariableChildrenTemplateData {
		container.classList.add('variables-children');

		const childrenContainer = document.createElement('div');
		childrenContainer.className = 'variables-children-container';
		container.appendChild(childrenContainer);

		return { container, childrenContainer };
	}

	renderElement(element: ITreeNode<{ element: VariablesTreeElement }, FuzzyScore>, index: number, templateData: IVariableChildrenTemplateData): void {
		// This renderer is actually handled by the VariableItemRenderer through recursion
		// We just provide a placeholder
	}

	disposeTemplate(templateData: IVariableChildrenTemplateData): void {
	}
}

// Data source
class VariablesDataSource implements IAsyncDataSource<SessionGroup | null, { element: VariablesTreeElement }> {
	constructor(
		private readonly variablesService: IErdosVariablesService
	) { }

	hasChildren(element: SessionGroup | { element: VariablesTreeElement } | null): boolean {
		if (!element) {
			const sessions = this.variablesService.getSessions();
			return sessions.length > 0;
		}

		if ('element' in element) {
			const el = element.element;
			if (el.type === 'session') {
				return true; // Sessions always have groups
			}
			if (el.type === 'group') {
				const hasChildren = (el as VariableGroup).variables.length > 0;
				return hasChildren;
			}
			if (el.type === 'variable') {
				const item = el as VariableItem;
				const hasChildren = item.variable.has_children;
				return hasChildren;
			}
		}

		return false;
	}

	async getChildren(element: SessionGroup | { element: VariablesTreeElement } | null): Promise<{ element: VariablesTreeElement }[]> {
		
		if (!element) {
			// Root level: return all sessions
			const sessions = this.variablesService.getSessions();
			return sessions.map(sessionId => ({
				element: { type: 'session', sessionId } as SessionGroup
			}));
		}

		if ('element' in element) {
			const el = element.element;

			// Session -> Variable groups
			if (el.type === 'session') {
				const session = el as SessionGroup;
				const variables = this.variablesService.getVariables(session.sessionId);

				// Group by kind
				const dataVars = variables.filter(v => v.kind === VariableKind.Table);
				const funcVars = variables.filter(v => v.kind === VariableKind.Function);
				const classVars = variables.filter(v => v.kind === VariableKind.Class);
				const valueVars = variables.filter(v =>
					v.kind !== VariableKind.Table &&
					v.kind !== VariableKind.Function &&
					v.kind !== VariableKind.Class
				);
				

				const groups: VariableGroup[] = [];
				if (dataVars.length) {
					groups.push({
						type: 'group',
						sessionId: session.sessionId,
						id: 'data',
						title: 'Data',
						variables: dataVars
					});
				}
				if (valueVars.length) {
					groups.push({
						type: 'group',
						sessionId: session.sessionId,
						id: 'values',
						title: 'Values',
						variables: valueVars
					});
				}
				if (funcVars.length) {
					groups.push({
						type: 'group',
						sessionId: session.sessionId,
						id: 'functions',
						title: 'Functions',
						variables: funcVars
					});
				}
				if (classVars.length) {
					groups.push({
						type: 'group',
						sessionId: session.sessionId,
						id: 'classes',
						title: 'Classes',
						variables: classVars
					});
				}

				return groups.map(g => ({ element: g }));
			}

			// Variable group -> Variables
			if (el.type === 'group') {
				const group = el as VariableGroup;
				const result = group.variables.map(v => ({
					element: {
						type: 'variable',
						sessionId: group.sessionId,
						variable: v,
						path: [v.access_key]
					} as VariableItem
				}));
				return result;
			}

			// Variable -> Children
			if (el.type === 'variable') {
				const item = el as VariableItem;
				
				if (item.variable.has_children) {
					
					try {
						const children = await this.variablesService.inspectVariable(
							item.sessionId,
							item.path
						);
						
						const childElements = children.map(child => ({
							element: {
								type: 'variable',
								sessionId: item.sessionId,
								variable: child,
								path: [...item.path, child.access_key]
							} as VariableItem
						}));
						
						return childElements;
					} catch (error) {
						console.error('[VariablesView] getChildren: Error inspecting variable:', error);
						return [];
					}
				} else {
					return [];
				}
			}
		}

		return [];
	}
}

// Identity provider
class VariablesIdentityProvider implements IIdentityProvider<{ element: VariablesTreeElement }> {
	getId(element: { element: VariablesTreeElement }): string {
		const el = element.element;
		if (el.type === 'session') {
			return `session-${el.sessionId}`;
		}
		if (el.type === 'group') {
			return `${el.sessionId}-group-${el.id}`;
		}
		if (el.type === 'variable') {
			return `${el.sessionId}-var-${el.path.join('.')}`;
		}
		if (el.type === 'children') {
			return `${el.sessionId}-children-${el.parentPath.join('.')}`;
		}
		return 'unknown';
	}
}

// Accessibility provider
class VariablesAccessibilityProvider implements IListAccessibilityProvider<{ element: VariablesTreeElement }> {
	getAriaLabel(element: { element: VariablesTreeElement }): string {
		const el = element.element;
		if (el.type === 'session') {
			return localize('variablesSessionAriaLabel', 'Session {0}', el.sessionId);
		}
		if (el.type === 'group') {
			return localize('variablesGroupAriaLabel', '{0}, {1} variables', el.title, el.variables.length);
		}
		if (el.type === 'variable') {
			return localize('variableItemAriaLabel', '{0}: {1}', el.variable.display_name, el.variable.display_value);
		}
		return '';
	}

	getWidgetAriaLabel(): string {
		return localize('variables', 'Variables');
	}
}

export class VariablesView extends ViewPane {
	public static readonly ID = 'workbench.view.erdosVariables';

	private _tree?: WorkbenchAsyncDataTree<SessionGroup | null, { element: VariablesTreeElement }, FuzzyScore>;
	private _treeContainer?: HTMLElement;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService protected override readonly instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IErdosVariablesService private readonly _variablesService: IErdosVariablesService
	) {
		super(
			options,
			keybindingService,
			contextMenuService,
			configurationService,
			contextKeyService,
			viewDescriptorService,
			instantiationService,
			openerService,
			themeService,
			hoverService
		);
		

		// Listen for variable changes
		this._register(this._variablesService.onDidChangeVariables((sessionId) => {
			this.refresh();
		}));

		// Listen for session registration
		this._register(this._variablesService.onDidRegisterSession((sessionId) => {
			this.refresh();
		}));

		// Listen for session unregistration
		this._register(this._variablesService.onDidUnregisterSession((sessionId) => {
			this.refresh();
		}));
	}

	protected override renderBody(container: HTMLElement): void {
		this._treeContainer = container;
		this._createTree();
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		if (this._tree) {
			this._tree.layout(height, width);
		}
	}

	override dispose(): void {
		this._tree?.dispose();
		super.dispose();
	}

	private _createTree(): void {
		if (!this._treeContainer) {
			return;
		}

		const delegate = new VariablesVirtualDelegate();
		const sessionRenderer = new SessionGroupRenderer(this._variablesService);
		const groupRenderer = new VariableGroupRenderer();
		const itemRenderer = new VariableItemRenderer(this._variablesService);
		const childrenRenderer = new VariableChildrenRenderer();
		const dataSource = new VariablesDataSource(this._variablesService);
		const identityProvider = new VariablesIdentityProvider();
		const accessibilityProvider = new VariablesAccessibilityProvider();

		this._tree = this.instantiationService.createInstance(
			WorkbenchAsyncDataTree,
			'Variables',
			this._treeContainer,
			delegate,
			[sessionRenderer, groupRenderer, itemRenderer, childrenRenderer],
			dataSource,
			{
				identityProvider,
				accessibilityProvider,
				multipleSelectionSupport: false,
				collapseByDefault: (e: unknown) => {
					// Collapse variables with children by default, but expand sessions and groups
					if (typeof e === 'object' && e !== null && 'element' in e) {
						const element = (e as { element: VariablesTreeElement }).element;
						if (element.type === 'variable') {
							return true; // Start collapsed
						}
					}
					return false; // Sessions and groups start expanded
				},
				openOnSingleClick: false,
				expandOnlyOnTwistieClick: true
			}
		) as WorkbenchAsyncDataTree<SessionGroup | null, { element: VariablesTreeElement }, FuzzyScore>;

		this._register(this._tree);
		
		// Add debugging for tree events
		this._register(this._tree.onDidChangeCollapseState(e => {
			
			// The tree wraps elements multiple times:
			// e.node.element = tree internal node (with parent, id, hasChildren, etc.)
			// e.node.element.element = our wrapper { element: VariablesTreeElement }
			// e.node.element.element.element = the actual VariablesTreeElement
			
			const treeNode = e.node.element as any;
			
			if (treeNode && 'element' in treeNode) {
				const wrapper = treeNode.element;
				
				if (wrapper && 'element' in wrapper) {
					const actualElement = wrapper.element;
					
					if (actualElement.type === 'session') {
					} else if (actualElement.type === 'group') {
					} else if (actualElement.type === 'variable') {
					}
				} else {
				}
			}
			
			
			// If expanding (collapsed === false), children should be loaded
			if (!e.node.collapsed) {
			} else {
			}
		}));
		
		this._register(this._tree.onDidOpen(e => {
		}));
		
		this._loadVariables();
	}

	private async _loadVariables(): Promise<void> {
		if (!this._tree) {
			return;
		}

		await this._tree.setInput(null);
		this._tree.layout();
	}

	public refresh(): void {
		if (this._tree) {
			this._tree.rerender();
		}
		this._loadVariables();
	}
}

