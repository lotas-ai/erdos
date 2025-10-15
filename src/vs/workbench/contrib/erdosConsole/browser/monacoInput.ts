/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CodeEditorWidget } from '../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { IEditorOptions } from '../../../../editor/common/config/editorOptions.js';
import { ILanguageRuntimeSession, RuntimeCodeFragmentStatus, RuntimeState } from '../../../services/languageRuntime/common/languageRuntimeTypes.js';
import { URI } from '../../../../base/common/uri.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { KeyCode } from '../../../../base/common/keyCodes.js';
import { IKeyboardEvent } from '../../../../base/browser/keyboardEvent.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { TokenizationRegistry } from '../../../../editor/common/languages.js';
import { LineTokens } from '../../../../editor/common/tokens/lineTokens.js';
import { ViewLineRenderingData } from '../../../../editor/common/viewModel.js';
import { Schemas } from '../../../../base/common/network.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { RenderLineInput, renderViewLine2 } from '../../../../editor/common/viewLayout/viewLineRenderer.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { EditorExtensionsRegistry } from '../../../../editor/browser/editorExtensions.js';
import { SuggestController } from '../../../../editor/contrib/suggest/browser/suggestController.js';
import { SnippetController2 } from '../../../../editor/contrib/snippet/browser/snippetController2.js';
import { TabCompletionController } from '../../snippets/browser/tabCompletion.js';
import { ContextMenuController } from '../../../../editor/contrib/contextmenu/browser/contextmenu.js';
import { ContentHoverController } from '../../../../editor/contrib/hover/browser/contentHoverController.js';
import { MarkerController } from '../../../../editor/contrib/gotoError/browser/gotoError.js';
import { ParameterHintsController } from '../../../../editor/contrib/parameterHints/browser/parameterHints.js';
import { FormatOnType } from '../../../../editor/contrib/format/browser/formatActions.js';
import { SelectionClipboardContributionID } from '../../codeEditor/browser/selectionClipboard.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';

export interface IMonacoInputProps {
	session: ILanguageRuntimeSession;
	container: HTMLElement;
	modelService: IModelService;
	languageService: ILanguageService;
	instantiationService: IInstantiationService;
	themeService: IThemeService;
	configurationService: IConfigurationService;
	languageFeaturesService: ILanguageFeaturesService;
	onExecute: (code: string) => Promise<void>;
	shouldFocusConsole: () => boolean;
	outputDisplay?: any;
}

export class MonacoInput extends Disposable {
	private readonly _editor: CodeEditorWidget;
	private readonly _props: IMonacoInputProps;
	private readonly _promptElement: HTMLElement;
	
	private readonly _onDidChangeContentHeight = this._register(new Emitter<number>());
	readonly onDidChangeContentHeight: Event<number> = this._onDidChangeContentHeight.event;
	
	private readonly _onWillExecute = this._register(new Emitter<string>());
	readonly onWillExecute: Event<string> = this._onWillExecute.event;

	private readonly _history: string[] = [];
	private _historyIndex: number = -1;
	private _currentInput: string = '';
	private _awaitingInput: boolean = false;
	private _inputRequestId: string | undefined;
	private _editorContainer: HTMLElement;
	private _shouldRestoreFocus: boolean = false;

