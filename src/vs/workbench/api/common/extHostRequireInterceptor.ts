/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as performance from '../../../base/common/performance.js';
import { URI } from '../../../base/common/uri.js';
import { MainThreadTelemetryShape, MainContext } from './extHost.protocol.js';
import { ExtHostConfigProvider, IExtHostConfiguration } from './extHostConfiguration.js';
import { nullExtensionDescription } from '../../services/extensions/common/extensions.js';
import * as vscode from 'vscode';
import { ExtensionIdentifierMap } from '../../../platform/extensions/common/extensions.js';
import { IExtensionApiFactory, IExtensionRegistries } from './extHost.api.impl.js';
import { IExtHostRpcService } from './extHostRpcService.js';
import { IExtHostInitDataService } from './extHostInitDataService.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import { ExtensionPaths, IExtHostExtensionService } from './extHostExtensionService.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { escapeRegExpCharacters } from '../../../base/common/strings.js';

interface LoadFunction {
	(request: string): any;
}

interface IAlternativeModuleProvider {
	alternativeModuleName(name: string): string | undefined;
}

export interface INodeModuleFactory extends Partial<IAlternativeModuleProvider> {
	readonly nodeModuleName: string | string[];
	load(request: string, parent: URI, original: LoadFunction): any;
}

export abstract class RequireInterceptor {

	protected readonly _factories: Map<string, INodeModuleFactory>;
	protected readonly _alternatives: ((moduleName: string) => string | undefined)[];

	constructor(
		private _apiFactory: IExtensionApiFactory,
		private _extensionRegistry: IExtensionRegistries,
		@IInstantiationService private readonly _instaService: IInstantiationService,
		@IExtHostConfiguration private readonly _extHostConfiguration: IExtHostConfiguration,
		@IExtHostExtensionService private readonly _extHostExtensionService: IExtHostExtensionService,
		@IExtHostInitDataService private readonly _initData: IExtHostInitDataService,
		@ILogService private readonly _logService: ILogService,
	) {
		this._factories = new Map<string, INodeModuleFactory>();
		this._alternatives = [];
	}

	async install(): Promise<void> {

		this._installInterceptor();

		performance.mark('code/extHost/willWaitForConfig');
		const configProvider = await this._extHostConfiguration.getConfigProvider();
		performance.mark('code/extHost/didWaitForConfig');
		const extensionPaths = await this._extHostExtensionService.getExtensionPathIndex();

		this.register(new VSCodeNodeModuleFactory(this._apiFactory, extensionPaths, this._extensionRegistry, configProvider, this._logService));
		this.register(new ErdosNodeModuleFactory(this._instaService));
		this.register(this._instaService.createInstance(NodeModuleAliasingModuleFactory));
		if (this._initData.remote.isRemote) {
			this.register(this._instaService.createInstance(OpenNodeModuleFactory, extensionPaths, this._initData.environment.appUriScheme));
		}
	}

	protected abstract _installInterceptor(): void;

	public register(interceptor: INodeModuleFactory | IAlternativeModuleProvider): void {
		if ('nodeModuleName' in interceptor) {
			if (Array.isArray(interceptor.nodeModuleName)) {
				for (const moduleName of interceptor.nodeModuleName) {
					this._factories.set(moduleName, interceptor);
				}
			} else {
				this._factories.set(interceptor.nodeModuleName, interceptor);
			}
		}

		if (typeof interceptor.alternativeModuleName === 'function') {
			this._alternatives.push((moduleName) => {
				return interceptor.alternativeModuleName!(moduleName);
			});
		}
	}
}

//#region --- module renames

class NodeModuleAliasingModuleFactory implements IAlternativeModuleProvider {
	/**
	 * Map of aliased internal node_modules, used to allow for modules to be
	 * renamed without breaking extensions. In the form "original -> new name".
	 */
	private static readonly aliased: ReadonlyMap<string, string> = new Map([
		['vscode-ripgrep', '@vscode/ripgrep'],
		['vscode-windows-registry', '@vscode/windows-registry'],
	]);

	private readonly re?: RegExp;

