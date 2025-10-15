/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { ILanguageRuntimeSession } from '../../../services/languageRuntime/common/languageRuntimeTypes.js';

// Message types for output handling
interface ILanguageRuntimeMessageOutput { [key: string]: any; }
interface ILanguageRuntimeMessageResult { [key: string]: any; }
interface ILanguageRuntimeMessageStream { [key: string]: any; }
interface ILanguageRuntimeMessageError { [key: string]: any; }
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { editorBackground, editorForeground } from '../../../../platform/theme/common/colorRegistry.js';
import { handleANSIOutput } from '../../debug/browser/debugANSIHandling.js';
import { LinkDetector } from '../../debug/browser/linkDetector.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { createTrustedTypesPolicy } from '../../../../base/browser/trustedTypes.js';
import { IConsoleService } from '../../../services/erdosConsole/common/consoleService.js';

const ttPolicy = createTrustedTypesPolicy('erdosConsole', { createHTML: value => value });

export interface IOutputDisplayProps {
	session: ILanguageRuntimeSession;
	container: HTMLElement;
	themeService: IThemeService;
	configurationService: IConfigurationService;
	instantiationService: IInstantiationService;
	workspaceContextService: IWorkspaceContextService;
	consoleService: IConsoleService;
}

export class OutputDisplay extends Disposable {
	private readonly _outputContainer: HTMLElement;
	private readonly _scrollContainer: HTMLElement;
	private readonly _linkDetector: LinkDetector;
	private readonly _workspaceContextService: IWorkspaceContextService;
	private readonly _configurationService: IConfigurationService;
	private readonly _consoleService: IConsoleService;
	private _autoScrollEnabled = true;

	private readonly _onDidClear = this._register(new Emitter<void>());
	readonly onDidClear: Event<void> = this._onDidClear.event;

