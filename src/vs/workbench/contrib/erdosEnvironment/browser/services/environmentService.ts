/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../../base/common/event.js';
import { ILanguageRuntimeService } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeMetadata, ILanguageRuntimeSession, LanguageRuntimeSessionMode } from '../../../../services/languageRuntime/common/languageRuntimeTypes.js';
import { ISessionManager } from '../../../../services/languageRuntime/common/sessionManager.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';

/**
 * Client type for environment operations
 */
enum RuntimeClientType {
	Environment = 'environment'
}

/**
 * Runtime client instance interface for the direct kernel system
 */
interface IRuntimeClientInstance<T = any, U = any> {
	client_id: string;
	client_type: string;
	listPackages(language: string): Promise<T[]>;
	installPackage(name: string, language: string, environmentType?: string): Promise<U>;
	uninstallPackage(name: string, language: string, environmentType?: string): Promise<U>;
	checkMissingPackages(fileContent: string, filePath: string): Promise<string[]>;
}

/**
 * Generic package information
 */
interface PackageInfo {
	name: string;
	version?: string;
	[key: string]: any;
}

import { 
	IErdosEnvironmentService, 
	IPythonEnvironment, 
	IRPackage, 
	IPythonPackage,
	PythonEnvironmentType 
} from '../../common/environmentTypes.js';

interface PythonRuntimeExtraData {
	pythonPath: string;
	ipykernelBundle?: unknown;
	externallyManaged?: boolean;
	supported?: boolean;
	environmentType?: string;
	environmentName?: string;
	environmentPath?: string;
	sysPrefix?: string;
	tools?: string[];
	workspaceFolder?: string;
	displayName?: string;
	description?: string;
	envKind?: string;
}

export class EnvironmentService extends Disposable implements IErdosEnvironmentService {
	
	declare readonly _serviceBrand: undefined;
	
	private readonly _onDidChangeEnvironments = this._register(new Emitter<void>());
	readonly onDidChangeEnvironments = this._onDidChangeEnvironments.event;
	
	private readonly _onDidChangePackages = this._register(new Emitter<string>());
	readonly onDidChangePackages = this._onDidChangePackages.event;
	
	private readonly _onDidChangeActiveEnvironment = this._register(new Emitter<string>());
	readonly onDidChangeActiveEnvironment = this._onDidChangeActiveEnvironment.event;
	
	// Debug counters to track event firing
	private environmentsChangedFireCount = 0;
	private activeEnvironmentChangedFireCount = 0;
	
	private _pythonEnvironmentsCache: IPythonEnvironment[] = [];
	private _rPackagesCache = new Map<string, IRPackage[]>();
	private _pythonPackagesCache = new Map<string, IPythonPackage[]>();
	
	// Track disposables for environment client message listeners
	private _clientMessageDisposables = new Map<string, import('../../../../../base/common/lifecycle.js').IDisposable>();
	
	constructor(
		@ILanguageRuntimeService private readonly languageRuntimeService: ILanguageRuntimeService,
		@ISessionManager private readonly sessionManager: ISessionManager,
		@ILogService private readonly logService: ILogService,
		@INotificationService private readonly notificationService: INotificationService
	) {
		super();
		
		this._register(this.languageRuntimeService.onDidRegisterRuntime((runtime) => {
			this.environmentsChangedFireCount++;
			
			// CRITICAL FIX: Clear the Python environments cache when new runtimes are registered
			// This ensures that the next call to getPythonEnvironments() will refresh and see all runtimes
			if (runtime.languageId === 'python') {
				this._pythonEnvironmentsCache = [];
			}
			
			this._onDidChangeEnvironments.fire();
		}));
		
		this._register(this.sessionManager.onDidChangeForegroundSession((session) => {
			if (session) {
				this.activeEnvironmentChangedFireCount++;
				this._onDidChangeActiveEnvironment.fire(session.runtimeMetadata.languageId);
			}
		}));
		
		// Listen for runtime sessions starting (following plots pattern)
		this._register(this.sessionManager.onDidStartSession((session: ILanguageRuntimeSession) => {
			this.attachToRuntimeSession(session);
		}));
		
		this.initializeEnvironments();
	}
	
