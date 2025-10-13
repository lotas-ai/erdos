/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as erdos from 'erdos';
import { Socket } from 'net';
import { LanguageClient, LanguageClientOptions, State, StreamInfo } from 'vscode-languageclient/node';
import { traceInfo, traceError } from '../logging';
import { ProgressReporting } from '../activation/progress';
import { AstExecutionRangeProvider } from './astExecutionRanges';
import { HelpTopicProvider } from './help';

const PYTHON_LANGUAGE = 'python';

class PromiseHandles<T> {
	public promise: Promise<T>;
	public resolve!: (value: T | PromiseLike<T>) => void;
	public reject!: (reason?: any) => void;

	constructor() {
		this.promise = new Promise<T>((resolve, reject) => {
			this.resolve = resolve;
			this.reject = reject;
		});
	}
}

export class LspClient implements vscode.Disposable {
	private client?: LanguageClient;
	private readonly outputChannel: vscode.LogOutputChannel;
	private readonly disposables: vscode.Disposable[] = [];

	constructor(
		private readonly version: string,
		private readonly clientOptions: LanguageClientOptions,
		private readonly metadata: erdos.RuntimeSessionMetadata,
		_sessionName: string,
		outputChannel: vscode.LogOutputChannel
	) {
		this.outputChannel = outputChannel;
	}

	async activate(port: number): Promise<LanguageClient> {
		this.disposables.forEach(d => d.dispose());
		this.disposables.length = 0;

		const serverOptions = async (): Promise<StreamInfo> => {
			const promiseHandle = new PromiseHandles<StreamInfo>();
			const socket = new Socket();

			socket.on('ready', () => {
				promiseHandle.resolve({
					reader: socket,
					writer: socket
				});
			});

			socket.on('error', (error) => {
				promiseHandle.reject(error);
			});

			socket.connect(port);
			return promiseHandle.promise;
		};

		const { notebookUri, workingDirectory } = this.metadata;

		this.clientOptions.documentSelector = notebookUri ?
			[{ language: 'python', pattern: notebookUri.fsPath }] :
			[
				{ language: 'python', scheme: 'untitled' },
				{ language: 'python', scheme: 'inmemory' },
				{ language: 'python', pattern: '**/*.py' }
			];

		this.clientOptions.notebookDocumentOptions = notebookUri ?
			{
				filterCells: (notebookDocument, cells) =>
					notebookUri.toString() === notebookDocument.uri.toString() ? cells : []
			} :
			{ filterCells: () => [] };

		this.clientOptions.outputChannel = this.outputChannel;

		if (notebookUri && this.clientOptions.initializationOptions) {
			this.clientOptions.initializationOptions.erdos = {
				working_directory: workingDirectory
			};
		}

		const message = `Creating Python ${this.version} language client (port ${port})`;
		traceInfo(message);
		this.outputChannel.appendLine(message);

		this.client = new LanguageClient(
			PYTHON_LANGUAGE,
			`Python Language Server (${this.version})`,
			serverOptions,
			this.clientOptions
		);

		return new Promise<LanguageClient>((resolve, reject) => {
			const handler = this.client!.onDidChangeState(event => {
				if (event.newState === State.Running) {
					handler.dispose();
					traceInfo(`Python (${this.version}) language client started successfully`);

					if (this.client) {
						this.registerErdosExtensions(this.client);
					}

					this.disposables.push(new ProgressReporting(this.client!));
					resolve(this.client!);
				} else if (event.newState === State.Stopped) {
					handler.dispose();
					const error = new Error('Python LSP client failed to start');
					traceError(error.message);
					reject(error);
				}
			});

			try {
				this.client!.start();
			} catch (error) {
				traceError(`Error starting client: ${error}`);
				reject(error);
			}
		});
	}

	async deactivate(): Promise<void> {
		if (!this.client) {
			this.outputChannel.appendLine('No client to stop');
			return;
		}

		this.outputChannel.appendLine('Stopping Python language client');
		return this.client.stop();
	}

	private registerErdosExtensions(client: LanguageClient): void {
		const statementRangeProvider = erdos.languages.registerStatementRangeProvider(
			'python',
			new AstExecutionRangeProvider(client)
		);
		this.disposables.push(statementRangeProvider);

		const helpTopicProvider = erdos.languages.registerHelpTopicProvider(
			'python',
			new HelpTopicProvider(client)
		);
		this.disposables.push(helpTopicProvider);
	}

	showOutput(): void {
		this.outputChannel.show();
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
	}
}

export class LspOutputChannelManager {
	private static instance_?: LspOutputChannelManager;
	private readonly channels = new Map<string, vscode.LogOutputChannel>();

	private constructor() { }

	static get instance(): LspOutputChannelManager {
		if (!LspOutputChannelManager.instance_) {
			LspOutputChannelManager.instance_ = new LspOutputChannelManager();
		}
		return LspOutputChannelManager.instance_;
	}

	getOutputChannel(sessionName: string, sessionMode: string): vscode.LogOutputChannel {
		const key = `${sessionName}-${sessionMode}`;
		let channel = this.channels.get(key);

		if (!channel) {
			const modeName = sessionMode.charAt(0).toUpperCase() + sessionMode.slice(1);
			channel = vscode.window.createOutputChannel(
				`${sessionName}: Python Language Server (${modeName})`,
				{ log: true }
			);
			this.channels.set(key, channel);
		}

		return channel;
	}
}