	constructor(@IExtHostInitDataService initData: IExtHostInitDataService) {
		if (initData.environment.appRoot && NodeModuleAliasingModuleFactory.aliased.size) {
			const root = escapeRegExpCharacters(this.forceForwardSlashes(initData.environment.appRoot.fsPath));
			// decompose ${appRoot}/node_modules/foo/bin to ['${appRoot}/node_modules/', 'foo', '/bin'],
			// and likewise the more complex form ${appRoot}/node_modules.asar.unpacked/@vcode/foo/bin
			// to ['${appRoot}/node_modules.asar.unpacked/',' @vscode/foo', '/bin'].
			const npmIdChrs = `[a-z0-9_.-]`;
			const npmModuleName = `@${npmIdChrs}+\\/${npmIdChrs}+|${npmIdChrs}+`;
			const moduleFolders = 'node_modules|node_modules\\.asar(?:\\.unpacked)?';
			this.re = new RegExp(`^(${root}/${moduleFolders}\\/)(${npmModuleName})(.*)$`, 'i');
		}
	}

	public alternativeModuleName(name: string): string | undefined {
		if (!this.re) {
			return;
		}

		const result = this.re.exec(this.forceForwardSlashes(name));
		if (!result) {
			return;
		}

		const [, prefix, moduleName, suffix] = result;
		const dealiased = NodeModuleAliasingModuleFactory.aliased.get(moduleName);
		if (dealiased === undefined) {
			return;
		}

		console.warn(`${moduleName} as been renamed to ${dealiased}, please update your imports`);

		return prefix + dealiased + suffix;
	}

	private forceForwardSlashes(str: string) {
		return str.replace(/\\/g, '/');
	}
}

//#endregion

//#region --- vscode-module

class VSCodeNodeModuleFactory implements INodeModuleFactory {
	public readonly nodeModuleName = 'vscode';

	private readonly _extApiImpl = new ExtensionIdentifierMap<typeof vscode>();
	private _defaultApiImpl?: typeof vscode;

	constructor(
		private readonly _apiFactory: IExtensionApiFactory,
		private readonly _extensionPaths: ExtensionPaths,
		private readonly _extensionRegistry: IExtensionRegistries,
		private readonly _configProvider: ExtHostConfigProvider,
		private readonly _logService: ILogService,
	) {
	}

	public load(_request: string, parent: URI): any {

		// get extension id from filename and api for extension
		const ext = this._extensionPaths.findSubstr(parent);
		if (ext) {
			let apiImpl = this._extApiImpl.get(ext.identifier);
			if (!apiImpl) {
				apiImpl = this._apiFactory(ext, this._extensionRegistry, this._configProvider);
				this._extApiImpl.set(ext.identifier, apiImpl);
			}
			return apiImpl;
		}

		// fall back to a default implementation
		if (!this._defaultApiImpl) {
			let extensionPathsPretty = '';
			this._extensionPaths.forEach((value, index) => extensionPathsPretty += `\t${index} -> ${value.identifier.value}\n`);
			this._logService.warn(`Could not identify extension for 'vscode' require call from ${parent}. These are the extension path mappings: \n${extensionPathsPretty}`);
			this._defaultApiImpl = this._apiFactory(nullExtensionDescription, this._extensionRegistry, this._configProvider);
		}
		return this._defaultApiImpl;
	}
}

//#endregion

//#region --- erdos-module

import { IExtHostRuntime } from './extHostRuntime.js';
import { ExtHostContext } from './extHost.protocol.js';
import type { ExtHostLanguageFeatures } from './extHostLanguageFeatures.js';
import type { ExtHostWebviewPanels } from './extHostWebviewPanels.js';

class ErdosNodeModuleFactory implements INodeModuleFactory {
	public readonly nodeModuleName = 'erdos';

	private _api: any;

	constructor(
		private readonly _instaService: IInstantiationService
	) {
	}