	override dispose(): void {
		// Clean up all client message disposables
		for (const disposable of this._clientMessageDisposables.values()) {
			disposable.dispose();
		}
		this._clientMessageDisposables.clear();
		
		super.dispose();
	}
	
	/**
	 * Get or create an environment client for the given session.
	 * Creates a wrapper with JSON-RPC methods to communicate with the kernel via the comm channel.
	 */
	private getOrCreateEnvironmentClient(client: any, runtimeId: string, languageId: string): IRuntimeClientInstance {
		// Store of pending requests waiting for responses
		const pendingRequests = new Map<string, { resolve: (value: any) => void; reject: (error: any) => void; timeout: any }>();
		
		const session = this.sessionManager.getConsoleSessionForRuntime(runtimeId);
		if (!session) {
			throw new Error(`No session found for runtime: ${runtimeId}`);
		}
		
		// Create a unique key for this client's message listener
		const clientKey = `${runtimeId}-${client.clientId}`;
		
		// Dispose of any existing listener for this client to prevent leaks
		const existingDisposable = this._clientMessageDisposables.get(clientKey);
		if (existingDisposable) {
			existingDisposable.dispose();
		}
		
		// Subscribe to runtime messages to listen for comm_data responses
		const messageDisposable = session.onDidReceiveRuntimeMessage((msg: any) => {
			// Check for comm_data responses with our channel ID
			// Note: Jupyter wire protocol uses 'comm_msg', but erdos standardizes to 'comm_data'
			if (msg.type === 'comm_data' && msg.comm_id === client.clientId) {
				// Ark-style response format: {method: "..._reply", result: ..., id: "..."} or {error: "...", id: "..."}
				if (msg.data?.id) {
					const pending = pendingRequests.get(msg.data.id);
					if (pending) {
						clearTimeout(pending.timeout);
						pendingRequests.delete(msg.data.id);
						
						if (msg.data.error) {
							pending.reject(new Error(msg.data.error));
						} else {
							pending.resolve(msg.data.result);
						}
					}
				}
			}
		});
		
		// Store the disposable so we can clean it up later
		this._clientMessageDisposables.set(clientKey, messageDisposable);
		
		const sendRequest = (method: string, params: any, timeoutMs: number = 30000): Promise<any> => {
			return new Promise((resolve, reject) => {
				const requestId = Math.random().toString(36).substring(7);
				
				// Ark-style format (not JSON-RPC 2.0)
				const request = {
					method,
					params,
					id: requestId
				};
				
				const timeout = setTimeout(() => {
					pendingRequests.delete(requestId);
					reject(new Error(`Request ${method} timed out after ${timeoutMs}ms`));
				}, timeoutMs);
				
				pendingRequests.set(requestId, { resolve, reject, timeout });
				client.send(request);
			});
		};
		
		// Create a wrapper that provides listPackages, installPackage, uninstallPackage, and checkMissingPackages methods
		const wrapper: IRuntimeClientInstance = {
			client_id: client.clientId,
			client_type: client.client_type,
			
			listPackages: async (language: string): Promise<any[]> => {
				try {
					const result = await sendRequest('list_packages', {
						package_type: language
					});
					return result || [];
				} catch (error) {
					return [];
				}
			},
			
			installPackage: async (name: string, language: string, environmentType?: string): Promise<any> => {
				try {
					const result = await sendRequest('install_package', {
						package_name: name,
						package_type: language,
						environment_type: environmentType
					});
					return result || { success: false, error: 'No result returned' };
				} catch (error) {
					return { success: false, error: String(error) };
				}
			},
			
			uninstallPackage: async (name: string, language: string, environmentType?: string): Promise<any> => {
				try {
					const result = await sendRequest('uninstall_package', {
						package_name: name,
						package_type: language,
						environment_type: environmentType
					});
					return result || { success: false, error: 'No result returned' };
				} catch (error) {
					return { success: false, error: String(error) };
				}
			},
			
			checkMissingPackages: async (fileContent: string, filePath: string): Promise<string[]> => {
				try {
					const result = await sendRequest('check_missing_packages', {
						file_content: fileContent,
						file_path: filePath
					});
					return result?.missing_packages || [];
				} catch (error) {
					return [];
				}
			}
		};
		
		return wrapper;
	}
	
