/*---------------------------------------------------------------------------------------------
 * Copyright (c) 2025 Lotas Inc. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Command } from "../core/command";
import { quartoInlineOutputManager } from "./output/inlineOutputManager";

export function clearOutputsCommands(): Command[] {
  return [new ClearAllOutputsCommand()];
}

class ClearAllOutputsCommand implements Command {
  private static readonly id = "quarto.clearAllOutputs";
  public readonly id = ClearAllOutputsCommand.id;

  execute(): void {
    quartoInlineOutputManager.clearAllOutputs();
  }
}


