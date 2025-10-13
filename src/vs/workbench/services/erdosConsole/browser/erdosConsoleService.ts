/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Re-export the service interface and implementation
export {
	IConsoleService,
	ERDOS_CONSOLE_VIEW_ID
} from '../common/consoleService.js';
export { ConsoleServiceImpl } from './consoleServiceImpl.js';