	/**
	 * Wait for a client to be ready. With the direct kernel system, clients are ready immediately after creation.
	 */
	private async waitForClientReady(client: any, timeoutMs: number): Promise<void> {
		// Direct kernel system clients are ready immediately after creation
		// No waiting needed
		return Promise.resolve();
	}
	
	private async waitForSessionReady(session: any, timeoutMs: number = 15000): Promise<void> {
		if (session.dynState && !session.dynState.busy) {
			return;
		}
		
		return new Promise<void>((resolve, reject) => {
			let disposed = false;
			let checkCount = 0;
			const maxChecks = Math.floor(timeoutMs / 500);
			
			const timeoutHandle = setTimeout(() => {
				if (!disposed) {
					disposed = true;
					reject(new Error(`Session ${session.sessionId} did not become idle within ${timeoutMs}ms`));
				}
			}, timeoutMs);
			
			const checkInterval = setInterval(() => {
				if (disposed) {
					clearInterval(checkInterval);
					return;
				}
				
				checkCount++;
				
				try {
					if (session.dynState && !session.dynState.busy) {
						disposed = true;
						clearTimeout(timeoutHandle);
						clearInterval(checkInterval);
						resolve();
					} else if (checkCount >= maxChecks) {
						disposed = true;
						clearTimeout(timeoutHandle);
						clearInterval(checkInterval);
						reject(new Error(`Session ${session.sessionId} still not idle after ${maxChecks} checks`));
					}
				} catch (error) {
					// Continue checking, don't fail on individual check errors
				}
			}, 500);
		});
	}
	
	private async initializeEnvironments(): Promise<void> {
		await this.refreshPythonEnvironments();
	}
	
	private attachToRuntimeSession(session: any): void {
		if (!session) {
			this.logService.error(`[ErdosEnvironmentService] Received null session.`);
			return;
		}

		// Create environment client for this session (async operation)
		this.createEnvironmentClientForSession(session).then(() => {
			// Trigger refresh for packages after client is created
			const languageId = session.runtimeMetadata.languageId;
			if (languageId === 'r') {
				this.refreshRPackages(session.runtimeMetadata.runtimeId).catch(error => {
					this.logService.error(`Failed to refresh R packages for ${session.sessionId}: ${error}`);
				});
			} else if (languageId === 'python') {
				this.refreshPythonPackages(session.runtimeMetadata.runtimeId).catch(error => {
					// Extract proper error message, handling nested objects
					let errorMessage: string;
					if (error instanceof Error) {
						errorMessage = error.message;
					} else if (error && typeof error === 'object' && 'message' in error) {
						errorMessage = typeof error.message === 'string' ? error.message : JSON.stringify(error.message);
					} else {
						errorMessage = String(error);
					}
					
					const errorDetails = JSON.stringify(error, Object.getOwnPropertyNames(error));
					this.logService.error(`Failed to refresh Python packages for ${session.sessionId}:`);
					this.logService.error(`  Message: ${errorMessage}`);
					this.logService.error(`  Details: ${errorDetails}`);
				});
			}
		}).catch(error => {
			this.logService.error(`Failed to attach environment client to runtime ${session.sessionId}: ${error}`);
		});
	}
	
	private async createEnvironmentClientForSession(session: any): Promise<void> {
		
		try {
			const existingClients: IRuntimeClientInstance<any, any>[] = await session.listClients(RuntimeClientType.Environment);
			
			if (existingClients.length > 1) {
				const clientIds = existingClients.map((client: IRuntimeClientInstance<any, any>) => client.client_id).join(', ');
				this.logService.warn(
					`Session ${session.dynState.sessionName} has multiple environment clients: ` +
					`${clientIds}`);
			}
			
			// Use the most recently created client (last in array) for consistency
			const client = existingClients.length > 0 ?
				existingClients[existingClients.length - 1] :
				await session.createClient(RuntimeClientType.Environment, {});
			
			if (!client) {
				this.logService.error(`Failed to create environment client for session ${session.sessionId}`);
				return;
			}
			
			
		} catch (error) {
			this.logService.error(`Failed to create environment client for runtime ${session.sessionId}: ${error}`);
			throw error;
		}
	}
	
