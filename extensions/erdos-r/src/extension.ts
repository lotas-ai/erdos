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

	const runFileViaIcon = vscode.commands.registerCommand('r.execInTerminal-icon', async (resource?: vscode.Uri) => {
		try {
			await executeRFileInTerminal(resource);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			LOGGER.appendLine(`[Run R File] ${message}`);
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

	context.subscriptions.push(runFileInConsole, runFileInTerminal, runFileViaIcon, runSelection);
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

	const runtimeMetadata = await getOrSelectRuntime();
	if (!runtimeMetadata) {
		throw new Error('Unable to locate an R runtime. Select an R interpreter and try again.');
	}

	const runtimeExtra = runtimeMetadata.extraRuntimeData as RMetadataExtra | undefined;
	const shellPath = resolveRShellPath(runtimeExtra);
	if (!shellPath) {
		throw new Error('Unable to determine the R executable path.');
	}

	const shellArgs = buildRShellArguments(shellPath, fileUri.fsPath);
	const workingDirectory = getWorkingDirectory(fileUri);

	const terminalOptions: vscode.TerminalOptions = {
		name: 'R: Run File',
		shellPath,
		shellArgs,
		cwd: workingDirectory
	};

	const terminal = vscode.window.createTerminal(terminalOptions);
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

async function getOrSelectRuntime(): Promise<erdos.LanguageRuntimeMetadata | undefined> {
	try {
		const preferred = await erdos.runtime.getPreferredRuntime('r');
		if (preferred) {
			return preferred;
		}

		return await erdos.runtime.selectLanguageRuntime('r');
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		LOGGER.appendLine(`[R Runtime] ${message}`);
		return undefined;
	}
}

function resolveRShellPath(extra?: RMetadataExtra): string | undefined {
	if (!extra) {
		return undefined;
	}

	const scriptCandidates: string[] = [];

	if (extra.binpath) {
		const rscriptName = process.platform === 'win32' ? 'Rscript.exe' : 'Rscript';
		scriptCandidates.push(path.join(extra.binpath, rscriptName));
	}

	if (extra.scriptpath) {
		scriptCandidates.push(extra.scriptpath);
	}

	return scriptCandidates.find(candidate => typeof candidate === 'string' && fs.existsSync(candidate));
}

function buildRShellArguments(shellPath: string, filePath: string): string[] {
	const executableName = path.basename(shellPath).toLowerCase();
	if (executableName.startsWith('rscript')) {
		return ['--vanilla', filePath];
	}

	return ['--vanilla', '--quiet', '-f', filePath];
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