	public load(_request: string, _parent: URI): any {
		if (!this._api) {
			const extHostRuntime = this._instaService.invokeFunction(accessor => accessor.get(IExtHostRuntime));
			const rpcService = this._instaService.invokeFunction(accessor => accessor.get(IExtHostRpcService));
			const extHostWebviewPanels = rpcService.getRaw(ExtHostContext.ExtHostWebviewPanels) as ExtHostWebviewPanels;

			this._api = {
				// Enums
				RuntimeState: {
					Uninitialized: 'uninitialized',
					Initializing: 'initializing',
					Starting: 'starting',
					Idle: 'idle',
					Busy: 'busy',
					Ready: 'ready',
					Offline: 'offline',
					Exited: 'exited'
				},
				RuntimeOnlineState: {
					Starting: 'starting',
					Idle: 'idle',
					Busy: 'busy'
				},
				RuntimeExitReason: {
					Unknown: 'unknown',
					Shutdown: 'shutdown',
					Error: 'error',
					ForcedQuit: 'forced_quit',
					StartupFailed: 'startup_failed',
					ExtensionHost: 'extension_host'
				},
				RuntimeCodeExecutionMode: {
					Interactive: 'interactive',
					NonInteractive: 'non-interactive',
					Transient: 'transient',
					Silent: 'silent'
				},
				RuntimeErrorBehavior: {
					Stop: 'stop',
					Continue: 'continue'
				},
				RuntimeCodeFragmentStatus: {
					Complete: 'complete',
					Incomplete: 'incomplete',
					Invalid: 'invalid',
					Unknown: 'unknown'
				},
				RuntimeClientType: {
					Variables: 'variables',
					Plot: 'plot',
					IPyWidget: 'ipywidget',
					Environment: 'environment',
					Help: 'help',
					Connection: 'connection',
					Lsp: 'lsp'
				},
				LanguageRuntimeMessageType: {
					Output: 'output',
					Result: 'result',
					Stream: 'stream',
					Input: 'input',
					Error: 'error',
					Prompt: 'prompt',
					State: 'state',
					CommOpen: 'comm_open',
					CommData: 'comm_data',
					CommClosed: 'comm_closed',
					IPyWidget: 'ipywidget',
					WebOutput: 'web_output'
				},
				LanguageRuntimeSessionChannel: {
					Kernel: 'kernel',
					LSP: 'lsp',
					Other: 'other'
				},
				LanguageRuntimeSessionMode: {
					Console: 0,
					Notebook: 1,
					Background: 2
				},
				ErdosOutputLocation: {
					Notebook: 'notebook',
					Console: 'console',
					Viewer: 'viewer',
					Plot: 'plot'
				},
				LanguageRuntimeStartupBehavior: {
					Immediate: 'immediate',
					Implicit: 'implicit',
					Explicit: 'explicit'
				},
				LanguageRuntimeSessionLocation: {
					Browser: 'browser',
					Workspace: 'workspace',
					Machine: 'machine'
				},
				// Runtime API
				runtime: {
					registerLanguageRuntimeManager(languageId: string, manager: any) {
						return extHostRuntime.registerLanguageRuntimeManager(languageId, manager);
					},
					async getActiveSessions() {
						return await extHostRuntime.getActiveSessions();
					},
					async getPreferredRuntime(languageId: string) {
						return await extHostRuntime.getPreferredRuntime(languageId);
					},
					async selectLanguageRuntime(languageId: string) {
						return await extHostRuntime.selectLanguageRuntime(languageId);
					},
					async executeCode(languageId: string, code: string, focus: boolean, allowIncomplete?: boolean, mode?: any, errorBehavior?: any, observer?: any, executionId?: string, batchId?: string) {
						return await extHostRuntime.executeCode(languageId, code, focus, allowIncomplete, mode, errorBehavior, observer, executionId, batchId);
					},
					onDidChangeForegroundSession(listener: (sessionId: string) => void) {
						return extHostRuntime.onDidChangeForegroundSession(listener);
					},
					onDidRegisterRuntime(listener: (runtime: any) => void) {
						return extHostRuntime.onDidRegisterRuntime(listener);
					}
				},
				get languages() {
					const extHostLanguageFeatures = rpcService.getRaw(ExtHostContext.ExtHostLanguageFeatures) as ExtHostLanguageFeatures;
					return {
						registerStatementRangeProvider(selector: any, provider: any) {
							return extHostLanguageFeatures.registerStatementRangeProvider(nullExtensionDescription, selector, provider);
						},
						registerHelpTopicProvider(selector: any, provider: any) {
							return extHostLanguageFeatures.registerHelpTopicProvider(nullExtensionDescription, selector, provider);
						}
					};
				},
				window: {
					createPreviewPanel(viewType: string, title: string, preserveFocus?: boolean, options?: any) {
						// Create webview panel using ExtHostWebviewPanels service
						// This maps to vscode.window.createWebviewPanel with ViewColumn.Beside
						const showOptions = { viewColumn: 2 /* ViewColumn.Beside */, preserveFocus: preserveFocus };
						return extHostWebviewPanels.createWebviewPanel(
							nullExtensionDescription,
							viewType,
							title,
							showOptions,
							options
						);
					},
					previewUrl(_url: any) {
						return undefined;
					},
					previewHtml(_path: string) {
						// Stub implementation
					},
					onDidChangeConsoleWidth(_listener: (width: number) => void) {
						return { dispose: () => { } };
					},
					getConsoleWidth() {
						return 80;
					}
				}
			};
		}
		return this._api;
	}
}