	constructor(props: IOutputDisplayProps) {
		super();
		
		this._workspaceContextService = props.workspaceContextService;
		this._configurationService = props.configurationService;
		this._consoleService = props.consoleService;
		this._linkDetector = props.instantiationService.createInstance(LinkDetector);
		
		this._scrollContainer = props.container.closest('.console-viewport') as HTMLElement || props.container;
		
		this._outputContainer = document.createElement('div');
		this._outputContainer.className = 'stream-content';
		this._outputContainer.style.whiteSpace = 'pre-wrap';
		this._outputContainer.style.wordBreak = 'break-all';
		
		this._applyFontConfiguration(props.configurationService);
		
	props.container.appendChild(this._outputContainer);

		this._applyTheme(props.themeService);

		this._register(props.themeService.onDidColorThemeChange(theme => {
			this._applyTheme(props.themeService);
		}));

		this._register(props.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('editor') || e.affectsConfiguration('console')) {
				this._applyFontConfiguration(props.configurationService);
			}
		}));

		this._register(props.session.onDidReceiveRuntimeMessageOutput((msg: ILanguageRuntimeMessageOutput) => {
			if (!this._shouldDisplayMessage(msg)) {
				return;
			}
			// Only display text data in the console - images go to plots orchestrator
			if (msg.data['text/plain']) {
				const text = msg.data['text/plain'];
				this.write(text);
			}
		}));

		this._register(props.session.onDidReceiveRuntimeMessageResult((msg: ILanguageRuntimeMessageResult) => {
			// Check if we should display this message based on console mirroring settings
			if (!this._shouldDisplayMessage(msg)) {
				return;
			}
			// Only display text data in the console
			if (msg.data['text/plain']) {
				const text = msg.data['text/plain'];
				this.write(text);
			}
		}));

			this._register(props.session.onDidReceiveRuntimeMessageStream((msg: ILanguageRuntimeMessageStream) => {
				// Check if we should display this message based on console mirroring settings
				if (!this._shouldDisplayMessage(msg)) {
					return;
				}
				this.write(msg.text);
			}));

	this._register(props.session.onDidReceiveRuntimeMessageError((msg: ILanguageRuntimeMessageError) => {
		if (!this._shouldDisplayMessage(msg)) {
			return;
		}
		this.write(this.ensureTrailingNewline(`\x1b[31mError:\x1b[0m ${msg.message}`));
		if (msg.traceback && msg.traceback.length > 0) {
			msg.traceback.forEach((line: string) => this.write(this.ensureTrailingNewline(line)));
		}
	}));

			const scrollListener = () => {
				const atBottom = this._isAtBottom();
				if (!atBottom && this._autoScrollEnabled) {
					this._autoScrollEnabled = false;
				} else if (atBottom && !this._autoScrollEnabled) {
					this._autoScrollEnabled = true;
				}
			};
		this._scrollContainer.addEventListener('scroll', scrollListener, { passive: true });
		this._register({
			dispose: () => this._scrollContainer.removeEventListener('scroll', scrollListener)
		});
	}

	private _shouldDisplayMessage(msg: any): boolean {
		const notebookConsoleMirroringEnabled = this._configurationService.getValue<boolean>('notebook.consoleMirroring.enabled') ?? false;
		const isNotebook = msg.parent_id && this._consoleService.isNotebookExecution(msg.parent_id);
		
		if (!notebookConsoleMirroringEnabled && isNotebook) {
			return false;
		}

		const quartoConsoleMirroringEnabled = this._configurationService.getValue<boolean>('quarto.consoleMirroring.enabled') ?? true;
		const isQuarto = msg.parent_id && this._consoleService.isQuartoExecution(msg.parent_id);
		
		if (!quartoConsoleMirroringEnabled && isQuarto) {
			return false;
		}

		return true;
	}

	private _applyTheme(themeService: IThemeService): void {
		const theme = themeService.getColorTheme();
		const backgroundColor = theme.getColor(editorBackground)?.toString() || '#ffffff';
		const foregroundColor = theme.getColor(editorForeground)?.toString() || '#000000';
		
		this._outputContainer.style.backgroundColor = backgroundColor;
		this._outputContainer.style.color = foregroundColor;
	}

	private _applyFontConfiguration(configurationService: IConfigurationService): void {
		const editorConfig = configurationService.getValue<any>('editor');
		const consoleConfig = configurationService.getValue<any>('console');
		
		const fontFamily = consoleConfig?.fontFamily || editorConfig?.fontFamily || 'var(--monaco-monospace-font, "SF Mono", Monaco, Menlo, Consolas, "Ubuntu Mono", "Liberation Mono", "DejaVu Sans Mono", "Courier New", monospace)';
		const fontSize = consoleConfig?.fontSize || editorConfig?.fontSize || 12;
		const fontWeight = consoleConfig?.fontWeight || editorConfig?.fontWeight || 'normal';
		const lineHeight = consoleConfig?.lineHeight || editorConfig?.lineHeight || 0;
		const letterSpacing = consoleConfig?.letterSpacing || editorConfig?.letterSpacing || 0;
		
		this._outputContainer.style.fontFamily = fontFamily;
		this._outputContainer.style.fontSize = `${fontSize}px`;
		this._outputContainer.style.fontWeight = fontWeight;
		
		if (lineHeight === 0) {
			this._outputContainer.style.lineHeight = 'normal';
		} else {
			this._outputContainer.style.lineHeight = `${lineHeight}px`;
		}
		
		if (letterSpacing !== 0) {
			this._outputContainer.style.letterSpacing = `${letterSpacing}px`;
		}
	}

	clear(): void {
		while (this._outputContainer.firstChild) {
			this._outputContainer.removeChild(this._outputContainer.firstChild);
		}
		this._onDidClear.fire();
	}

	write(data: string): void {
		const workspaceFolder = this._workspaceContextService.getWorkspace().folders[0];
		const parsed = handleANSIOutput(data, this._linkDetector, workspaceFolder, undefined);
		this._outputContainer.appendChild(parsed);
			if (this._autoScrollEnabled) {
				this._scrollToBottom();
			}
	}

	writeHtml(html: string): void {
		if (!ttPolicy) {
			return;
		}
		const container = document.createElement('div');
		container.innerHTML = ttPolicy.createHTML(html) as unknown as string;
		this._outputContainer.appendChild(container);
			if (this._autoScrollEnabled) {
				this._scrollToBottom();
			}
		}

	private _scrollToBottom(): void {
		if (!this._autoScrollEnabled) {
			return;
		}
		const target = this._scrollContainer.scrollHeight;
		requestAnimationFrame(() => {
			this._scrollContainer.scrollTop = target;
		});
	}

	private ensureTrailingNewline(text: string): string {
		return text.endsWith('\n') ? text : `${text}\n`;
	}

	private _isAtBottom(): boolean {
		const { scrollTop, scrollHeight, clientHeight } = this._scrollContainer;
		const distanceFromBottom = Math.abs(scrollHeight - clientHeight - scrollTop);
		return distanceFromBottom <= 2;
	}
}
