/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ILanguageRuntimeService } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { INotebookKernelService } from '../../notebook/common/notebookKernelService.js';
import { ErdosNotebookKernel } from './notebookKernel.js';

export const IErdosNotebookKernelService = createDecorator<IErdosNotebookKernelService>('erdosNotebookKernelService');

export interface IErdosNotebookKernelService {
	readonly _serviceBrand: undefined;
}

/**
 * Service that manages Erdos notebook kernels.
 * Creates a kernel for each registered language runtime and registers it with VSCode.
 */
class ErdosNotebookKernelService extends Disposable implements IErdosNotebookKernelService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILanguageRuntimeService private readonly _languageRuntimeService: ILanguageRuntimeService,
		@INotebookKernelService private readonly _notebookKernelService: INotebookKernelService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		// Create kernels for all existing runtimes
		for (const runtime of this._languageRuntimeService.registeredRuntimes) {
			this._createKernelForRuntime(runtime);
		}

		// Create kernels for newly registered runtimes
		this._register(this._languageRuntimeService.onDidRegisterRuntime(runtime => {
			this._createKernelForRuntime(runtime);
		}));
	}

	private _createKernelForRuntime(runtime: any): void {
		try {
			// Create the kernel instance
			const kernel = this._register(
				this._instantiationService.createInstance(ErdosNotebookKernel, runtime)
			);

			// Register it with VSCode's notebook kernel service
			this._register(this._notebookKernelService.registerKernel(kernel));
		} catch (err) {
			this._logService.error(`[ErdosNotebookKernelService] Failed to create kernel for runtime ${runtime.runtimeId}: ${err}`);
		}
	}
}

// Register the service as a singleton
registerSingleton(IErdosNotebookKernelService, ErdosNotebookKernelService, InstantiationType.Eager);

