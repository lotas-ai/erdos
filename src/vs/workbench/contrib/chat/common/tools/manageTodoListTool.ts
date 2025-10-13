/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import {
	IToolData,
	IToolImpl,
	IToolInvocation,
	IToolResult,
	ToolDataSource,
	IToolInvocationPreparationContext,
	IPreparedToolInvocation
} from '../languageModelToolsService.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IChatTodo, IChatTodoListService } from '../chatTodoListService.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';

export const TodoListToolSettingId = 'chat.todoListTool.enabled';
export const TodoListToolWriteOnlySettingId = 'chat.todoListTool.writeOnly';

export const ManageTodoListToolToolId = 'manage_todo_list';

export function createManageTodoListToolData(writeOnly: boolean): IToolData {
	const baseProperties: any = {
		todoList: {
			type: 'array',
			description: writeOnly
				? 'Complete array of all todo items. Must include ALL items - both existing and new.'
				: 'Complete array of all todo items (required for write operation, ignored for read). Must include ALL items - both existing and new.',
			items: {
				type: 'object',
				properties: {
					id: {
						type: 'number',
						description: 'Unique identifier for the todo. Use sequential numbers starting from 1.'
					},
					title: {
						type: 'string',
						description: 'Concise action-oriented todo label (3-7 words). Displayed in UI.'
					},
					description: {
						type: 'string',
						description: 'Detailed context, requirements, or implementation notes. Include file paths, specific methods, or acceptance criteria.'
					},
					status: {
						type: 'string',
						enum: ['not-started', 'in-progress', 'completed'],
						description: 'not-started: Not begun | in-progress: Currently working (max 1) | completed: Fully finished with no blockers'
					},
				},
				required: ['id', 'title', 'description', 'status']
			}
		}
	};

	const requiredFields = ['todoList'];

	if (!writeOnly) {
		baseProperties.operation = {
			type: 'string',
			enum: ['write', 'read'],
			description: 'write: Replace entire todo list with new content. read: Retrieve current todo list. ALWAYS provide complete list when writing - partial updates not supported.'
		};
		requiredFields.unshift('operation');
	}

	return {
		id: ManageTodoListToolToolId,
		toolReferenceName: 'todos',
		when: ContextKeyExpr.equals(`config.${TodoListToolSettingId}`, true),
		canBeReferencedInPrompt: true,
		icon: ThemeIcon.fromId(Codicon.checklist.id),
		displayName: 'Update Todo List',
		userDescription: 'Manage and track todo items for task planning',
		modelDescription: 'Manage a structured todo list to track progress and plan tasks throughout your coding session. Use this tool VERY frequently to ensure task visibility and proper planning.\n\nWhen to use this tool:\n- Complex multi-step work requiring planning and tracking\n- When user provides multiple tasks or requests (numbered/comma-separated)\n- After receiving new instructions that require multiple steps\n- BEFORE starting work on any todo (mark as in-progress)\n- IMMEDIATELY after completing each todo (mark completed individually)\n- When breaking down larger tasks into smaller actionable steps\n- To give users visibility into your progress and planning\n\nWhen NOT to use:\n- Single, trivial tasks that can be completed in one step\n- Purely conversational/informational requests\n- When just reading files or performing simple searches\n\nCRITICAL workflow:\n1. Plan tasks by writing todo list with specific, actionable items\n2. Mark ONE todo as in-progress before starting work\n3. Complete the work for that specific todo\n4. Mark that todo as completed IMMEDIATELY\n5. Move to next todo and repeat\n\nTodo states:\n- not-started: Todo not yet begun\n- in-progress: Currently working (limit ONE at a time)\n- completed: Finished successfully\n\nIMPORTANT: Mark todos completed as soon as they are done. Do not batch completions.',
		source: ToolDataSource.Internal,
		inputSchema: {
			type: 'object',
			properties: baseProperties,
			required: requiredFields
		}
	};
}

export const ManageTodoListToolData: IToolData = createManageTodoListToolData(false);

interface IManageTodoListToolInputParams {
	operation?: 'write' | 'read'; // Optional in write-only mode
	todoList: Array<{
		id: number;
		title: string;
		description: string;
		status: 'not-started' | 'in-progress' | 'completed';
	}>;
	chatSessionId?: string;
}

export class ManageTodoListTool extends Disposable implements IToolImpl {

	constructor(
		private readonly writeOnly: boolean,
		@IChatTodoListService private readonly chatTodoListService: IChatTodoListService,
		@ILogService private readonly logService: ILogService,
		@ITelemetryService private readonly telemetryService: ITelemetryService
	) {
		super();
	}

