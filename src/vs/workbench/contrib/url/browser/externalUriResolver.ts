/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IBrowserWorkbenchEnvironmentService } from '../../../services/environment/browser/environmentService.js';

/**
 * Checks if a hostname is localhost
 */
function isLocalhost(hostname: string): boolean {
	return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export class ExternalUriResolverContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.externalUriResolver';

	constructor(
		@IOpenerService _openerService: IOpenerService,
		@IBrowserWorkbenchEnvironmentService _workbenchEnvironmentService: IBrowserWorkbenchEnvironmentService,
	) {
		super();

		// Register embedder-provided URI resolver if available
		if (_workbenchEnvironmentService.options?.resolveExternalUri) {
			this._register(_openerService.registerExternalUriResolver({
				resolveExternalUri: async (resource) => {
					return {
						resolved: await _workbenchEnvironmentService.options!.resolveExternalUri!(resource),
						dispose: () => {
							// TODO@mjbvz - do we need to do anything here?
						}
					};
				}
			}));
		}

		// Register default localhost resolver for browser contexts
		// In browser-based workbench without remote authority, localhost URIs don't need
		// port forwarding/tunneling and can be accessed directly
		this._register(_openerService.registerExternalUriResolver({
			resolveExternalUri: async (resource: URI) => {
				// Only handle http/https localhost URLs
				if ((resource.scheme === 'http' || resource.scheme === 'https') &&
					isLocalhost(resource.authority.split(':')[0])) {
					return {
						resolved: resource,
						dispose: () => { }
					};
				}
				// Return undefined to let other resolvers handle it
				return undefined;
			}
		}));
	}
}