	async getPythonEnvironments(): Promise<IPythonEnvironment[]> {
		if (this._pythonEnvironmentsCache.length === 0) {
			await this.refreshPythonEnvironmentsInternal(false); // Don't fire event to avoid infinite loop
		}
		return this._pythonEnvironmentsCache;
	}
	
	async refreshPythonEnvironments(): Promise<void> {
		await this.refreshPythonEnvironmentsInternal(true); // Fire event for external refresh calls
	}
	
	private async refreshPythonEnvironmentsInternal(fireEvent: boolean): Promise<void> {
		
		const allRuntimes = this.languageRuntimeService.registeredRuntimes;
		
		const pythonRuntimes = allRuntimes.filter(runtime => runtime.languageId === 'python');
		
		const environments: IPythonEnvironment[] = [];
		const activeSession = this.sessionManager.getConsoleSessionForLanguage('python');
		
		// Convert registered runtimes to environment objects
		for (const runtime of pythonRuntimes) {
			const extraData = runtime.extraRuntimeData as PythonRuntimeExtraData | undefined;
			const environment: IPythonEnvironment = {
				name: extraData?.environmentName || runtime.runtimeName,
				path: runtime.runtimePath,
				type: this.mapPythonEnvironmentType(runtime),
				version: runtime.languageVersion,
				isActive: activeSession?.runtimeMetadata.runtimeId === runtime.runtimeId,
				runtimeId: runtime.runtimeId,
				displayName: extraData?.displayName || runtime.runtimeName,
				description: extraData?.description,
				environmentPath: extraData?.environmentPath,
				sysPrefix: extraData?.sysPrefix,
				tools: extraData?.tools || [],
				workspaceFolder: extraData?.workspaceFolder
			};
			environments.push(environment);
		}

		this._pythonEnvironmentsCache = environments;

		if (fireEvent) {
			this.environmentsChangedFireCount++;
			this._onDidChangeEnvironments.fire();
		}
	}
	
	private mapPythonEnvironmentType(runtimeMetadata: ILanguageRuntimeMetadata): PythonEnvironmentType {
		// Extract environment type from runtime metadata's extraRuntimeData
		const extraData = runtimeMetadata.extraRuntimeData as PythonRuntimeExtraData | undefined;
		
		if (extraData?.environmentType) {
			// Map from Python extension API values to our PythonEnvironmentType enum for UI display
			// Python extension API returns only: 'Conda', 'VirtualEnvironment', 'Unknown'
			switch (extraData.environmentType) {
				case 'Conda':
					return PythonEnvironmentType.Conda;
				case 'VirtualEnvironment':
					return PythonEnvironmentType.VirtualEnv;
				case 'Unknown':
					return PythonEnvironmentType.Unknown;
			}
		}
		
		// If no environment type data available, return Unknown
		return PythonEnvironmentType.Unknown;
	}

	private getEnvironmentTypeForRuntime(runtimeId: string): string | undefined {
		// Find the runtime metadata for the given runtimeId
		const runtime = this.languageRuntimeService.getRegisteredRuntime(runtimeId);
		if (!runtime) {
			return undefined;
		}

		const extraData = runtime.extraRuntimeData as PythonRuntimeExtraData | undefined;
		return extraData?.environmentType;
	}
	
	getActiveEnvironment(languageId: 'python' | 'r'): ILanguageRuntimeMetadata | undefined {
		const activeSession = this.sessionManager.getConsoleSessionForLanguage(languageId);
		return activeSession?.runtimeMetadata;
	}

