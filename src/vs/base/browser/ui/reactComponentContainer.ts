/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../common/event.js';
import type { ISize } from './contextview/contextview.js';

export type { ISize };

/**
 * IElementPosition interface.
 */
export interface IElementPosition {
	x: number;
	y: number;
}

/**
 * IReactComponentContainer interface.
 * Used by ViewPanes that need to host React components.
 */
export interface IReactComponentContainer {
	/**
	 * Gets the width.
	 */
	readonly width: number;

	/**
	 * Gets the height.
	 */
	readonly height: number;

	/**
	 * Gets the container visibility.
	 */
	readonly containerVisible: boolean;

	/**
	 * Directs the React component container to take focus.
	 */
	takeFocus(): void;

	/**
	 * Notifies the React component container when focus changes.
	 */
	focusChanged?(focused: boolean): void;

	/**
	 * Notifies the React component container when visibility changes.
	 */
	visibilityChanged?(visible: boolean): void;

	/**
	 * onFocused event.
	 */
	readonly onFocused: Event<void>;

	/**
	 * onSizeChanged event.
	 */
	readonly onSizeChanged: Event<ISize>;

	/**
	 * onVisibilityChanged event.
	 */
	readonly onVisibilityChanged: Event<boolean>;

	/**
	 * onSaveScrollPosition event.
	 */
	readonly onSaveScrollPosition: Event<void>;

	/**
	 * onRestoreScrollPosition event.
	 */
	readonly onRestoreScrollPosition: Event<void>;
}

