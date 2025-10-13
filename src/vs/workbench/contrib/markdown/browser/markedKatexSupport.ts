/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { importAMDNodeModule, resolveAmdNodeModulePath } from '../../../../amdX.js';
import { MarkdownSanitizerConfig } from '../../../../base/browser/markdownRenderer.js';
import { CodeWindow } from '../../../../base/browser/window.js';
import { Lazy } from '../../../../base/common/lazy.js';
import type * as marked from '../../../../base/common/marked/marked.js';
import { MarkedKatexExtension } from '../common/markedKatexExtension.js';

// Trusted MathML tags allowed in KaTeX output
const trustedMathMlTags = [
	'math', 'semantics', 'mrow', 'mi', 'mn', 'mo', 'ms', 'mspace', 'mtext', 'menclose', 'merror', 'mfenced',
	'mfrac', 'mpadded', 'mphantom', 'mroot', 'msqrt', 'mstyle', 'mmultiscripts', 'mover', 'mprescripts',
	'msub', 'msubsup', 'msup', 'munder', 'munderover', 'mtable', 'mtd', 'mtr', 'mlabeledtr', 'annotation', 'annotation-xml'
];

/**
 * Wrapper around VS Code's MarkedKatexExtension providing async loading and sanitization support.
 */
export class MarkedKatexSupport {

	private static _katex?: typeof import('katex').default;
	private static _katexPromise = new Lazy(async () => {
		this._katex = await importAMDNodeModule<typeof import('katex').default>('katex', 'dist/katex.min.js');
		return this._katex;
	});

	public static getSanitizerOptions(baseConfig: {
		readonly allowedTags: readonly string[];
		readonly allowedAttributes: readonly string[];
	}): MarkdownSanitizerConfig {
		return {
			allowedTags: [
				...baseConfig.allowedTags,
				...trustedMathMlTags,
			],
		};
	}

	public static getExtension(window: CodeWindow, options: MarkedKatexExtension.MarkedKatexOptions = {}): marked.MarkedExtension | undefined {
		if (!this._katex) {
			return undefined;
		}

		this.ensureKatexStyles(window);
		return MarkedKatexExtension.extension(this._katex, options);
	}

	public static async loadExtension(window: CodeWindow, options: MarkedKatexExtension.MarkedKatexOptions = {}): Promise<marked.MarkedExtension> {
		const katex = await this._katexPromise.value;
		this.ensureKatexStyles(window);
		return MarkedKatexExtension.extension(katex, options);
	}

	public static ensureKatexStyles(window: CodeWindow) {
		const doc = window.document;
		if (!doc.querySelector('link.katex')) {
			const katexStyle = document.createElement('link');
			katexStyle.classList.add('katex');
			katexStyle.rel = 'stylesheet';
			katexStyle.href = resolveAmdNodeModulePath('katex', 'dist/katex.min.css');
			doc.head.appendChild(katexStyle);
		}
	}
}