	constructor(props: IMonacoInputProps) {
		super();
		
		this._props = props;

		// Create prompt element that appears inline before the editor
		this._promptElement = document.createElement('span');
		this._promptElement.className = 'console-input-prompt';
		this._promptElement.style.display = 'none'; // Hidden by default
		this._promptElement.style.paddingRight = '4px';
		this._promptElement.style.userSelect = 'none';
		this._promptElement.style.flexShrink = '0';
		props.container.appendChild(this._promptElement);

		// Create editor container
		const editorContainer = document.createElement('div');
		editorContainer.className = 'console-input-editor';
		editorContainer.style.flexGrow = '1';
		editorContainer.style.minWidth = '0';
		props.container.appendChild(editorContainer);
		this._editorContainer = editorContainer;

	const languageId = props.session.runtimeMetadata.languageId;
	const uri = URI.from({
		scheme: Schemas.inMemory,
		path: `/repl-${languageId}-${generateUuid()}`
	});
	
	const model = props.modelService.createModel(
		'',
		props.languageService.createById(languageId),
		uri,
		false
	);
	this._register(model);


		const getInputPrompt = () => props.session.dynState.inputPrompt || '>';
		const getContinuationPrompt = () => props.session.dynState.continuationPrompt || '+';

	const editorOptions: IEditorOptions = {
		...props.configurationService.getValue<IEditorOptions>('editor'),
		...props.configurationService.getValue('console'),
		...{
			readOnly: false,
			ariaLabel: 'Console Input',
			minimap: { enabled: false },
			glyphMargin: false,
			folding: false,
			fixedOverflowWidgets: true,
			lineDecorationsWidth: '1.0ch',
			renderLineHighlight: 'none',
			renderFinalNewline: 'on',
			wordWrap: 'bounded',
			wordWrapColumn: 2048,
			scrollbar: {
				vertical: 'hidden',
				useShadows: false
			},
			overviewRulerLanes: 0,
			rulers: [],
			scrollBeyondLastLine: false,
			renderValidationDecorations: 'off',
			lineNumbers: (lineNumber: number) => {
				return lineNumber < 2 ? getInputPrompt() : getContinuationPrompt();
			},
			lineNumbersMinChars: Math.max(
				getInputPrompt().length,
				getContinuationPrompt().length
			),
		}
	};

	this._editor = props.instantiationService.createInstance(
		CodeEditorWidget,
		editorContainer,
		editorOptions,
		{
			isSimpleWidget: true,
			contributions: EditorExtensionsRegistry.getSomeEditorContributions([
				SelectionClipboardContributionID,
				ContextMenuController.ID,
				SuggestController.ID,
				SnippetController2.ID,
				TabCompletionController.ID,
				ContentHoverController.ID,
				MarkerController.ID,
				ParameterHintsController.ID,
				FormatOnType.ID,
			])
		}
	);
	this._register(this._editor);

	this._editor.setModel(model);


	this._register(this._editor.onDidContentSizeChange(() => {
		const width = props.container.offsetWidth || 300;
		this._editor.layout({
			width,
			height: this._editor.getContentHeight()
		});
		
		props.container.scrollIntoView({ behavior: 'auto', block: 'end' });
	}));

	this._register(this._editor.onDidPaste(() => {
		props.container.scrollIntoView({ behavior: 'auto', block: 'end' });
	}));

	this._editor.layout();

		this._register(props.session.onDidChangeRuntimeState((state: RuntimeState) => {
			// Don't update prompts if we're in input mode
			if (this._awaitingInput) {
				return;
			}
			
			const inputPrompt = props.session.dynState.inputPrompt || '>';
			const continuationPrompt = props.session.dynState.continuationPrompt || '+';
			
			// Update prompts based on runtime state, but keep editor fully interactive
			if (state === RuntimeState.Busy) {
				// Track whether we should restore focus after execution completes
				// Only restore focus if the console currently has focus AND the execution is from the console
				this._shouldRestoreFocus = this._editor.hasTextFocus() && props.shouldFocusConsole();
				
				// Keep editor visible and interactive but show running state (no prompt)
				this._editor.updateOptions({
					lineNumbers: () => '',  // No prompt during busy state
					lineNumbersMinChars: Math.max(inputPrompt.length, continuationPrompt.length),
					lineDecorationsWidth: '1.0ch'
					// Note: No readOnly restriction - editor remains fully interactive
				});
			} else if (state === RuntimeState.Idle || state === RuntimeState.Ready) {
				// Restore normal prompts
				this._editor.updateOptions({
					lineNumbers: (lineNumber: number) => {
						return lineNumber < 2 ? inputPrompt : continuationPrompt;
					},
					lineNumbersMinChars: Math.max(inputPrompt.length, continuationPrompt.length),
					lineDecorationsWidth: '1.0ch'
				});
				
				// Restore focus only if the console had focus when execution started
				// This prevents stealing focus from the file editor after running console commands
				setTimeout(() => {
					if (this._shouldRestoreFocus) {
						this._editor.focus();
						this._shouldRestoreFocus = false; // Reset flag after restoring focus
					}
				}, 0);
			}
		}));

		// Listen for input requests from the kernel
		this._register(props.session.onDidReceiveRuntimeMessage((msg: any) => {
			if (msg.type === 'input') {
				const inputMsg = msg as { id: string; prompt: string; password: boolean };
				this._awaitingInput = true;
				this._inputRequestId = inputMsg.id;
				
				// Show the prompt inline
				this._promptElement.textContent = inputMsg.prompt;
				this._promptElement.style.display = 'inline';
				
				// Hide gutter using CSS class (preserves all styling)
				this._editorContainer.classList.add('input-mode-hide-gutter');
				
				// Clear any existing content and focus
				this._editor.setValue('');
				this._editor.focus();
			}
		}));

	this._register(this._editor.onKeyDown(e => {
		this._handleKeyDown(e, props);
	}));
	}

