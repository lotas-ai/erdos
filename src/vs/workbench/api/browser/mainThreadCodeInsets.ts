/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getWindow } from '../../../base/browser/dom.js';
import { DisposableStore } from '../../../base/common/lifecycle.js';
import { isEqual } from '../../../base/common/resources.js';
import { URI, UriComponents } from '../../../base/common/uri.js';
import { IActiveCodeEditor, IViewZone } from '../../../editor/browser/editorBrowser.js';
import { ICodeEditorService } from '../../../editor/browser/services/codeEditorService.js';
import { ExtensionIdentifier } from '../../../platform/extensions/common/extensions.js';
import { reviveWebviewContentOptions } from './mainThreadWebviews.js';
import { ExtHostContext, ExtHostEditorInsetsShape, IWebviewContentOptions, MainContext, MainThreadEditorInsetsShape } from '../common/extHost.protocol.js';
import { IWebviewService, IWebviewElement } from '../../contrib/webview/browser/webview.js';
import { extHostNamedCustomer, IExtHostContext } from '../../services/extensions/common/extHostCustomers.js';
import { handleANSIOutput } from '../../contrib/debug/browser/debugANSIHandling.js';
import { LinkDetector } from '../../contrib/debug/browser/linkDetector.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';

// todo@jrieken move these things back into something like contrib/insets
class EditorWebviewZone implements IViewZone {

	readonly domNode: HTMLElement;
	readonly afterLineNumber: number;
	readonly afterColumn: number;
	heightInPx: number;

	private _id?: string;
	private _isCollapsed: boolean = false;
	private _fullHeight: number;
	private _webviewContainer: HTMLElement;
	private _collapseButton: HTMLElement;

	constructor(
		readonly editor: IActiveCodeEditor,
		readonly line: number,
		readonly height: number,
		readonly webview: IWebviewElement,
	) {
		this._fullHeight = height;
		this.afterLineNumber = line;
		this.afterColumn = 1;
		this.heightInPx = height;

		// Create wrapper
		this.domNode = document.createElement('div');
		this.domNode.style.position = 'relative';
		this.domNode.style.zIndex = '10';

		// Create control bar
		const controlBar = document.createElement('div');
		controlBar.style.position = 'absolute';
		controlBar.style.top = '4px';
		controlBar.style.right = '12px';
		controlBar.style.display = 'flex';
		controlBar.style.gap = '4px';
		controlBar.style.zIndex = '100';

		// Collapse button
		this._collapseButton = this.createControlButton('codicon codicon-chevron-up');
		this._collapseButton.onclick = () => this.toggleCollapse();

		// Delete button
		const deleteButton = this.createControlButton('codicon codicon-close');
		deleteButton.onclick = () => this.dispose();

		controlBar.appendChild(this._collapseButton);
		controlBar.appendChild(deleteButton);

		// Create webview container
		this._webviewContainer = document.createElement('div');
		this._webviewContainer.style.width = '100%';
		this._webviewContainer.style.height = '100%';

		this.domNode.appendChild(controlBar);
		this.domNode.appendChild(this._webviewContainer);

		editor.changeViewZones(accessor => {
			this._id = accessor.addZone(this);
		});
		webview.mountTo(this._webviewContainer, getWindow(editor.getDomNode()));
	}

	private createControlButton(iconClass: string): HTMLElement {
		const button = document.createElement('span');
		button.className = iconClass;
		button.style.cursor = 'pointer';
		button.style.color = 'var(--vscode-icon-foreground)';
		button.style.fontSize = '16px';
		button.style.lineHeight = '16px';
		button.style.display = 'inline-block';
		return button;
	}

	private toggleCollapse(): void {
		this._isCollapsed = !this._isCollapsed;
		
		if (this._isCollapsed) {
			this._collapseButton.className = 'codicon codicon-chevron-down';
			this._webviewContainer.style.display = 'none';
			this.updateHeight(20);
		} else {
			this._collapseButton.className = 'codicon codicon-chevron-up';
			this._webviewContainer.style.display = 'block';
			this.updateHeight(this._fullHeight);
		}
	}

