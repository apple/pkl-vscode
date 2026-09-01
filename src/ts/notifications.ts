/*
 * Copyright © 2024-2026 Apple Inc. and the Pkl project authors. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as vscode from "vscode";
import {
  NotificationType,
  MessageType,
  Command,
  NotificationHandler,
  LanguageClient,
} from "vscode-languageclient/node";
import logger from "./clients/logger";
import {
  COMMAND_DOWNLOAD_PACKAGE,
  COMMAND_PKL_CONFIGURE,
  COMMAND_PKL_OPEN_FILE,
  COMMAND_RELOAD_WORKSPACE_WINDOW,
  COMMAND_SYNC_PROJECTS,
} from "./consts";

export interface ActionableNotification {
  type: MessageType;
  message: string;
  data?: any;
  commands: Command[];
}

// the language server may only trigger commands that this extension registers itself
const ALLOWED_COMMANDS: ReadonlySet<string> = new Set([
  COMMAND_PKL_OPEN_FILE,
  COMMAND_DOWNLOAD_PACKAGE,
  COMMAND_SYNC_PROJECTS,
  COMMAND_PKL_CONFIGURE,
  COMMAND_RELOAD_WORKSPACE_WINDOW,
]);

export const actionableNotificationType: NotificationType<ActionableNotification> =
  new NotificationType<ActionableNotification>("pkl/actionableNotification");

export const actionableNotificationHandler: NotificationHandler<ActionableNotification> = async (
  notification,
) => {
  let response: string | undefined = undefined;
  const titles = notification.commands.map((it) => it.title);
  switch (notification.type) {
    case MessageType.Info:
    case MessageType.Log: {
      response = await vscode.window.showInformationMessage(notification.message, ...titles);
      break;
    }
    case MessageType.Error: {
      response = await vscode.window.showErrorMessage(notification.message, ...titles);
      break;
    }
    case MessageType.Warning: {
      response = await vscode.window.showWarningMessage(notification.message, ...titles);
      break;
    }
  }
  if (response != null) {
    const command = notification.commands.find((it) => it.title == response)!!;
    if (!ALLOWED_COMMANDS.has(command.command)) {
      logger.error(`Refusing to run command requested by pkl-lsp: ${command.command}`);
      return;
    }
    vscode.commands.executeCommand(command.command, ...(command.arguments ?? []));
  }
};

export async function registerNotificationHandlers(client: LanguageClient) {
  client.onNotification(actionableNotificationType, actionableNotificationHandler);
}