	async invoke(invocation: IToolInvocation, _countTokens: any, _progress: any, _token: CancellationToken): Promise<IToolResult> {
		const args = invocation.parameters as IManageTodoListToolInputParams;
		const chatSessionId = invocation.context?.sessionId ?? args.chatSessionId;
		if (chatSessionId === undefined) {
			throw new Error('A chat session ID is required for this tool');
		}

		this.logService.debug(`ManageTodoListTool: Invoking with options ${JSON.stringify(args)}`);

		try {

			// In write-only mode, we always perform a write operation
			if (this.writeOnly && !args.chatSessionId) {
				if (!args.todoList) {
					return {
						content: [{
							kind: 'text',
							value: 'Error: todoList is required for write operation'
						}]
					};
				}

				const todoList: IChatTodo[] = args.todoList.map((parsedTodo) => ({
					id: parsedTodo.id,
					title: parsedTodo.title,
					description: parsedTodo.description,
					status: parsedTodo.status
				}));
				this.chatTodoListService.setTodos(chatSessionId, todoList);
				return {
					content: [{
						kind: 'text',
						value: 'Successfully wrote todo list'
					}]
				};
			}

			// Regular mode: check operation parameter
			const operation = args.operation;
			if (operation === undefined) {
				return {
					content: [{
						kind: 'text',
						value: 'Error: operation parameter is required'
					}]
				};
			}

			switch (operation) {
				case 'read': {
					const todoItems = this.chatTodoListService.getTodos(chatSessionId);
					const readResult = this.handleRead(todoItems, chatSessionId);
					this.telemetryService.publicLog2<TodoListToolInvokedEvent, TodoListToolInvokedClassification>(
						'todoListToolInvoked',
						{
							operation: 'read',
							todoItemCount: todoItems.length,
							chatSessionId: chatSessionId
						}
					);
					return {
						content: [{
							kind: 'text',
							value: readResult
						}]
					};
				}
				case 'write': {
					const todoList: IChatTodo[] = args.todoList.map((parsedTodo) => ({
						id: parsedTodo.id,
						title: parsedTodo.title,
						description: parsedTodo.description,
						status: parsedTodo.status
					}));
					this.chatTodoListService.setTodos(chatSessionId, todoList);
					this.telemetryService.publicLog2<TodoListToolInvokedEvent, TodoListToolInvokedClassification>(
						'todoListToolInvoked',
						{
							operation: 'write',
							todoItemCount: todoList.length,
							chatSessionId: chatSessionId
						}
					);
					return {
						content: [{
							kind: 'text',
							value: 'Successfully wrote todo list'
						}]
					};
				}
				default: {
					const errorResult = 'Error: Unknown operation';
					return {
						content: [{
							kind: 'text',
							value: errorResult
						}]
					};
				}
			}

		} catch (error) {
			const errorMessage = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
			return {
				content: [{
					kind: 'text',
					value: errorMessage
				}]
			};
		}
	}

	async prepareToolInvocation(context: IToolInvocationPreparationContext, _token: CancellationToken): Promise<IPreparedToolInvocation | undefined> {
		const args = context.parameters as IManageTodoListToolInputParams;
		const chatSessionId = context.chatSessionId ?? args.chatSessionId;
		if (!chatSessionId) {
			throw new Error('chatSessionId undefined');
		}

		const items = args.todoList ?? this.chatTodoListService.getTodos(chatSessionId);
		const todoList = items.map(todo => ({
			id: todo.id.toString(),
			title: todo.title,
			description: todo.description,
			status: todo.status
		}));

		return {
			toolSpecificData: {
				kind: 'todoList',
				sessionId: chatSessionId,
				todoList: todoList
			}
		};
	}


	private handleRead(todoItems: IChatTodo[], sessionId: string): string {
		if (todoItems.length === 0) {
			return 'No todo list found.';
		}

		const markdownTaskList = this.formatTodoListAsMarkdownTaskList(todoItems);
		return `# Todo List\n\n${markdownTaskList}`;
	}

	private formatTodoListAsMarkdownTaskList(todoList: IChatTodo[]): string {
		if (todoList.length === 0) {
			return '';
		}

		return todoList.map(todo => {
			let checkbox: string;
			switch (todo.status) {
				case 'completed':
					checkbox = '[x]';
					break;
				case 'in-progress':
					checkbox = '[-]';
					break;
				case 'not-started':
				default:
					checkbox = '[ ]';
					break;
			}

			const lines = [`- ${checkbox} ${todo.title}`];
			if (todo.description && todo.description.trim()) {
				lines.push(`  - ${todo.description.trim()}`);
			}

			return lines.join('\n');
		}).join('\n');
	}
}

type TodoListToolInvokedEvent = {
	operation: 'read' | 'write';
	todoItemCount: number;
	chatSessionId: string | undefined;
};

type TodoListToolInvokedClassification = {
	operation: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The operation performed on the todo list (read or write).' };
	todoItemCount: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The number of items in the todo list operation.' };
	chatSessionId: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The ID of the chat session that the tool was used within, if applicable.' };
	owner: 'bhavyaus';
	comment: 'Provides insight into the usage of the todo list tool.';
};
