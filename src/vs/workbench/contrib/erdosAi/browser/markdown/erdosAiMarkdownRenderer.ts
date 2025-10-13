/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from '../../../../../base/browser/dom.js';
import { MarkdownRenderOptions, MarkedOptions } from '../../../../../base/browser/markdownRenderer.js';
import { getDefaultHoverDelegate } from '../../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { IMarkdownString } from '../../../../../base/common/htmlContent.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IMarkdownRendererOptions, IMarkdownRenderResult, MarkdownRenderer } from '../../../../../editor/browser/widget/markdownRenderer/browser/markdownRenderer.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import product from '../../../../../platform/product/common/product.js';
import { CodeLinkProcessor } from '../../../../services/erdosAiConversation/browser/codeLinkProcessor.js';

const allowedHtmlTags = [
	'b',
	'blockquote',
	'br',
	'code',
	'em',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'hr',
	'i',
	'li',
	'ol',
	'p',
	'pre',
	'strong',
	'sub',
	'sup',
	'table',
	'tbody',
	'td',
	'th',
	'thead',
	'tr',
	'ul',
	'a',
	'img',
	'span',
	'div',
];

/**
 * Markdown renderer for Erdos AI with sanitizer options needed for AI chat
 */
export class ErdosAiMarkdownRenderer extends MarkdownRenderer {
	constructor(
		options: IMarkdownRendererOptions | undefined,
		@ILanguageService languageService: ILanguageService,
		@IOpenerService openerService: IOpenerService,
		@IHoverService private readonly hoverService: IHoverService,
	) {
		super(options ?? {}, languageService, openerService);
	}

	override render(markdown: IMarkdownString | undefined, options?: MarkdownRenderOptions, markedOptions?: MarkedOptions): IMarkdownRenderResult {
		options = {
			...options,
			remoteImageIsAllowed: (_uri) => false,
			sanitizerOptions: {
				replaceWithPlaintext: true,
				allowedTags: allowedHtmlTags,
				allowedProductProtocols: [product.urlProtocol]
			},
			codeBlockRendererSync: (languageId: string, value: string) => {
				const codeElement = document.createElement('pre');
				codeElement.className = 'erdos-ai-code-block';
				
				const codeInner = document.createElement('code');
				codeInner.textContent = value;
				if (languageId) {
					codeInner.className = `language-${languageId}`;
				}
				
				codeElement.appendChild(codeInner);
				return codeElement;
			}
		};

		const result = super.render(markdown, options, markedOptions);

		const lastChild = result.element.lastChild;
		if (lastChild?.nodeType === Node.TEXT_NODE && lastChild.textContent?.trim()) {
			lastChild.replaceWith($('p', undefined, lastChild.textContent));
		}
		return this.attachCustomHover(result);
	}

	private attachCustomHover(result: IMarkdownRenderResult): IMarkdownRenderResult {
		const store = new DisposableStore();
		result.element.querySelectorAll('a').forEach((element) => {
			if (element.title) {
				const title = element.title;
				element.title = '';
				store.add(this.hoverService.setupManagedHover(getDefaultHoverDelegate('element'), element, title));
			}
		});

		return {
			element: result.element,
			dispose: () => {
				result.dispose();
				store.dispose();
			}
		};
	}

	protected override async openMarkdownLink(link: string, markdown: IMarkdownString) {
		if (link.startsWith('command:erdosAi.openFile?')) {
			try {
				const queryString = link.substring('command:erdosAi.openFile?'.length);
				const args = JSON.parse(decodeURIComponent(queryString));
				const filePath = Array.isArray(args) ? args[0] : undefined;
				if (typeof filePath === 'string' && filePath) {
					await CodeLinkProcessor.openFile(filePath);
					return;
				}
			} catch (error) {
				console.error('[ErdosAiMarkdownRenderer] Failed to handle erdosAi.openFile command link', error);
			}
		}

		// Delegate all other links to the default implementation so standard URLs open correctly
		return super.openMarkdownLink(link, markdown);
	}
}
