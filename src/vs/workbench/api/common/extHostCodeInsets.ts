/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../base/common/event.js';
import { DisposableStore } from '../../../base/common/lifecycle.js';
import { IExtensionDescription } from '../../../platform/extensions/common/extensions.js';
import { ExtHostTextEditor } from './extHostTextEditor.js';
import { ExtHostEditors } from './extHostTextEditors.js';
import { asWebviewUri, webviewGenericCspSource, WebviewRemoteInfo } from '../../contrib/webview/common/webview.js';
import type * as vscode from 'vscode';
import { ExtHostEditorInsetsShape, MainThreadEditorInsetsShape } from './extHost.protocol.js';

export class ExtHostEditorInsets implements ExtHostEditorInsetsShape {

	private _handlePool = 0;
	private readonly _disposables = new DisposableStore();
	private _insets = new Map<number, { editor: vscode.TextEditor; inset: vscode.WebviewEditorInset; onDidReceiveMessage: Emitter<any> }>();
	private _nativeZones = new Map<number, { editor: vscode.TextEditor; controller: vscode.ViewZoneController; onDidDispose: Emitter<void> }>();

	constructor(
		private readonly _proxy: MainThreadEditorInsetsShape,
		private readonly _editors: ExtHostEditors,
		private readonly _remoteInfo: WebviewRemoteInfo
	) {

		// dispose editor inset whenever the hosting editor goes away
		this._disposables.add(_editors.onDidChangeVisibleTextEditors(() => {
			const visibleEditor = _editors.getVisibleTextEditors();
			for (const value of this._insets.values()) {
				if (visibleEditor.indexOf(value.editor) < 0) {
					value.inset.dispose(); // will remove from `this._insets`
				}
			}
			for (const value of this._nativeZones.values()) {
				if (visibleEditor.indexOf(value.editor) < 0) {
					value.controller.dispose(); // will remove from `this._nativeZones`
				}
			}
		}));
	}

	dispose(): void {
		this._insets.forEach(value => value.inset.dispose());
		this._nativeZones.forEach(value => value.controller.dispose());
		this._disposables.dispose();
	}

	createWebviewEditorInset(editor: vscode.TextEditor, line: number, height: number, options: vscode.WebviewOptions | undefined, extension: IExtensionDescription): vscode.WebviewEditorInset {

		let apiEditor: ExtHostTextEditor | undefined;
		for (const candidate of this._editors.getVisibleTextEditors(true)) {
			if (candidate.value === editor) {
				apiEditor = <ExtHostTextEditor>candidate;
				break;
			}
		}
		if (!apiEditor) {
			throw new Error('not a visible editor');
		}

		const that = this;
		const handle = this._handlePool++;
		const onDidReceiveMessage = new Emitter<any>();
		const onDidDispose = new Emitter<void>();

		const webview = new class implements vscode.Webview {

			private _html: string = '';
			private _options: vscode.WebviewOptions = Object.create(null);

			asWebviewUri(resource: vscode.Uri): vscode.Uri {
				return asWebviewUri(resource, that._remoteInfo);
			}

			get cspSource(): string {
				return webviewGenericCspSource;
			}

			set options(value: vscode.WebviewOptions) {
				this._options = value;
				that._proxy.$setOptions(handle, value);
			}

			get options(): vscode.WebviewOptions {
				return this._options;
			}

			set html(value: string) {
				this._html = value;
				that._proxy.$setHtml(handle, value);
			}

			get html(): string {
				return this._html;
			}

			get onDidReceiveMessage(): vscode.Event<any> {
				return onDidReceiveMessage.event;
			}

			postMessage(message: any): Thenable<boolean> {
				return that._proxy.$postMessage(handle, message);
			}
		};

		const inset = new class implements vscode.WebviewEditorInset {

			readonly editor: vscode.TextEditor = editor;
			readonly line: number = line;
			height: number = height;
			readonly webview: vscode.Webview = webview;
			readonly onDidDispose: vscode.Event<void> = onDidDispose.event;

			updateHeight(newHeight: number): void {
				this.height = newHeight;
				that._proxy.$updateEditorInsetHeight(handle, newHeight);
			}

			dispose(): void {
				if (that._insets.has(handle)) {
					that._insets.delete(handle);
					that._proxy.$disposeEditorInset(handle);
					onDidDispose.fire();

					// final cleanup
					onDidDispose.dispose();
					onDidReceiveMessage.dispose();
				}
			}
		};

		this._proxy.$createEditorInset(handle, apiEditor.id, apiEditor.value.document.uri, line + 1, height, options || {}, extension.identifier, extension.extensionLocation);
		this._insets.set(handle, { editor, inset, onDidReceiveMessage });

		return inset;
	}

	createNativeViewZone(editor: vscode.TextEditor, afterLineNumber: number, heightInPx: number): vscode.ViewZoneController {
		let apiEditor: ExtHostTextEditor | undefined;
		for (const candidate of this._editors.getVisibleTextEditors(true)) {
			if (candidate.value === editor) {
				apiEditor = <ExtHostTextEditor>candidate;
				break;
			}
		}
		if (!apiEditor) {
			throw new Error('not a visible editor');
		}

		const that = this;
		const handle = this._handlePool++;
		const onDidDispose = new Emitter<void>();

		let currentHeight = heightInPx;

		const controller: vscode.ViewZoneController = {
			updateHeight(newHeight: number): void {
				currentHeight = newHeight;
				that._proxy.$updateViewZoneHeight(handle, newHeight);
			},
			appendText(text: string): void {
				that._proxy.$appendANSIText(handle, text);
			},
			updatePosition(afterLineNumber: number): void {
				that._proxy.$updateViewZonePosition(handle, afterLineNumber);
			},
			get height(): number {
				return currentHeight;
			},
			get onDidDispose() {
				return onDidDispose.event;
			},
			dispose(): void {
				if (that._nativeZones.has(handle)) {
					that._nativeZones.delete(handle);
					that._proxy.$disposeViewZone(handle);
					onDidDispose.fire();
					onDidDispose.dispose();
				}
			}
		};

		this._proxy.$createNativeViewZone(handle, apiEditor.id, apiEditor.value.document.uri, afterLineNumber, heightInPx);
		this._nativeZones.set(handle, { editor, controller, onDidDispose });

		return controller;
	}

	$onDidDispose(handle: number): void {
		const value = this._insets.get(handle);
		if (value) {
			value.inset.dispose();
		}
	}

	$onDidReceiveMessage(handle: number, message: any): void {
		const value = this._insets.get(handle);
		value?.onDidReceiveMessage.fire(message);
	}

	$onDidDisposeViewZone(handle: number): void {
		const value = this._nativeZones.get(handle);
		if (value) {
			this._nativeZones.delete(handle);
			value.onDidDispose.fire();
			value.onDidDispose.dispose();
		}
	}
}