	async switchToEnvironment(environment: IPythonEnvironment): Promise<void> {
		if (!environment.runtimeId) {
			throw new Error('Cannot switch to environment: no runtime ID available');
		}

		try {
			// Check if runtime is registered
			const runtime = this.languageRuntimeService.getRegisteredRuntime(environment.runtimeId);
			if (!runtime) {
				this.logService.error(`[EnvironmentService] Runtime not found: ${environment.runtimeId}`);
				throw new Error(`Runtime ${environment.runtimeId} is not registered`);
			}
			// Check if there's already a console session for this runtime
			const existingSession = this.sessionManager.getConsoleSessionForRuntime(environment.runtimeId);
			if (existingSession) {
				this.sessionManager.foregroundSession = existingSession;
				return;
			}

			// Start a new console session for this environment
			const newSession = await this.sessionManager.startNewRuntimeSession(
				environment.runtimeId,
				`Python (${environment.name})`,
				LanguageRuntimeSessionMode.Console,
				undefined // notebookUri
			);

			// Set as foreground session
			this.sessionManager.foregroundSession = newSession;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			const errorStack = error instanceof Error ? error.stack : undefined;
			this.logService.error(`[EnvironmentService] Failed to switch to Python environment ${environment.name}: ${errorMessage}`);
			if (errorStack) {
				this.logService.error(`[EnvironmentService] Error stack:`, errorStack);
			}
			throw new Error(`Failed to switch to environment ${environment.name}: ${errorMessage}`);
		}
	}
	
	async getRPackages(runtimeId?: string, forceRefresh = false): Promise<IRPackage[]> {
		const targetRuntimeId = runtimeId || this.getActiveEnvironment('r')?.runtimeId;
		if (!targetRuntimeId) {
			return [];
		}
		
		const hasCache = this._rPackagesCache.has(targetRuntimeId);
		
		if (!hasCache || forceRefresh) {
			await this.refreshRPackages(targetRuntimeId);
		}
		
		return this._rPackagesCache.get(targetRuntimeId) || [];
	}
	
	async refreshRPackages(runtimeId?: string): Promise<void> {
		const targetRuntimeId = runtimeId || this.getActiveEnvironment('r')?.runtimeId;
		if (!targetRuntimeId) {
			return;
		}
		
		try {
			const session = this.sessionManager.getConsoleSessionForRuntime(targetRuntimeId);
			if (!session) {
				const allSessions = this.sessionManager.activeSessions.map(s => ({
					id: s.sessionId,
					runtimeId: s.runtimeMetadata.runtimeId,
					mode: s.metadata.sessionMode,
					busy: s.dynState?.busy || false
				}));
				this.logService.warn(`No CONSOLE session found for runtime ${targetRuntimeId}. All sessions: ${JSON.stringify(allSessions)}`);
				return;
			}
			
			const existingClients = await session.listClients(RuntimeClientType.Environment);
			// Use the most recently created client (last in array) for consistency with help service
			const client = existingClients.length > 0 ?
				existingClients[existingClients.length - 1] :
				await session.createClient(RuntimeClientType.Environment, {});
			
			if (!client) {
				this.logService.warn(`No environment client available for runtime ${targetRuntimeId}`);
				return;
			}
			
			const environmentClient = this.getOrCreateEnvironmentClient(client, targetRuntimeId, session.runtimeMetadata.languageId);
			
			// Wait for client and session to be ready if this is a new client
			if (existingClients.length === 0) {
				await this.waitForClientReady(client, 10000);
				await this.waitForSessionReady(session, 15000);
			}
			
			const packages = await environmentClient.listPackages('r');
			
			const rPackages: IRPackage[] = packages.map((pkg: PackageInfo) => ({
				name: pkg.name,
				version: pkg.version || 'unknown',
				description: pkg.description,
				isLoaded: pkg.is_loaded || false,
				location: pkg.location || '',
				priority: pkg.priority ? String(pkg.priority) : undefined
			}));
			
			this._rPackagesCache.set(targetRuntimeId, rPackages);
			this._onDidChangePackages.fire(targetRuntimeId);
		} catch (error) {
			let errorMessage: string;
			if (error instanceof Error) {
				errorMessage = error.message;
			} else if (error && typeof error === 'object' && 'message' in error) {
				errorMessage = typeof error.message === 'string' ? error.message : JSON.stringify(error.message);
			} else {
				errorMessage = String(error);
			}
			
			// Don't show error notifications for "kernel not started" - this is expected during startup
			if (errorMessage.includes('kernel not started') || errorMessage.includes('Cannot list clients')) {
				this.logService.debug(`R kernel not ready yet for runtime ${targetRuntimeId}: ${errorMessage}`);
				return; // Silently fail - kernel will be ready later
			}
			
			this.logService.error(`Failed to refresh R packages: ${errorMessage}`);
			this.notificationService.error(`Failed to refresh R packages: ${errorMessage}`);
		}
	}
	