	updateHeight(newHeight: number): void {
		if (this._id) {
			this.heightInPx = newHeight;
			if (!this._isCollapsed) {
				this._fullHeight = newHeight;
			}
			this.editor.changeViewZones(accessor => {
				accessor.updateZone(this._id!, { 
					heightInPx: newHeight
				});
			});
		}
	}

	dispose(): void {
		if (this._id) {
			this.editor.changeViewZones(accessor => accessor.removeZone(this._id!));
		}
	}
}

// Native DOM zone - uses handleANSIOutput like console
class EditorNativeZone implements IViewZone {
	readonly domNode: HTMLElement;
	readonly afterLineNumber: number;
	readonly afterColumn: number;
	heightInPx: number;

	private _id?: string;
	private readonly _container: HTMLElement;
	private readonly _contentWrapper: HTMLElement;
	private readonly _linkDetector: LinkDetector;
	private readonly _workspaceContextService: IWorkspaceContextService;
	private _isCollapsed: boolean = false;
	private _fullHeight: number;
	private _collapseButton: HTMLElement;
	private _onDispose?: () => void;

	constructor(
		readonly editor: IActiveCodeEditor,
		afterLineNumber: number,
		heightInPx: number,
		linkDetector: LinkDetector,
		workspaceContextService: IWorkspaceContextService,
		onDispose?: () => void
	) {
		this._onDispose = onDispose;
		this.afterLineNumber = afterLineNumber;
		this.afterColumn = 1;
		this.heightInPx = heightInPx;
		this._fullHeight = heightInPx;
		this._linkDetector = linkDetector;
		this._workspaceContextService = workspaceContextService;

		// Create wrapper container
		this.domNode = document.createElement('div');
		this.domNode.style.position = 'relative';
		this.domNode.style.height = `${heightInPx}px`;
		this.domNode.style.boxSizing = 'border-box';
		this.domNode.style.zIndex = '1000';

		// Create control bar
		const controlBar = document.createElement('div');
		controlBar.style.position = 'absolute';
		controlBar.style.top = '4px';
		controlBar.style.right = '12px';
		controlBar.style.display = 'flex';
		controlBar.style.gap = '4px';
		controlBar.style.zIndex = '100';

		// Collapse button
		this._collapseButton = this.createControlButton('codicon codicon-chevron-up');
		this._collapseButton.onclick = () => this.toggleCollapse();

		// Delete button
		const deleteButton = this.createControlButton('codicon codicon-close');
		deleteButton.onclick = () => this.dispose();

		controlBar.appendChild(this._collapseButton);
		controlBar.appendChild(deleteButton);

		// Create content wrapper with console-like styling
		this._contentWrapper = document.createElement('div');
		this._contentWrapper.style.height = '100%';
		this._contentWrapper.style.overflowY = 'auto';
		this._contentWrapper.style.overflowX = 'auto';
		this._contentWrapper.style.whiteSpace = 'pre-wrap';
		this._contentWrapper.style.wordBreak = 'break-all';
		this._contentWrapper.style.fontFamily = 'var(--monaco-monospace-font)';
		this._contentWrapper.style.fontSize = '11px';
		this._contentWrapper.style.padding = '4px 8px';
		this._contentWrapper.style.backgroundColor = 'var(--vscode-editor-background)';
		this._contentWrapper.style.color = 'var(--vscode-editor-foreground)';
		this._contentWrapper.style.userSelect = 'text';
		this._contentWrapper.style.cursor = 'text';

		// Prevent Monaco from capturing scroll events
		this._contentWrapper.addEventListener('wheel', (e) => {
			e.stopPropagation();
		}, { passive: false });

		this._container = document.createElement('div');
		this._container.className = 'output-content';
		this._contentWrapper.appendChild(this._container);

		this.domNode.appendChild(controlBar);
		this.domNode.appendChild(this._contentWrapper);

		editor.changeViewZones(accessor => {
			this._id = accessor.addZone(this);
		});
	}

