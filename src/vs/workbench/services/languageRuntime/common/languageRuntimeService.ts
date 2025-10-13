/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { 
	ILanguageRuntimeMetadata, 
	RuntimeState,
	RuntimeOutputKind,
	RuntimeClientState,
	LanguageRuntimeMessageType,
	UiFrontendEvent,
	ErdosOutputLocation,
	RuntimeOnlineState,
	RuntimeExitReason,
	RuntimeStartMode
} from './languageRuntimeTypes.js';
import { ILanguageRuntimeMessageOutput, ILanguageRuntimeMessageWebOutput } from './languageRuntimeMessageTypes.js';

export { 
	RuntimeState, 
	ILanguageRuntimeMetadata,
	RuntimeOutputKind,
	RuntimeClientState,
	LanguageRuntimeMessageType,
	UiFrontendEvent,
	ErdosOutputLocation,
	RuntimeOnlineState,
	RuntimeExitReason,
	RuntimeStartMode,
	ILanguageRuntimeMessageOutput,
	ILanguageRuntimeMessageWebOutput
};

export const ILanguageRuntimeService = createDecorator<ILanguageRuntimeService>('languageRuntimeService');

export interface ILanguageRuntimeService {
	readonly _serviceBrand: undefined;
	readonly registeredRuntimes: ILanguageRuntimeMetadata[];
	readonly onDidRegisterRuntime: Event<ILanguageRuntimeMetadata>;
	getRegisteredRuntime(runtimeId: string): ILanguageRuntimeMetadata | undefined;
	registerRuntime(runtime: ILanguageRuntimeMetadata): void;
	unregisterRuntime(runtimeId: string): void;
}

export interface ILanguageRuntimeInfo {
	runtimeId: string;
	runtimeName: string;
	languageId: string;
	languageName: string;
	languageVersion: string;
	runtimePath: string;
	runtimeVersion: string;
	runtimeSource: string;
}

export class LanguageRuntimeService extends Disposable implements ILanguageRuntimeService {
	declare readonly _serviceBrand: undefined;

	private readonly _runtimes = new Map<string, ILanguageRuntimeMetadata>();
	private readonly _onDidRegisterRuntime = this._register(new Emitter<ILanguageRuntimeMetadata>());
	readonly onDidRegisterRuntime = this._onDidRegisterRuntime.event;

	constructor(
	) {
		super();
	}

	get registeredRuntimes(): ILanguageRuntimeMetadata[] {
		return Array.from(this._runtimes.values());
	}

	getRegisteredRuntime(runtimeId: string): ILanguageRuntimeMetadata | undefined {
		return this._runtimes.get(runtimeId);
	}

	registerRuntime(runtime: ILanguageRuntimeMetadata): void {
		this._runtimes.set(runtime.runtimeId, runtime);
		this._onDidRegisterRuntime.fire(runtime);
	}

	unregisterRuntime(runtimeId: string): void {
		this._runtimes.delete(runtimeId);
	}
}

registerSingleton(ILanguageRuntimeService, LanguageRuntimeService, InstantiationType.Delayed);

