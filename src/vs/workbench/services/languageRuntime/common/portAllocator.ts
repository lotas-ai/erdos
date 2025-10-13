/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as net from 'net';

class PortAllocatorService {
	private allocatedPorts = new Set<number>();
	private readonly MIN_PORT = 8000;
	private readonly MAX_PORT = 8999;
	private portAllocationLock: Promise<any> = Promise.resolve();

	async allocate(): Promise<number> {
		const result = await (this.portAllocationLock = this.portAllocationLock.then(async () => {
			const ports = this.shuffleArray(
				Array.from({ length: this.MAX_PORT - this.MIN_PORT + 1 }, (_, i) => this.MIN_PORT + i)
			);

			for (const port of ports) {
				if (this.allocatedPorts.has(port)) {
					continue;
				}

				if (await this.isPortAvailable(port)) {
					this.allocatedPorts.add(port);
					return port;
				}
			}

			throw new Error(`No available ports in range ${this.MIN_PORT}-${this.MAX_PORT}`);
		}));
		return result!;
	}

	release(port: number): void {
		this.allocatedPorts.delete(port);
	}

	private async isPortAvailable(port: number): Promise<boolean> {
		return new Promise((resolve) => {
			const server = net.createServer();

			server.once('error', (err: NodeJS.ErrnoException) => {
				if (err.code === 'EADDRINUSE') {
					resolve(false);
				} else {
					resolve(false);
				}
			});

			server.once('listening', () => {
				server.close();
				resolve(true);
			});

			server.listen(port, '127.0.0.1');
		});
	}

	private shuffleArray<T>(array: T[]): T[] {
		const shuffled = [...array];
		for (let i = shuffled.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
		}
		return shuffled;
	}
}

export const PortAllocator = new PortAllocatorService();