	private createControlButton(iconClass: string): HTMLElement {
		const button = document.createElement('span');
		button.className = iconClass;
		button.style.cursor = 'pointer';
		button.style.color = 'var(--vscode-icon-foreground)';
		button.style.fontSize = '16px';
		button.style.lineHeight = '16px';
		button.style.display = 'inline-block';
		return button;
	}

	private toggleCollapse(): void {
		this._isCollapsed = !this._isCollapsed;
		
		if (this._isCollapsed) {
			this._collapseButton.className = 'codicon codicon-chevron-down';
			this._contentWrapper.style.display = 'none';
			this.updateHeight(20);
		} else {
			this._collapseButton.className = 'codicon codicon-chevron-up';
			this._contentWrapper.style.display = 'block';
			this.updateHeight(this._fullHeight);
		}
	}

	appendANSIText(text: string): void {
		// Check if this is an image
		if (text.startsWith('IMAGE:')) {
			const imageDataUrl = text.substring(6).trim(); // Remove "IMAGE:" prefix
			const img = document.createElement('img');
			img.src = imageDataUrl;
			img.style.maxWidth = '100%';
			img.style.height = 'auto';
			img.style.display = 'block';
			img.style.marginTop = '4px';
			img.style.marginBottom = '4px';
			this._container.appendChild(img);
		} else {
			// Regular ANSI text
			const workspaceFolder = this._workspaceContextService.getWorkspace().folders[0];
			const rendered = handleANSIOutput(text, this._linkDetector, workspaceFolder, undefined);
			this._container.appendChild(rendered);
		}
	}

	updateHeight(newHeight: number): void {
		if (this._id) {
			this.heightInPx = newHeight;
			if (!this._isCollapsed) {
				this._fullHeight = newHeight;
			}
			this.domNode.style.height = `${newHeight}px`;
			this.editor.changeViewZones(accessor => {
				accessor.updateZone(this._id!, { 
					heightInPx: newHeight
				});
			});
		}
	}

	updatePosition(afterLineNumber: number): void {
		if (this._id && this.afterLineNumber !== afterLineNumber) {
			(this as any).afterLineNumber = afterLineNumber;
			this.editor.changeViewZones(accessor => {
				accessor.updateZone(this._id!, {
					afterLineNumber: afterLineNumber
				});
			});
		}
	}

	dispose(): void {
		if (this._id) {
			this.editor.changeViewZones(accessor => accessor.removeZone(this._id!));
			if (this._onDispose) {
				this._onDispose();
			}
		}
	}
}

@extHostNamedCustomer(MainContext.MainThreadEditorInsets)
export class MainThreadEditorInsets implements MainThreadEditorInsetsShape {

	private readonly _proxy: ExtHostEditorInsetsShape;
	private readonly _disposables = new DisposableStore();
	private readonly _insets = new Map<number, EditorWebviewZone>();
	private readonly _nativeZones = new Map<number, EditorNativeZone>();
	private readonly _linkDetector: LinkDetector;

	constructor(
		context: IExtHostContext,
		@ICodeEditorService private readonly _editorService: ICodeEditorService,
		@IWebviewService private readonly _webviewService: IWebviewService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
	) {
		this._proxy = context.getProxy(ExtHostContext.ExtHostEditorInsets);
		this._linkDetector = this._instantiationService.createInstance(LinkDetector);
	}

	dispose(): void {
		this._disposables.dispose();
	}

