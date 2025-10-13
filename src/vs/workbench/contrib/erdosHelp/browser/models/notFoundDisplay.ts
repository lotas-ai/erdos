/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './notFoundDisplay.css';

import * as DOM from '../../../../../base/browser/dom.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IHelpEntry } from '../topicViewContract.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';

export interface SuggestedTopic {
	topic: string;
	languageId: string;
	languageName: string;
}

export class NotFoundDisplay extends Disposable implements IHelpEntry {
	private _element?: HTMLElement;
	private readonly _titleUpdateEmitter: Emitter<string>;
	private readonly _urlChangeEmitter: Emitter<string>;
	private readonly _backwardNavEmitter: Emitter<void>;
	private readonly _forwardNavEmitter: Emitter<void>;
	private readonly _focusEmitter: Emitter<void>;
	private readonly _blurEmitter: Emitter<void>;

	constructor(
		public readonly searchQuery: string,
		public readonly suggestions: SuggestedTopic[],
		public readonly languageId: string,
		public readonly sessionId: string,
		public readonly languageName: string,
		@ICommandService private readonly _commandService: ICommandService,
	) {
		super();

		this._titleUpdateEmitter = this._register(new Emitter<string>());
		this._urlChangeEmitter = this._register(new Emitter<string>());
		this._backwardNavEmitter = this._register(new Emitter<void>());
		this._forwardNavEmitter = this._register(new Emitter<void>());
		this._focusEmitter = this._register(new Emitter<void>());
		this._blurEmitter = this._register(new Emitter<void>());
	}

	get sourceUrl(): string {
		return `erdos://help/not-found?q=${encodeURIComponent(this.searchQuery)}`;
	}

	get targetUrl(): string {
		return this.sourceUrl;
	}

	get title(): string {
		return `No results for "${this.searchQuery}"`;
	}

	get onTitleUpdated(): Event<string> {
		return this._titleUpdateEmitter.event;
	}

	get onUrlChanged(): Event<string> {
		return this._urlChangeEmitter.event;
	}

	get onBackwardNavigation(): Event<void> {
		return this._backwardNavEmitter.event;
	}

	get onForwardNavigation(): Event<void> {
		return this._forwardNavEmitter.event;
	}

	get onDidFocus(): Event<void> {
		return this._focusEmitter.event;
	}

	get onDidBlur(): Event<void> {
		return this._blurEmitter.event;
	}

	displayContent(element: HTMLElement): void {
		this._element = element;
		DOM.clearNode(element);

		const page = DOM.append(element, DOM.$('.help-not-found-page'));
		const container = DOM.append(page, DOM.$('.help-not-found-container'));
		
		const header = DOM.append(container, DOM.$('.help-not-found-header'));
		DOM.append(header, DOM.$('h2', {}, `No items were found for "${this.searchQuery}".`));

		if (this.suggestions.length > 0) {
			DOM.append(container, DOM.$('p', {}, 'However, this documentation is available:'));

			const groupedSuggestions = this.groupByLanguage(this.suggestions);

			for (const [languageName, topics] of Object.entries(groupedSuggestions)) {
				const languageSection = DOM.append(container, DOM.$('.help-not-found-language-section'));
				DOM.append(languageSection, DOM.$('h3', {}, languageName));

				const list = DOM.append(languageSection, DOM.$('ul.help-not-found-list'));

				for (const suggestion of topics) {
					const item = DOM.append(list, DOM.$('li'));
					const link = DOM.append(item, DOM.$('a', { 
						href: '#',
						class: 'help-not-found-link'
					}, suggestion.topic));

					this._register(DOM.addDisposableListener(link, DOM.EventType.CLICK, async (e: MouseEvent) => {
						e.preventDefault();
						await this._commandService.executeCommand('erdos.help.showTopic', suggestion.languageId, suggestion.topic);
					}));
				}
			}
		} else {
			DOM.append(container, DOM.$('p', {}, 'No similar topics were found. Try a different search query.'));
		}
	}

	hideContent(dispose: boolean): void {
		if (this._element) {
			DOM.clearNode(this._element);
			this._element = undefined;
		}
	}

	activateFindWidget(): void {
		// Not applicable for not found display
	}

	deactivateFindWidget(): void {
		// Not applicable for not found display
	}

	private groupByLanguage(suggestions: SuggestedTopic[]): Record<string, SuggestedTopic[]> {
		const grouped: Record<string, SuggestedTopic[]> = {};
		
		for (const suggestion of suggestions) {
			if (!grouped[suggestion.languageName]) {
				grouped[suggestion.languageName] = [];
			}
			grouped[suggestion.languageName].push(suggestion);
		}

		return grouped;
	}
}

