/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as erdos from 'erdos';
import { LanguageClient } from 'vscode-languageclient/node';

export class AstExecutionRangeProvider implements erdos.StatementRangeProvider {
	constructor(
		private readonly languageClient?: LanguageClient
	) {}

	async provideStatementRange(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken
	): Promise<erdos.StatementRange | undefined> {
		if (!this.languageClient) {
			console.error('[AST Execution Range Provider] No LSP client available');
			return undefined;
		}

		try {
			// Try document symbols to find the enclosing statement
			const symbolResult = await this.findEnclosingSymbol(document, position, token);
			if (symbolResult) {
				return symbolResult;
			}

			// Try using hover to get the exact range
			const hoverResult = await this.languageClient.sendRequest<any>(
				'textDocument/hover',
				{
					textDocument: { uri: document.uri.toString() },
					position: { line: position.line, character: position.character }
				},
				token
			);

			if (hoverResult?.range) {
				const range = new vscode.Range(
					new vscode.Position(hoverResult.range.start.line, hoverResult.range.start.character),
					new vscode.Position(hoverResult.range.end.line, hoverResult.range.end.character)
				);
				const code = document.getText(range);
				return { range, code };
			}

			// Try using definition lookup to find the statement
			const definitionResult = await this.languageClient.sendRequest<any>(
				'textDocument/definition',
				{
					textDocument: { uri: document.uri.toString() },
					position: { line: position.line, character: position.character }
				},
				token
			);

			if (definitionResult && Array.isArray(definitionResult) && definitionResult.length > 0) {
				const def = definitionResult[0];
				if (def.range) {
					const range = new vscode.Range(
						new vscode.Position(def.range.start.line, def.range.start.character),
						new vscode.Position(def.range.end.line, def.range.end.character)
					);
					const code = document.getText(range);
					return { range, code };
				}
			}

		} catch (error) {
			console.error('[AST Execution Range Provider] LSP request failed:', error);
		}

		console.warn('[AST Execution Range Provider] Could not determine execution range from AST');
		return undefined;
	}

	private async findEnclosingSymbol(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken
	): Promise<erdos.StatementRange | undefined> {
		try {
			const symbols = await this.languageClient!.sendRequest<any>(
				'textDocument/documentSymbol',
				{
					textDocument: { uri: document.uri.toString() }
				},
				token
			);

			if (symbols && Array.isArray(symbols)) {
				const enclosingSymbol = this.findDeepestEnclosingSymbol(symbols, position);
				if (enclosingSymbol?.range) {
					const range = new vscode.Range(
						new vscode.Position(enclosingSymbol.range.start.line, enclosingSymbol.range.start.character),
						new vscode.Position(enclosingSymbol.range.end.line, enclosingSymbol.range.end.character)
					);
					const code = document.getText(range);
					return { range, code };
				}
			}
		} catch (error) {
			// Ignore and fall through
		}
		return undefined;
	}

	private findDeepestEnclosingSymbol(symbols: any[], position: vscode.Position): any | undefined {
		let deepest: any = undefined;
		let deepestDepth = -1;

		const search = (syms: any[], depth: number) => {
			for (const symbol of syms) {
				if (symbol.range) {
					const range = new vscode.Range(
						new vscode.Position(symbol.range.start.line, symbol.range.start.character),
						new vscode.Position(symbol.range.end.line, symbol.range.end.character)
					);
					
					if (range.contains(position) && depth > deepestDepth) {
						deepest = symbol;
						deepestDepth = depth;
					}
				}

				if (symbol.children && Array.isArray(symbol.children)) {
					search(symbol.children, depth + 1);
				}
			}
		};

		search(symbols, 0);
		return deepest;
	}
}

