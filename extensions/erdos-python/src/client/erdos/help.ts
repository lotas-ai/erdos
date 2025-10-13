/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as erdos from 'erdos';
import { LanguageClient } from 'vscode-languageclient/node';

export class HelpTopicProvider implements erdos.HelpTopicProvider {
	constructor(private readonly client: LanguageClient) {}

	async provideHelpTopic(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken
	): Promise<string | undefined> {
		const wordRange = document.getWordRangeAtPosition(position);
		if (!wordRange) {
			return undefined;
		}

		const word = document.getText(wordRange);
		if (!word) {
			return undefined;
		}

		try {
			const result = await this.client.sendRequest(
				'textDocument/hover',
				{
					textDocument: { uri: document.uri.toString() },
					position: { line: position.line, character: position.character }
				},
				token
			);

			if (result && typeof result === 'object' && 'contents' in result) {
				const contents = (result as any).contents;
				if (typeof contents === 'string') {
					const match = contents.match(/^(\w+(?:\.\w+)*)/);
					if (match) {
						return match[1];
					}
				} else if (contents && typeof contents === 'object' && 'value' in contents) {
					const value = contents.value;
					if (typeof value === 'string') {
						const match = value.match(/^(\w+(?:\.\w+)*)/);
						if (match) {
							return match[1];
						}
					}
				}
			}
		} catch (error) {
		}

		return word;
	}
}
