/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IMarkdownString } from '../../../../base/common/htmlContent.js';
import { MarkdownRenderOptions, MarkedOptions } from '../../../../base/browser/markdownRenderer.js';
import { IMarkdownRenderResult } from '../../../../editor/browser/widget/markdownRenderer/browser/markdownRenderer.js';

export const IErdosAiMarkdownRenderer = createDecorator<IErdosAiMarkdownRenderer>('erdosAiMarkdownRenderer');

export interface IErdosAiMarkdownRenderer {
	readonly _serviceBrand: undefined;
	
	/**
	 * Render markdown content with Erdos AI specific options
	 */
	render(markdown: IMarkdownString | undefined, options?: MarkdownRenderOptions, markedOptions?: MarkedOptions): IMarkdownRenderResult;
}