	async getPythonPackages(runtimeId?: string, forceRefresh = false): Promise<IPythonPackage[]> {
		const targetRuntimeId = runtimeId || this.getActiveEnvironment('python')?.runtimeId;
		if (!targetRuntimeId) {
			return [];
		}
		
		const hasCache = this._pythonPackagesCache.has(targetRuntimeId);
		
		if (!hasCache || forceRefresh) {
			await this.refreshPythonPackages(targetRuntimeId);
		}
		
		return this._pythonPackagesCache.get(targetRuntimeId) || [];
	}
	
	async refreshPythonPackages(runtimeId?: string): Promise<void> {
		const targetRuntimeId = runtimeId || this.getActiveEnvironment('python')?.runtimeId;
		if (!targetRuntimeId) {
			return;
		}
		
		try {
			const session = this.sessionManager.getConsoleSessionForRuntime(targetRuntimeId);
			if (!session) {
				const allSessions = this.sessionManager.activeSessions.map(s => ({
					id: s.sessionId,
					runtimeId: s.runtimeMetadata.runtimeId,
					mode: s.metadata.sessionMode,
					busy: s.dynState?.busy || false
				}));
				this.logService.warn(`No CONSOLE session found for runtime ${targetRuntimeId}. All sessions: ${JSON.stringify(allSessions)}`);
				return;
			}
			
			// Get or create the environment client for this session
			const existingClients = await session.listClients(RuntimeClientType.Environment);
			// Use the most recently created client (last in array) for consistency with help service
			const client = existingClients.length > 0 ?
				existingClients[existingClients.length - 1] :
				await session.createClient(RuntimeClientType.Environment, {});
			
			if (!client) {
				this.logService.warn(`No environment client available for runtime ${targetRuntimeId}`);
				return;
			}
			
			const environmentClient = this.getOrCreateEnvironmentClient(client, targetRuntimeId, session.runtimeMetadata.languageId);
			
			// Wait for client and session to be ready if this is a new client
			if (existingClients.length === 0) {
				await this.waitForClientReady(client, 10000);
				await this.waitForSessionReady(session, 15000);
			}
			const packages = await environmentClient.listPackages('python');
			const pythonPackages: IPythonPackage[] = packages.map((pkg: PackageInfo) => ({
				name: pkg.name,
				version: pkg.version || 'unknown',
				description: pkg.description,
				location: pkg.location,
				editable: pkg.editable || false
			}));
			
			this._pythonPackagesCache.set(targetRuntimeId, pythonPackages);
			this._onDidChangePackages.fire(targetRuntimeId);
		} catch (error) {
			let errorMessage: string;
			if (error instanceof Error) {
				errorMessage = error.message;
			} else if (error && typeof error === 'object' && 'message' in error) {
				errorMessage = typeof error.message === 'string' ? error.message : JSON.stringify(error.message);
			} else {
				errorMessage = String(error);
			}
			
			this.logService.error(`Failed to refresh Python packages: ${errorMessage}`);
			this.notificationService.error(`Failed to refresh Python packages: ${errorMessage}`);
		}
	}
	