	private async _handleKeyDown(e: IKeyboardEvent, props: IMonacoInputProps): Promise<void> {
		// Handle Enter key for input reply or code execution
		if (e.keyCode === KeyCode.Enter && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
			// If we're awaiting input, send the input reply instead of executing code
			if (this._awaitingInput && this._inputRequestId) {
				e.preventDefault();
				e.stopPropagation();
				
				const userInput = this._editor.getValue();
				
				// Write the user's input to the output display
				if (props.outputDisplay) {
					props.outputDisplay.write(userInput + '\n');
				}
				
				// Send the input reply to the kernel
				props.session.replyToInput(this._inputRequestId, userInput);
				
				// Reset input mode
				this._awaitingInput = false;
				this._inputRequestId = undefined;
				
				// Hide the prompt element
				this._promptElement.style.display = 'none';
				this._promptElement.textContent = '';
				
				// Clear the editor
				this._editor.setValue('');
				
				// Show gutter again (preserves all styling)
				this._editorContainer.classList.remove('input-mode-hide-gutter');
				
				return;
			}
			
			// Prevent execution if session is busy
			if (props.session.getRuntimeState() === RuntimeState.Busy) {
				e.preventDefault();
				e.stopPropagation();
				return;
			}

			const code = this._editor.getValue();
			
			if (!code.trim()) {
				e.preventDefault();
				e.stopPropagation();

				const styledHtml = this._convertToStyledHtml(code);
				this._onWillExecute.fire(styledHtml);

				await props.onExecute(code);

				this._editor.setValue('');
				return;
			}

			const status = await props.session.isCodeFragmentComplete(code);

			if (status === RuntimeCodeFragmentStatus.Complete) {
				e.preventDefault();
				e.stopPropagation();

				this._updateHistory(code);

				const styledHtml = this._convertToStyledHtml(code);
				this._onWillExecute.fire(styledHtml);

				await props.onExecute(code);

				this._editor.setValue('');

			}
		}
		
		// Handle Ctrl+C for interruption (allow during busy state and input mode)
		else if (e.keyCode === KeyCode.KeyC && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
			// If awaiting input, exit input mode
			if (this._awaitingInput && this._inputRequestId) {
				e.preventDefault();
				e.stopPropagation();
				
				// Cancel input mode
				this._awaitingInput = false;
				this._inputRequestId = undefined;
				
				// Hide the prompt element
				this._promptElement.style.display = 'none';
				this._promptElement.textContent = '';
				
				// Clear the editor
				this._editor.setValue('');
				
				// Show gutter again (preserves all styling)
				this._editorContainer.classList.remove('input-mode-hide-gutter');
				
				// Interrupt the kernel
				props.session.interrupt();
				return;
			}
			
			// If session is busy, interrupt it
			if (props.session.getRuntimeState() === RuntimeState.Busy) {
				e.preventDefault();
				e.stopPropagation();
				props.session.interrupt();
				return;
			}
			
			// If not busy, clear current input (existing behavior)
			const currentValue = this._editor.getValue();
			if (currentValue) {
				e.preventDefault();
				e.stopPropagation();
				this._editor.setValue('');
				this._historyIndex = -1;
				this._currentInput = '';
			}
		}

		else if (e.keyCode === KeyCode.UpArrow && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
			const isSuggestWidgetVisible = this._isSuggestWidgetVisible();
			
			const position = this._editor.getPosition();
			const lineNumber = position?.lineNumber || 0;
			
			if (lineNumber === 1 && !isSuggestWidgetVisible) {
				e.preventDefault();
				e.stopPropagation();
				this._navigateHistoryUp();
			}
		}

		else if (e.keyCode === KeyCode.DownArrow && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
			const isSuggestWidgetVisible = this._isSuggestWidgetVisible();
			
			const position = this._editor.getPosition();
			const lineCount = this._editor.getModel()?.getLineCount() || 0;
			const lineNumber = position?.lineNumber || 0;
			
			if (lineNumber === lineCount && !isSuggestWidgetVisible) {
				e.preventDefault();
				e.stopPropagation();
				this._navigateHistoryDown();
			}
		}
	}

	private _isSuggestWidgetVisible(): boolean {
		const editorDomNode = this._editor.getDomNode();
		if (!editorDomNode) {
			return false;
		}
		
		const suggestWidget = editorDomNode.querySelector('.suggest-widget.visible');
		return !!suggestWidget;
	}

	private _navigateHistoryUp(): void {
		if (this._history.length === 0) {
			return;
		}

		if (this._historyIndex === -1) {
			this._currentInput = this._editor.getValue();
		}

		if (this._historyIndex < this._history.length - 1) {
			this._historyIndex++;
			const historyEntry = this._history[this._history.length - 1 - this._historyIndex];
			this._editor.setValue(historyEntry);
			
			const model = this._editor.getModel();
			if (model) {
				const lineCount = model.getLineCount();
				const lastLineLength = model.getLineMaxColumn(lineCount);
				this._editor.setPosition({ lineNumber: lineCount, column: lastLineLength });
			}
		}
	}

