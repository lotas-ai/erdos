/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as erdos from 'erdos';
import { RSession } from './session';
import { RLanguageManager } from './runtime';

/**
 * Provides runtime-based completions for R code.
 * Works in console (inmemory) and file editors when an R runtime session is active.
 * Uses ark's built-in R completion engine (utils package) to provide context-aware completions.
 */
export class RCompletionProvider implements vscode.CompletionItemProvider {
	
	async provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken,
		_context: vscode.CompletionContext
	): Promise<vscode.CompletionItem[] | vscode.CompletionList | undefined> {
		if (token.isCancellationRequested) {
			return undefined;
		}

		const session = await this.getActiveRSession();
		if (!session) {
			return undefined;
		}

		const text = document.getText();
		const offset = document.offsetAt(position);

		let completionResult: { matches: string[], cursorStart: number, cursorEnd: number };
		try {
			completionResult = await session.requestCompletion(text, offset);
		} catch (_err) {
			return undefined;
		}

		if (!completionResult.matches || completionResult.matches.length === 0) {
			return undefined;
		}

		const startPos = document.positionAt(completionResult.cursorStart);
		const endPos = document.positionAt(completionResult.cursorEnd);
		const range = new vscode.Range(startPos, endPos);

		const items: vscode.CompletionItem[] = completionResult.matches.map((match, index) => {
			const item = new vscode.CompletionItem(match, this.getCompletionKind(match));
			item.range = range;
			item.sortText = index.toString().padStart(5, '0');
			item.filterText = match;
			if (index === 0) {
				item.preselect = true;
			}
			return item;
		});

		const completionList = new vscode.CompletionList(items, false);
		return completionList;
	}

	private getCompletionKind(match: string): vscode.CompletionItemKind {
		if (match.endsWith('(')) {
			return vscode.CompletionItemKind.Function;
		}
		if (match.startsWith('.')) {
			return vscode.CompletionItemKind.Variable;
		}
		if (match.match(/^[A-Z]/)) {
			return vscode.CompletionItemKind.Class;
		}
		return vscode.CompletionItemKind.Text;
	}

	private async getActiveRSession(): Promise<RSession | undefined> {
		const sessions = await erdos.runtime.getActiveSessions();
		
		for (const session of sessions) {
			if (session.runtimeMetadata?.languageId === 'r') {
				const runtimeSession = RLanguageManager.getSessionById(session.sessionId);
				if (runtimeSession) {
					return runtimeSession;
				}
			}
		}
		
		return undefined;
	}
}

