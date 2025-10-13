/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { $, append } from '../../../../base/browser/dom.js';
import { ILanguageRuntimeService } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { ISessionManager } from '../../../services/languageRuntime/common/sessionManager.js';
import { LanguageRuntimeSessionMode } from '../../../services/languageRuntime/common/languageRuntimeTypes.js';
import { localize } from '../../../../nls.js';
import { RUNTIME_ICONS } from '../../erdosHelp/browser/runtimeIcons.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';

export interface IConsoleStartupScreenProps {
	container: HTMLElement;
	sessionManager: ISessionManager;
	languageRuntimeService: ILanguageRuntimeService;
	commandService: ICommandService;
}

export class ConsoleStartupScreen extends Disposable {
	private readonly _container: HTMLElement;
	private _hasPython: boolean = false;
	private _hasR: boolean = false;

	constructor(props: IConsoleStartupScreenProps) {
		super();

		this._container = append(props.container, $('.console-startup-screen'));
		
		// Check for existing runtimes
		this._updateAvailableRuntimes(props.languageRuntimeService);

		// Create the split panels
		this._createPanels(props);

		// Listen for new runtime registrations
		this._register(props.languageRuntimeService.onDidRegisterRuntime(() => {
			this._updateAvailableRuntimes(props.languageRuntimeService);
			this._updatePanels(props);
		}));
	}

	private _updateAvailableRuntimes(languageRuntimeService: ILanguageRuntimeService): void {
		const runtimes = languageRuntimeService.registeredRuntimes;
		this._hasPython = runtimes.some(r => r.languageId === 'python');
		this._hasR = runtimes.some(r => r.languageId === 'r');
	}

	private _createPanels(props: IConsoleStartupScreenProps): void {
		// If neither is available yet, show a message
		if (!this._hasPython && !this._hasR) {
			const messageContainer = append(this._container, $('.startup-message'));
			messageContainer.textContent = localize('console.discoveringRuntimes', 'Discovering language runtimes...');
			return;
		}

		// If only one is available, show it centered
		if (this._hasPython && !this._hasR) {
			const panel = this._createLanguagePanel('python', props);
			this._container.appendChild(panel);
			return;
		}

		if (!this._hasPython && this._hasR) {
			const panel = this._createLanguagePanel('r', props);
			this._container.appendChild(panel);
			return;
		}

		// Both are available, split the view
		const leftPanel = this._createLanguagePanel('python', props);
		const rightPanel = this._createLanguagePanel('r', props);
		
		this._container.appendChild(leftPanel);
		this._container.appendChild(rightPanel);
	}

	private _updatePanels(props: IConsoleStartupScreenProps): void {
		// Clear existing content
		while (this._container.firstChild) {
			this._container.removeChild(this._container.firstChild);
		}

		// Recreate panels with updated state
		this._createPanels(props);
	}

	private _createLanguagePanel(languageId: 'python' | 'r', props: IConsoleStartupScreenProps): HTMLElement {
		const panel = $('.startup-panel');
		panel.setAttribute('data-language', languageId);

		// Create icon container with SVG
		const iconContainer = append(panel, $('.startup-icon-container'));
		const svgData = RUNTIME_ICONS[languageId];
		if (svgData) {
			const base64 = btoa(svgData);
			const img = document.createElement('img');
			img.className = 'startup-icon';
			img.src = `data:image/svg+xml;base64,${base64}`;
			img.alt = `${languageId} icon`;
			iconContainer.appendChild(img);
		}

		// Create text
		const text = append(panel, $('.startup-text'));
		const languageName = languageId === 'python' ? 'Python' : 'R';
		text.textContent = localize('console.startSession', 'Start {0} session', languageName);

		// Make it clickable
		panel.style.cursor = 'pointer';
		panel.addEventListener('click', async () => {
			const runtimes = props.languageRuntimeService.registeredRuntimes.filter(r => r.languageId === languageId);
			if (runtimes.length === 0) {
				return;
			}
			
			if (runtimes.length === 1) {
				// Only one runtime, start it directly
				const runtime = runtimes[0];
				const sessionName = `${runtime.languageName} ${new Date().toLocaleTimeString()}`;
				await props.sessionManager.startSession(runtime, LanguageRuntimeSessionMode.Console, sessionName);
			} else {
				// Multiple runtimes, show the picker
				await props.commandService.executeCommand('erdos.languageRuntime.startNewSession');
			}
		});

		return panel;
	}

	public hide(): void {
		this._container.style.display = 'none';
	}

	public show(): void {
		this._container.style.display = 'flex';
	}

	public override dispose(): void {
		this._container.remove();
		super.dispose();
	}
}