	async installPythonPackage(packageName: string, runtimeId?: string): Promise<void> {
		const targetRuntimeId = runtimeId || this.getActiveEnvironment('python')?.runtimeId;
		if (!targetRuntimeId) {
			throw new Error('No Python runtime available');
		}
		
		// Try console session first, then any active session
		let session = this.sessionManager.getConsoleSessionForRuntime(targetRuntimeId);
		if (!session) {
			const allSessions = this.sessionManager.activeSessions;
			session = allSessions.find(s => s.runtimeMetadata.runtimeId === targetRuntimeId);
			if (!session) {
				const sessionInfo = allSessions.map(s => ({
					id: s.sessionId,
					runtimeId: s.runtimeMetadata.runtimeId,
					mode: s.metadata.sessionMode,
					busy: s.dynState?.busy || false
				}));
				throw new Error(`No active session found for runtime ${targetRuntimeId}. All sessions: ${JSON.stringify(sessionInfo)}`);
			}
		}
		
		const existingClients = await session.listClients(RuntimeClientType.Environment);
		// Use the most recently created client (last in array) for consistency
		const client = existingClients.length > 0 ?
			existingClients[existingClients.length - 1] :
			await session.createClient(RuntimeClientType.Environment, {});
		
		if (!client) {
			throw new Error(`No environment client available for runtime ${targetRuntimeId}`);
		}
		
		const environmentClient = this.getOrCreateEnvironmentClient(client, targetRuntimeId, session.runtimeMetadata.languageId);
		
		// Get environment type from runtime metadata
		const environmentType = this.getEnvironmentTypeForRuntime(targetRuntimeId);
		
		const result = await environmentClient.installPackage(packageName, 'python', environmentType);
		if (!result.success) {
			throw new Error(result.error || 'Failed to install package');
		}
		
		await this.refreshPythonPackages(targetRuntimeId);
	}
	
	async uninstallPythonPackage(packageName: string, runtimeId?: string): Promise<void> {
		const targetRuntimeId = runtimeId || this.getActiveEnvironment('python')?.runtimeId;
		if (!targetRuntimeId) {
			throw new Error('No Python runtime available');
		}
		
		// Try console session first, then any active session
		let session = this.sessionManager.getConsoleSessionForRuntime(targetRuntimeId);
		if (!session) {
			const allSessions = this.sessionManager.activeSessions;
			session = allSessions.find(s => s.runtimeMetadata.runtimeId === targetRuntimeId);
			if (!session) {
				const sessionInfo = allSessions.map(s => ({
					id: s.sessionId,
					runtimeId: s.runtimeMetadata.runtimeId,
					mode: s.metadata.sessionMode,
					busy: s.dynState?.busy || false
				}));
				throw new Error(`No active session found for runtime ${targetRuntimeId}. All sessions: ${JSON.stringify(sessionInfo)}`);
			}
		}
		
		const existingClients = await session.listClients(RuntimeClientType.Environment);
		// Use the most recently created client (last in array) for consistency
		const client = existingClients.length > 0 ?
			existingClients[existingClients.length - 1] :
			await session.createClient(RuntimeClientType.Environment, {});
		
		if (!client) {
			throw new Error(`No environment client available for runtime ${targetRuntimeId}`);
		}
		
		const environmentClient = this.getOrCreateEnvironmentClient(client, targetRuntimeId, session.runtimeMetadata.languageId);
		
		// Get environment type from runtime metadata
		const environmentType = this.getEnvironmentTypeForRuntime(targetRuntimeId);
		
		const result = await environmentClient.uninstallPackage(packageName, 'python', environmentType);
		if (!result.success) {
			throw new Error(result.error || 'Failed to uninstall package');
		}
		
		await this.refreshPythonPackages(targetRuntimeId);
	}
	
	async installRPackage(packageName: string, runtimeId?: string): Promise<void> {
		const targetRuntimeId = runtimeId || this.getActiveEnvironment('r')?.runtimeId;
		if (!targetRuntimeId) {
			throw new Error('No R runtime available');
		}

		// Try console session first, then any active session
		let session = this.sessionManager.getConsoleSessionForRuntime(targetRuntimeId);
		if (!session) {
			const allSessions = this.sessionManager.activeSessions;
			session = allSessions.find(s => s.runtimeMetadata.runtimeId === targetRuntimeId);
			if (!session) {
				const sessionInfo = allSessions.map(s => ({
					id: s.sessionId,
					runtimeId: s.runtimeMetadata.runtimeId,
					mode: s.metadata.sessionMode,
					busy: s.dynState?.busy || false
				}));
				throw new Error(`No active session found for runtime ${targetRuntimeId}. All sessions: ${JSON.stringify(sessionInfo)}`);
			}
		}
		
		const existingClients = await session.listClients(RuntimeClientType.Environment);
		// Use the most recently created client (last in array) for consistency
		const client = existingClients.length > 0 ?
			existingClients[existingClients.length - 1] :
			await session.createClient(RuntimeClientType.Environment, {});
		
		if (!client) {
			throw new Error(`No environment client available for runtime ${targetRuntimeId}`);
		}
		
		const environmentClient = this.getOrCreateEnvironmentClient(client, targetRuntimeId, session.runtimeMetadata.languageId);
		
		// R environments don't have the same type complexity as Python, but pass undefined for consistency
		const result = await environmentClient.installPackage(packageName, 'r', undefined);
		if (!result.success) {
			throw new Error(result.error || 'Failed to install package');
		}
		
		await this.refreshRPackages(targetRuntimeId);
	}
	
