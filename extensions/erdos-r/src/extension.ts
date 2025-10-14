/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as erdos from 'erdos';
import * as path from 'path';
import * as fs from 'fs';
import { RLanguageManager } from './runtime';
import { RCompletionProvider } from './completionProvider';
import type { RMetadataExtra } from './runtime';

export const LOGGER = vscode.window.createOutputChannel('R Language Pack', { log: true });

export function activate(context: vscode.ExtensionContext) {
	const rRuntimeManager = new RLanguageManager();
	erdos.runtime.registerLanguageRuntimeManager('r', rRuntimeManager);
	
	// Register R completion provider for all R documents (files and console)
	const completionProvider = new RCompletionProvider();
	const completionRegistration = vscode.languages.registerCompletionItemProvider(
		[
			{ language: 'r' },
			{ language: 'r', scheme: 'inmemory' }
		],
		completionProvider
	);
	context.subscriptions.push(completionRegistration);

	const runFileInConsole = vscode.commands.registerCommand('r.execInConsole', async (resource?: vscode.Uri) => {
		try {
			await executeRFileInConsole(resource);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			LOGGER.appendLine(`[Run R File in Console] ${message}`);
			void vscode.window.showErrorMessage(message);
		}
	});

	const runFileInTerminal = vscode.commands.registerCommand('r.execInTerminal', async (resource?: vscode.Uri) => {
		try {
			await executeRFileInTerminal(resource);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			LOGGER.appendLine(`[Run R File in Terminal] ${message}`);
			void vscode.window.showErrorMessage(message);
		}
	});

	const runSelection = vscode.commands.registerCommand('r.execSelectionInConsole', async () => {
		try {
			await vscode.commands.executeCommand('workbench.action.erdosConsole.executeCode', { languageId: 'r' });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			LOGGER.appendLine(`[Run R Selection in Console] ${message}`);
			void vscode.window.showErrorMessage(message);
		}
	});

	context.subscriptions.push(runFileInConsole, runFileInTerminal, runSelection);
}

async function executeRFileInConsole(resource?: vscode.Uri): Promise<void> {
	const fileUri = await resolveTargetFile(resource);
	await ensureDocumentSaved(fileUri);

	const filePath = fileUri.fsPath;
	const command = `source(${JSON.stringify(filePath)})`;
	const batchId = createBatchId();

	await erdos.runtime.executeCode(
		'r',
		command,
		false,
		true,
		undefined,
		undefined,
		undefined,
		undefined,
		batchId,
		filePath
	);
}

async function executeRFileInTerminal(resource?: vscode.Uri): Promise<void> {
	const fileUri = await resolveTargetFile(resource);
	await ensureDocumentSaved(fileUri);

	const runtimeMetadata = await erdos.runtime.getPreferredRuntime('r');
	if (!runtimeMetadata) {
		throw new Error('No R interpreter found. Please start an R console to select an interpreter first.');
	}

	const runtimeExtra = runtimeMetadata.extraRuntimeData as RMetadataExtra | undefined;
	const rscriptPath = resolveRscriptPath(runtimeExtra);
	if (!rscriptPath) {
		throw new Error('Unable to determine R executable path from the selected runtime.');
	}

	const workingDirectory = getWorkingDirectory(fileUri);

	const terminal = vscode.window.createTerminal({
		name: 'R: Run File',
		cwd: workingDirectory
	});
	
	terminal.sendText(`${JSON.stringify(rscriptPath)} --vanilla ${JSON.stringify(fileUri.fsPath)}`);
	terminal.show();
}

async function resolveTargetFile(resource?: vscode.Uri): Promise<vscode.Uri> {
	if (resource instanceof vscode.Uri && resource.scheme === 'file') {
		return resource;
	}

	const editor = vscode.window.activeTextEditor;
	if (editor && editor.document.languageId === 'r' && editor.document.uri.scheme === 'file') {
		return editor.document.uri;
	}

	throw new Error('No active R file to run.');
}

async function ensureDocumentSaved(uri: vscode.Uri): Promise<vscode.TextDocument> {
	const document = await vscode.workspace.openTextDocument(uri);

	if (document.languageId !== 'r') {
		throw new Error('The selected file is not an R file.');
	}

	if (document.isUntitled) {
		throw new Error('Save the file before running it.');
	}

	if (document.isDirty) {
		const saved = await document.save();
		if (!saved) {
			throw new Error('File save was cancelled.');
		}
	}

	return document;
}

function resolveRscriptPath(extra?: RMetadataExtra): string | undefined {
	if (!extra) {
		return undefined;
	}

	// Try to find Rscript in the runtime's bin directory
	if (extra.binpath) {
		const rscriptName = process.platform === 'win32' ? 'Rscript.exe' : 'Rscript';
		const candidate = path.join(extra.binpath, rscriptName);
		if (fs.existsSync(candidate)) {
			return candidate;
		}
	}

	// Try scriptpath if available
	if (extra.scriptpath && fs.existsSync(extra.scriptpath)) {
		return extra.scriptpath;
	}

	return undefined;
}

function getWorkingDirectory(fileUri: vscode.Uri): string | undefined {
	const workspace = vscode.workspace.getWorkspaceFolder(fileUri);
	if (workspace) {
		return workspace.uri.fsPath;
	}

	return path.dirname(fileUri.fsPath);
}

function createBatchId(): string {
	return `${Date.now()}-${Math.floor(Math.random() * 0x100000000).toString(16)}`;
}
