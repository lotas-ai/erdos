/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import * as http from 'http';
import * as url from 'url';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

interface KernelInfo {
	id: string;
	process: ChildProcess;
	port: number;
	language: string;
	sessionId: string;
	tempDir: string;
}

interface KernelConfig {
	language: string;
	sessionId: string;
	argv?: string[];
	env?: Record<string, string>;
	cwd?: string;
}

const kernels = new Map<string, KernelInfo>();
const allocatedPorts = new Set<number>();
const MIN_PORT = 8000;
const MAX_PORT = 8999;

let managerServer: http.Server | undefined;
let managerPort: number | undefined;

export function activate(context: vscode.ExtensionContext) {
	startKernelManagerServer();

	context.subscriptions.push(
		vscode.commands.registerCommand('erdos.kernelManager.startKernel', async (config: KernelConfig) => {
			return await startKernel(config);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('erdos.kernelManager.stopKernel', async (kernelId: string) => {
			stopKernel(kernelId);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('erdos.kernelManager.listKernels', async () => {
			return Array.from(kernels.entries()).map(([id, info]) => ({
				id,
				port: info.port,
				language: info.language,
				sessionId: info.sessionId
			}));
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('erdos.kernelManager.getManagerPort', async () => {
			return managerPort;
		})
	);
}

async function startKernelManagerServer() {
	const port = await findFreePort();
	managerPort = port;

	managerServer = http.createServer(async (req, res) => {
		const parsedUrl = url.parse(req.url!, true);

		res.setHeader('Access-Control-Allow-Origin', '*');
		res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE');
		res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

		if (req.method === 'OPTIONS') {
			res.writeHead(204);
			res.end();
			return;
		}

		try {
			if (req.method === 'POST' && parsedUrl.pathname === '/kernels') {
				const body = await readBody(req);
				const config: KernelConfig = JSON.parse(body);
				
				const kernelInfo = await startKernel(config);

				res.writeHead(200, { 'Content-Type': 'application/json' });
				const response = {
					id: kernelInfo.id,
					port: kernelInfo.port,
					host: 'localhost'
				};
				res.end(JSON.stringify(response));
			} else if (req.method === 'DELETE' && parsedUrl.pathname?.startsWith('/kernels/')) {
				const kernelId = parsedUrl.pathname.split('/')[2];
				stopKernel(kernelId);

				res.writeHead(204);
				res.end();
			} else if (req.method === 'GET' && parsedUrl.pathname === '/kernels') {
				const list = Array.from(kernels.entries()).map(([id, info]) => ({
					id,
					port: info.port,
					language: info.language,
					sessionId: info.sessionId
				}));

				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(list));
			} else {
				res.writeHead(404);
				res.end();
			}
		} catch (error) {
			console.error('[KERNEL MANAGER] Error:', error);
			res.writeHead(500, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: String(error) }));
		}
	});

	managerServer.listen(port);
}

async function waitForWebSocketServer(port: number, timeoutMs: number): Promise<void> {
	const WebSocket = require('ws');
	const startTime = Date.now();
	let attempt = 0;
	
	while (Date.now() - startTime < timeoutMs) {
		attempt++;
		try {
			await new Promise<void>((resolve, reject) => {
				const ws = new WebSocket(`ws://localhost:${port}`);
				const timeout = setTimeout(() => {
					ws.close();
					reject(new Error('Connection timeout'));
				}, 1000);

				ws.on('open', () => {
					clearTimeout(timeout);
					ws.close();
					resolve();
				});

				ws.on('error', (err: Error) => {
					clearTimeout(timeout);
					reject(err);
				});
			});
			// Success!
			return;
		} catch (err) {
			// Wait before retrying
			await new Promise(resolve => setTimeout(resolve, 500));
		}
	}
	
	throw new Error(`Kernel WebSocket server failed to start within ${timeoutMs}ms`);
}

async function startKernel(config: KernelConfig): Promise<KernelInfo> {
	const kernelId = generateId();
	const port = await findFreePort();

	// Create temp directory for this kernel session
	const tempDir = path.join(os.tmpdir(), `erdos-kernel-${kernelId}`);
	await fs.promises.mkdir(tempDir, { recursive: true });

	let childProcess: ChildProcess;

	try {
		// Merge provided env with process.env
		const env = config.env ? { ...process.env, ...config.env } : { ...process.env };

		if (config.language === 'r') {
			// Use provided argv or default args
			const args = config.argv || ['ark', '--websocket-port', port.toString()];
			// Replace the first element (command) and use rest as args
			const command = args[0];
			const processArgs = args.slice(1).map(arg => 
				arg.replace('{websocket_port}', port.toString())
					.replace('{log_file}', path.join(tempDir, 'kernel.log'))
					.replace('{profile_file}', path.join(tempDir, 'profile.out'))
					.replace('{resource_dir}', tempDir)
			);
			
			childProcess = spawn(command, processArgs, {
				env,
				cwd: config.cwd
			});
		} else if (config.language === 'python') {
			if (!config.argv || config.argv.length === 0) {
				throw new Error('Python kernel requires argv to be specified');
			}
			
			const command = config.argv[0];
			const processArgs = config.argv.slice(1).map(arg => 
				arg.replace('{websocket_port}', port.toString())
					.replace('{log_file}', path.join(tempDir, 'kernel.log'))
					.replace('{resource_dir}', tempDir)
			);
			
			childProcess = spawn(command, processArgs, {
				env,
				cwd: config.cwd
			});
		} else {
			allocatedPorts.delete(port);
			throw new Error(`Unknown language: ${config.language}`);
		}

		childProcess.on('exit', (code) => {
			allocatedPorts.delete(port);
			kernels.delete(kernelId);
			cleanupTempDir(tempDir);
		});

		childProcess.on('error', (error) => {
			console.error(`[KERNEL MANAGER] Kernel ${kernelId} error:`, error);
			allocatedPorts.delete(port);
			kernels.delete(kernelId);
			cleanupTempDir(tempDir);
		});

		const info: KernelInfo = { id: kernelId, process: childProcess, port, language: config.language, sessionId: config.sessionId, tempDir };
		kernels.set(kernelId, info);
		
		// Wait for the kernel WebSocket server to be ready
		await waitForWebSocketServer(port, 30000); // Wait up to 30 seconds

		return info;
	} catch (err) {
		allocatedPorts.delete(port);
		throw err;
	}
}

function stopKernel(kernelId: string) {
	const info = kernels.get(kernelId);
	if (info) {
		info.process.kill();
		allocatedPorts.delete(info.port);
		kernels.delete(kernelId);
		cleanupTempDir(info.tempDir);
	}
}

async function cleanupTempDir(tempDir: string) {
	try {
		await fs.promises.rm(tempDir, { recursive: true, force: true });
	} catch (error) {
		// Silently ignore cleanup errors
	}
}

async function findFreePort(): Promise<number> {
	const ports = shuffleArray(
		Array.from({ length: MAX_PORT - MIN_PORT + 1 }, (_, i) => MIN_PORT + i)
	);

	for (const port of ports) {
		if (allocatedPorts.has(port)) {
			continue;
		}

		if (await isPortAvailable(port)) {
			allocatedPorts.add(port);
			return port;
		}
	}

	throw new Error(`No available ports in range ${MIN_PORT}-${MAX_PORT}`);
}

async function isPortAvailable(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const server = require('net').createServer();

		server.once('error', (err: any) => {
			resolve(false);
		});

		server.once('listening', () => {
			server.close();
			resolve(true);
		});

		server.listen(port, '127.0.0.1');
	});
}

function shuffleArray<T>(array: T[]): T[] {
	const shuffled = [...array];
	for (let i = shuffled.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
	}
	return shuffled;
}

function generateId(): string {
	return Math.random().toString(36).substring(7);
}

async function readBody(req: http.IncomingMessage): Promise<string> {
	return new Promise((resolve) => {
		let body = '';
		req.on('data', chunk => body += chunk);
		req.on('end', () => resolve(body));
	});
}

export function deactivate() {
	if (managerServer) {
		managerServer.close();
	}

	for (const [kernelId, info] of kernels.entries()) {
		info.process.kill();
		cleanupTempDir(info.tempDir);
	}

	kernels.clear();
	allocatedPorts.clear();
}

