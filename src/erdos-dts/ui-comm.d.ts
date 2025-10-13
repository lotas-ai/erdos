/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'ui-comm' {
	import * as vscode from 'vscode';

	export interface UiCommMessage {
		msg_id: string;
		comm_id: string;
		data: Record<string, any>;
	}

	export interface UiCommChannel extends vscode.Disposable {
		readonly commId: string;
		readonly onDidReceiveMessage: vscode.Event<UiCommMessage>;
		postMessage(data: Record<string, any>): void;
		close(): void;
	}

	export function openChannel(targetName: string, metadata?: Record<string, any>): Thenable<UiCommChannel>;
}

