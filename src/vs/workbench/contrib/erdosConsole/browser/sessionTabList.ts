/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISessionManager } from '../../../services/languageRuntime/common/sessionManager.js';
import { ILanguageRuntimeSession, RuntimeState } from '../../../services/languageRuntime/common/languageRuntimeTypes.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { $, append, addDisposableListener } from '../../../../base/browser/dom.js';
import { Emitter } from '../../../../base/common/event.js';

export interface ISessionTabListProps {
	container: HTMLElement;
	sessionManager: ISessionManager;
}

export class SessionTabList extends Disposable {
	private readonly _container: HTMLElement;
	private readonly _tabs: Map<string, HTMLElement> = new Map();
	private readonly _spinners: Map<string, HTMLElement> = new Map();

	private readonly _onDidSelectSession = this._register(new Emitter<ILanguageRuntimeSession>());
	readonly onDidSelectSession = this._onDidSelectSession.event;

	constructor(props: ISessionTabListProps) {
		super();

		this._container = append(props.container, $('.sidebar-list'));
		this._container.setAttribute('role', 'tablist');
		this._container.setAttribute('aria-orientation', 'vertical');

		this._register(props.sessionManager.onDidStartSession(() => {
			this._refresh(props.sessionManager);
		}));

		this._register(props.sessionManager.onDidEndSession(() => {
			this._refresh(props.sessionManager);
		}));

		this._register(props.sessionManager.onDidChangeForegroundSession(() => {
			this._updateActiveTab(props.sessionManager);
		}));

		this._refresh(props.sessionManager);

		this._register(addDisposableListener(this._container, 'keydown', (e: KeyboardEvent) => {
			const sessions = props.sessionManager.activeSessions;
			const activeIndex = sessions.findIndex(s => s === props.sessionManager.foregroundSession);

			let newIndex = activeIndex;

			if (e.key === 'ArrowDown') {
				e.preventDefault();
				newIndex = Math.min(sessions.length - 1, activeIndex + 1);
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				newIndex = Math.max(0, activeIndex - 1);
			} else if (e.key === 'Home') {
				e.preventDefault();
				newIndex = 0;
			} else if (e.key === 'End') {
				e.preventDefault();
				newIndex = sessions.length - 1;
			}

			if (newIndex !== activeIndex && newIndex >= 0 && newIndex < sessions.length) {
				props.sessionManager.foregroundSession = sessions[newIndex];
				const tab = this._tabs.get(sessions[newIndex].sessionId);
				if (tab) {
					tab.focus();
				}
			}
		}));
	}

	private _refresh(sessionManager: ISessionManager): void {
		while (this._container.firstChild) {
			this._container.removeChild(this._container.firstChild);
		}
		this._tabs.clear();
		this._spinners.clear();

		const sessions = sessionManager.activeSessions;
		sessions.forEach(session => {
			const sessionId = session.sessionId;
			const tab = append(this._container, $('.item-cell'));
			tab.setAttribute('role', 'tab');
			tab.setAttribute('tabindex', '0');
			tab.setAttribute('aria-label', session.runtimeMetadata.runtimeName);

			const sessionName = append(tab, $('p.label-text'));
			sessionName.textContent = session.runtimeMetadata.runtimeName;

			// Add spinner element (hidden by default)
			const spinner = append(tab, $('span.codicon.codicon-loading.codicon-modifier-spin.session-spinner'));
			spinner.style.display = 'none';
			this._spinners.set(sessionId, spinner);

		const deleteButton = append(tab, $('button.close-action'));
		deleteButton.setAttribute('data-testid', 'trash-session');
		append(deleteButton, $('span.codicon.codicon-trash'));
		
		this._register(addDisposableListener(deleteButton, 'click', async (e: MouseEvent) => {
			e.stopPropagation();
			e.preventDefault();
			await sessionManager.shutdownSession(sessionId);
		}));

		this._register(addDisposableListener(deleteButton, 'mousedown', (e: MouseEvent) => {
			e.stopPropagation();
			e.preventDefault();
		}));

		this._register(addDisposableListener(tab, 'click', () => {
			sessionManager.foregroundSession = session;
			this._onDidSelectSession.fire(session);
		}));

		// Listen to runtime state changes for this session
		this._register(session.onDidChangeRuntimeState((state: RuntimeState) => {
			const spinner = this._spinners.get(sessionId);
			if (spinner) {
				if (state === RuntimeState.Busy) {
					spinner.style.display = 'inline-block';
				} else if (state === RuntimeState.Idle || state === RuntimeState.Ready) {
					spinner.style.display = 'none';
				}
			}
		}));

		this._tabs.set(sessionId, tab);
		});

		this._updateActiveTab(sessionManager);
	}

	private _updateActiveTab(sessionManager: ISessionManager): void {
		const activeSessionId = sessionManager.foregroundSession?.sessionId;

		this._tabs.forEach((tab, sessionId) => {
			if (sessionId === activeSessionId) {
				tab.classList.add('item-cell--selected');
				tab.setAttribute('aria-selected', 'true');
			} else {
				tab.classList.remove('item-cell--selected');
				tab.setAttribute('aria-selected', 'false');
			}
		});
	}
}