	async removeRPackage(packageName: string, runtimeId?: string): Promise<void> {
		const targetRuntimeId = runtimeId || this.getActiveEnvironment('r')?.runtimeId;
		if (!targetRuntimeId) {
			throw new Error('No R runtime available');
		}
		
		// Try console session first, then any active session
		let session = this.sessionManager.getConsoleSessionForRuntime(targetRuntimeId);
		if (!session) {
			const allSessions = this.sessionManager.activeSessions;
			session = allSessions.find(s => s.runtimeMetadata.runtimeId === targetRuntimeId);
			if (!session) {
				const sessionInfo = allSessions.map(s => ({
					id: s.sessionId,
					runtimeId: s.runtimeMetadata.runtimeId,
					mode: s.metadata.sessionMode,
					busy: s.dynState?.busy || false
				}));
				throw new Error(`No active session found for runtime ${targetRuntimeId}. All sessions: ${JSON.stringify(sessionInfo)}`);
			}
		}
		
		const existingClients = await session.listClients(RuntimeClientType.Environment);
		// Use the most recently created client (last in array) for consistency
		const client = existingClients.length > 0 ?
			existingClients[existingClients.length - 1] :
			await session.createClient(RuntimeClientType.Environment, {});
		
		if (!client) {
			throw new Error(`No environment client available for runtime ${targetRuntimeId}`);
		}
		
		const environmentClient = this.getOrCreateEnvironmentClient(client, targetRuntimeId, session.runtimeMetadata.languageId);
		
		// R environments don't have the same type complexity as Python, but pass undefined for consistency
		const result = await environmentClient.uninstallPackage(packageName, 'r', undefined);
		if (!result.success) {
			throw new Error(result.error || 'Failed to remove package');
		}
		
		await this.refreshRPackages(targetRuntimeId);
	}
	
	async checkMissingPackages(fileContent: string, filePath: string, languageId: 'python' | 'r', runtimeId?: string): Promise<string[]> {
		const targetRuntimeId = runtimeId || this.getActiveEnvironment(languageId)?.runtimeId;
		if (!targetRuntimeId) {
			throw new Error(`No ${languageId} runtime available`);
		}
		
		// Try to get any active session for this runtime (console, notebook, etc.)
		let session = this.sessionManager.getConsoleSessionForRuntime(targetRuntimeId);
		if (!session) {
			const allSessions = this.sessionManager.activeSessions;
			session = allSessions.find(s => s.runtimeMetadata.runtimeId === targetRuntimeId);
			if (!session) {
				throw new Error(`No active session found for runtime ${targetRuntimeId}`);
			}
		}
		
		const existingClients = await session.listClients(RuntimeClientType.Environment);
		const client = existingClients.length > 0 ?
			existingClients[existingClients.length - 1] :
			await session.createClient(RuntimeClientType.Environment, {});
		
		if (!client) {
			throw new Error(`No environment client available for runtime ${targetRuntimeId}`);
		}
		
		const environmentClient = this.getOrCreateEnvironmentClient(client, targetRuntimeId, session.runtimeMetadata.languageId);
		return await environmentClient.checkMissingPackages(fileContent, filePath);
	}
	
	async checkAndPromptMissingPackages(code: string, languageId: 'python' | 'r', runtimeId?: string): Promise<boolean> {
		try {
			const missingPackages = await this.checkMissingPackages(code, `<execution: ${languageId}>`, languageId, runtimeId);
			return missingPackages.length === 0;
		} catch (error) {
			return true;
		}
	}
}