	async $createEditorInset(handle: number, id: string, uri: UriComponents, line: number, height: number, options: IWebviewContentOptions, extensionId: ExtensionIdentifier, extensionLocation: UriComponents): Promise<void> {
		let editor: IActiveCodeEditor | undefined;
		id = id.substr(0, id.indexOf(',')); //todo@jrieken HACK

		for (const candidate of this._editorService.listCodeEditors()) {
			if (candidate.getId() === id && candidate.hasModel() && isEqual(candidate.getModel().uri, URI.revive(uri))) {
				editor = candidate;
				break;
			}
		}

		if (!editor) {
			setTimeout(() => this._proxy.$onDidDispose(handle));
			return;
		}

		const disposables = new DisposableStore();

		const webview = this._webviewService.createWebviewElement({
			title: undefined,
			options: {
				enableFindWidget: false,
			},
			contentOptions: reviveWebviewContentOptions(options),
			extension: { id: extensionId, location: URI.revive(extensionLocation) }
		});

		const webviewZone = new EditorWebviewZone(editor, line, height, webview);

		const remove = () => {
			disposables.dispose();
			this._proxy.$onDidDispose(handle);
			this._insets.delete(handle);
		};

		disposables.add(editor.onDidChangeModel(remove));
		disposables.add(editor.onDidDispose(remove));
		disposables.add(webviewZone);
		disposables.add(webview);
		disposables.add(webview.onMessage(msg => this._proxy.$onDidReceiveMessage(handle, msg.message)));

		this._insets.set(handle, webviewZone);
	}

	$disposeEditorInset(handle: number): void {
		const inset = this.getInset(handle);
		this._insets.delete(handle);
		inset.dispose();
	}

	$updateEditorInsetHeight(handle: number, newHeight: number): void {
		const inset = this.getInset(handle);
		inset.updateHeight(newHeight);
	}

	$setHtml(handle: number, value: string): void {
		const inset = this.getInset(handle);
		inset.webview.setHtml(value);
	}

	$setOptions(handle: number, options: IWebviewContentOptions): void {
		const inset = this.getInset(handle);
		inset.webview.contentOptions = reviveWebviewContentOptions(options);
	}

	async $postMessage(handle: number, value: any): Promise<boolean> {
		const inset = this.getInset(handle);
		inset.webview.postMessage(value);
		return true;
	}

	async $createNativeViewZone(handle: number, id: string, uri: UriComponents, afterLineNumber: number, heightInPx: number): Promise<void> {
		let editor: IActiveCodeEditor | undefined;
		id = id.substr(0, id.indexOf(',')); //todo@jrieken HACK

		for (const candidate of this._editorService.listCodeEditors()) {
			if (candidate.getId() === id && candidate.hasModel() && isEqual(candidate.getModel().uri, URI.revive(uri))) {
				editor = candidate;
				break;
			}
		}

		if (!editor) {
			return;
		}

		const nativeZone = new EditorNativeZone(
			editor,
			afterLineNumber,
			heightInPx,
			this._linkDetector,
			this._workspaceContextService,
			() => {
				this._nativeZones.delete(handle);
				this._proxy.$onDidDisposeViewZone(handle);
			}
		);

		this._nativeZones.set(handle, nativeZone);
	}

	$appendANSIText(handle: number, text: string): void {
		const zone = this.getNativeZone(handle);
		zone.appendANSIText(text);
	}

	$updateViewZoneHeight(handle: number, newHeight: number): void {
		const zone = this.getNativeZone(handle);
		zone.updateHeight(newHeight);
	}

	$updateViewZonePosition(handle: number, afterLineNumber: number): void {
		const zone = this.getNativeZone(handle);
		zone.updatePosition(afterLineNumber);
	}

	$disposeViewZone(handle: number): void {
		const zone = this._nativeZones.get(handle);
		if (zone) {
			this._nativeZones.delete(handle);
			zone.dispose();
		}
	}

	private getInset(handle: number): EditorWebviewZone {
		const inset = this._insets.get(handle);
		if (!inset) {
			throw new Error('Unknown inset');
		}
		return inset;
	}

	private getNativeZone(handle: number): EditorNativeZone {
		const zone = this._nativeZones.get(handle);
		if (!zone) {
			throw new Error('Unknown native zone');
		}
		return zone;
	}
}