//#endregion

//#region --- opn/open-module

interface OpenOptions {
	wait: boolean;
	app: string | string[];
}

interface IOriginalOpen {
	(target: string, options?: OpenOptions): Thenable<any>;
}

interface IOpenModule {
	(target: string, options?: OpenOptions): Thenable<void>;
}

class OpenNodeModuleFactory implements INodeModuleFactory {

	public readonly nodeModuleName: string[] = ['open', 'opn'];

	private _extensionId: string | undefined;
	private _original?: IOriginalOpen;
	private _impl: IOpenModule;
	private _mainThreadTelemetry: MainThreadTelemetryShape;

	constructor(
		private readonly _extensionPaths: ExtensionPaths,
		private readonly _appUriScheme: string,
		@IExtHostRpcService rpcService: IExtHostRpcService,
	) {

		this._mainThreadTelemetry = rpcService.getProxy(MainContext.MainThreadTelemetry);
		const mainThreadWindow = rpcService.getProxy(MainContext.MainThreadWindow);

		this._impl = (target, options) => {
			const uri: URI = URI.parse(target);
			// If we have options use the original method.
			if (options) {
				return this.callOriginal(target, options);
			}
			if (uri.scheme === 'http' || uri.scheme === 'https') {
				return mainThreadWindow.$openUri(uri, target, { allowTunneling: true });
			} else if (uri.scheme === 'mailto' || uri.scheme === this._appUriScheme) {
				return mainThreadWindow.$openUri(uri, target, {});
			}
			return this.callOriginal(target, options);
		};
	}

	public load(request: string, parent: URI, original: LoadFunction): any {
		// get extension id from filename and api for extension
		const extension = this._extensionPaths.findSubstr(parent);
		if (extension) {
			this._extensionId = extension.identifier.value;
			this.sendShimmingTelemetry();
		}

		this._original = original(request);
		return this._impl;
	}

	private callOriginal(target: string, options: OpenOptions | undefined): Thenable<any> {
		this.sendNoForwardTelemetry();
		return this._original!(target, options);
	}

	private sendShimmingTelemetry(): void {
		if (!this._extensionId) {
			return;
		}
		type ShimmingOpenClassification = {
			owner: 'jrieken';
			comment: 'Know when the open-shim was used';
			extension: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The extension is question' };
		};
		this._mainThreadTelemetry.$publicLog2<{ extension: string }, ShimmingOpenClassification>('shimming.open', { extension: this._extensionId });
	}

	private sendNoForwardTelemetry(): void {
		if (!this._extensionId) {
			return;
		}
		type ShimmingOpenCallNoForwardClassification = {
			owner: 'jrieken';
			comment: 'Know when the open-shim was used';
			extension: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The extension is question' };
		};
		this._mainThreadTelemetry.$publicLog2<{ extension: string }, ShimmingOpenCallNoForwardClassification>('shimming.open.call.noForward', { extension: this._extensionId });
	}
}

//#endregion