	private _navigateHistoryDown(): void {
		if (this._historyIndex === -1) {
			return;
		}

		this._historyIndex--;

		if (this._historyIndex === -1) {
			this._editor.setValue(this._currentInput);
			this._currentInput = '';
			
			const model = this._editor.getModel();
			if (model) {
				const lineCount = model.getLineCount();
				const lastLineLength = model.getLineMaxColumn(lineCount);
				this._editor.setPosition({ lineNumber: lineCount, column: lastLineLength });
			}
		} else {
			const historyEntry = this._history[this._history.length - 1 - this._historyIndex];
			this._editor.setValue(historyEntry);
			
			const model = this._editor.getModel();
			if (model) {
				const lineCount = model.getLineCount();
				const lastLineLength = model.getLineMaxColumn(lineCount);
				this._editor.setPosition({ lineNumber: lineCount, column: lastLineLength });
			}
		}
	}

	focus(): void {
		// Keep editor always editable and interactive
		this._editor.updateOptions({
			readOnly: false,
			domReadOnly: false
		});
		this._editor.focus();
	}

	getValue(): string {
		return this._editor.getValue();
	}

	setValue(value: string): void {
		this._editor.setValue(value);
	}

	layout(width: number): void {
		this._editor.layout({
			width,
			height: this._editor.getContentHeight()
		});
	}
	
	getContentHeight(): number {
		return this._editor.getContentHeight();
	}
	
	private _updateHistory(code: string): void {
		if (!code.trim()) {
			return;
		}

		if (this._history.length > 0 && this._history[this._history.length - 1] === code) {
		} else {
			this._history.push(code);
		}

		this._historyIndex = -1;
		this._currentInput = '';
	}
	
	private _convertToStyledHtml(code: string): string {
		const model = this._editor.getModel();
		if (!model) {
			return this._convertToPlainWithPrompts(code);
		}
		
		const languageId = model.getLanguageId();
		const tokenizationSupport = TokenizationRegistry.get(languageId);
		
		if (!tokenizationSupport) {
			return this._convertToPlainWithPrompts(code);
		}
		
		const lines = code.split('\n');
		const inputPrompt = this._props.session.dynState.inputPrompt || '>';
		const continuationPrompt = this._props.session.dynState.continuationPrompt || '+';
		
		const htmlLines: string[] = [];
		let state = tokenizationSupport.getInitialState();
		
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const prompt = i === 0 ? inputPrompt : continuationPrompt;
			
			const tokenizeResult = tokenizationSupport.tokenizeEncoded(line, true, state);
			
			LineTokens.convertToEndOffset(tokenizeResult.tokens, line.length);
			const lineTokens = new LineTokens(
				tokenizeResult.tokens,
				line,
				this._props.languageService.languageIdCodec
			);
			
			const isBasicASCII = ViewLineRenderingData.isBasicASCII(line, true);
			const containsRTL = ViewLineRenderingData.containsRTL(line, isBasicASCII, true);
			
			const renderLineInput = new RenderLineInput(
				false,
				true,
				line,
				false,
				isBasicASCII,
				containsRTL,
				0,
				lineTokens.inflate(),
				[],
				0,
				0,
				0,
				0,
				0,
				-1,
				'none',
				false,
				false,
				null,
				null,
				0
			);
			
			const renderLineOutput = renderViewLine2(renderLineInput);
			
			const promptHtml = `<span>${prompt} </span>`;
			htmlLines.push(promptHtml + renderLineOutput.html);
			
			state = tokenizeResult.endState;
		}
		
		return htmlLines.join('<br>') + '<br>';
	}
	
	private _convertToPlainWithPrompts(code: string): string {
		const lines = code.split('\n');
		const inputPrompt = this._props.session.dynState.inputPrompt || '>';
		const continuationPrompt = this._props.session.dynState.continuationPrompt || '+';
		
		const htmlLines: string[] = [];
		for (let i = 0; i < lines.length; i++) {
			const prompt = i === 0 ? inputPrompt : continuationPrompt;
			const escapedLine = lines[i]
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/"/g, '&quot;')
				.replace(/'/g, '&#039;');
			htmlLines.push(`<span>${prompt} ${escapedLine}</span>`);
		}
		return htmlLines.join('<br>') + '<br>';
	}

	public formatCodeAsHtml(code: string): string {
		return this._convertToStyledHtml(code);
	}

	public addToHistory(code: string): void {
		this._updateHistory(code);
	}

	public removeFromHistory(code: string): void {
		const index = this._history.indexOf(code);
		if (index !== -1) {
			this._history.splice(index, 1);
			// Reset history navigation if we're currently at this index
			if (this._historyIndex >= index) {
				this._historyIndex = Math.max(-1, this._historyIndex - 1);
			}
		}
	}
}

