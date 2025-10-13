/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type KernelType = 'python' | 'r';

export interface JupyterMessage {
	header: {
		msg_id: string;
		msg_type: string;
		session: string;
		username: string;
		version: string;
		date: string;
	};
	parent_header: any;
	metadata: any;
	content: any;
}

export class MessageTranslator {
	private static readonly U32_FIELDS = new Set([
		'execution_count',
		'cursor_pos',
		'cursor_start',
		'cursor_end',
		'detail_level'
	]);

	static translateForKernel(msg: JupyterMessage, kernelType: KernelType): JupyterMessage {
		const translated = JSON.parse(JSON.stringify(msg));

		if (kernelType === 'r') {
			this.translateForArk(translated);
		} else {
			this.translateForPython(translated);
		}

		return translated;
	}

	static translateFromKernel(msg: JupyterMessage, kernelType: KernelType): JupyterMessage {
		const translated = JSON.parse(JSON.stringify(msg));

		if (kernelType === 'r') {
			this.normalizeFromArk(translated);
		}

		return translated;
	}

	private static translateForArk(msg: JupyterMessage): void {
		this.convertToU32(msg.content);

		if (msg.header.msg_type === 'execute_request') {
			msg.content.user_expressions = msg.content.user_expressions ?? {};
			msg.content.stop_on_error = msg.content.stop_on_error ?? true;
		}

		if (msg.header.msg_type === 'execute_reply') {
			delete msg.content.payload;
		}

		if (msg.header.msg_type === 'display_data' || msg.header.msg_type === 'execute_result') {
			msg.content.transient = msg.content.transient ?? {};
		}
	}

	private static translateForPython(msg: JupyterMessage): void {
		// Python accepts any number type, no conversion needed
	}

	private static normalizeFromArk(msg: JupyterMessage): void {
		this.convertFromU32(msg.content);
	}

	private static convertToU32(obj: any): void {
		if (typeof obj !== 'object' || obj === null) {
			return;
		}

		for (const [key, value] of Object.entries(obj)) {
			if (this.U32_FIELDS.has(key) && typeof value === 'number') {
				obj[key] = Math.max(0, Math.min(4294967295, Math.floor(value)));
			} else if (typeof value === 'object') {
				this.convertToU32(value);
			}
		}
	}

	private static convertFromU32(obj: any): void {
		if (typeof obj !== 'object' || obj === null) {
			return;
		}

		for (const [key, value] of Object.entries(obj)) {
			if (this.U32_FIELDS.has(key) && typeof value === 'number') {
				obj[key] = Number(value);
			} else if (typeof value === 'object') {
				this.convertFromU32(value);
			}
		}
	}
}

