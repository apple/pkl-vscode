//===----------------------------------------------------------------------===//
// Copyright © 2024 Apple Inc. and the Pkl project authors. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import { newPklSemanticTokenProvider } from "./providers/PklSemanticTokensProvider";
import { LanguageClient, LanguageClientOptions, ServerOptions } from "vscode-languageclient/node";
import { registerNotificationHandlers } from "./notifications";
import {
  COMMAND_DOWNLOAD_PACKAGE,
  COMMAND_OPEN_WORKSPACE_SETTINGS,
  COMMAND_PKL_CONFIGURE,
  COMMAND_PKL_OPEN_FILE,
  COMMAND_RELOAD_WORKSPACE_WINDOW,
  COMMAND_SYNC_PROJECTS,
  CONFIG_JAVA_PATH,
  CONFIG_LSP_PATH,
} from "./consts";
import config from "./config";
import { pklDownloadPackageRequest, pklSyncProjectsRequest } from "./requests";
import PklTextDocumentContentProvider from "./providers/PklTextDocumentContentProvider";
import {
  getJavaDistribution,
  JavaDistribution,
  onDidChangeJavaDistribution,
} from "./javaDistribution";
import {
  getLspDistribution,
  LspDistribution,
  onDidChangeLspDistribution,
} from "./pklLspDistribution";
import { queryForLatestLspDistribution } from "./pklLspDistributionUpdater";
import logger from "./clients/logger";

export type LanguageClientRef = {
  client?: LanguageClient;
};

let languageClientRef: LanguageClientRef = {};

function createLanguageClient(java: JavaDistribution, lspDistribution: LspDistribution) {
  const pklLspDebugPort = config.lspDebugPort;
  const serverOptions: ServerOptions = {
    run: {
      command: java.path,
      args: ["-jar", lspDistribution.path],
      options: {},
    },
    debug: {
      command: java.path,
      args: [
        `-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,quiet=y,address=*:${pklLspDebugPort}`,
        "-jar",
        lspDistribution.path,
        "--verbose",
      ],
      options: {},
    },
  };
  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", language: "pkl" },
      { scheme: "pkl-lsp", language: "pkl" },
    ],
    markdown: {
      isTrusted: true,
    },
    initializationOptions: {
      renderOpenFileCommandInDocs: true,
      extendedClientCapabilities: {
        actionableRuntimeNotifications: true,
        pklConfigureCommand: true,
      },
    },
  };
  return new LanguageClient("Pkl", "Pkl Language Server", serverOptions, clientOptions);
}

async function nofityReloadNeeded() {
  const response = await vscode.window.showInformationMessage(
    "The java path has changed, and the VSCode window needs to be reloaded to take effect.",
    "Reload Window"
  );
  if (response === "Reload Window") {
    vscode.commands.executeCommand(COMMAND_RELOAD_WORKSPACE_WINDOW);
  }
}

async function startLspServer(java: JavaDistribution, lspDistribution: LspDistribution) {
  if (languageClientRef.client?.needsStop() === true) {
    // Calling `LanguageClient#stop()` causes all sorts of havoc for some reason, so we'll just ask users to reload the window.
    nofityReloadNeeded();
    return;
  }
  logger.log("Starting language server");
  const client = createLanguageClient(java, lspDistribution);
  languageClientRef.client = client;
  await client.start();
  registerNotificationHandlers(client);
}

async function registerSubscriptions(context: vscode.ExtensionContext) {
  const semanticTokensProvider = await newPklSemanticTokenProvider();

  context.subscriptions.push(
    vscode.languages.registerDocumentSemanticTokensProvider(
      { language: "pkl" },
      semanticTokensProvider,
      semanticTokensProvider.legend
    ),
    vscode.languages.registerFoldingRangeProvider({ language: "pkl" }, semanticTokensProvider)
  );

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      "pkl-lsp",
      new PklTextDocumentContentProvider(languageClientRef)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      COMMAND_PKL_OPEN_FILE,
      async (path: string, maybeLine: number | undefined, maybeCol: number | undefined) => {
        const parsedUri = vscode.Uri.parse(path);
        const editor = await vscode.window.showTextDocument(parsedUri);

        let line = maybeLine ?? 0;
        if (Number.isNaN(line)) {
          line = 1;
        }
        let col = maybeCol ?? 0;
        if (Number.isNaN(col)) {
          col = 1;
        }
        const pos = new vscode.Position(line - 1, col - 1);

        const range = new vscode.Range(pos, pos);
        editor.revealRange(range, vscode.TextEditorRevealType.AtTop);
        editor.selections = [new vscode.Selection(pos, pos)];
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_DOWNLOAD_PACKAGE, async (packageUri: string) => {
      if (languageClientRef.client === undefined) {
        return;
      }
      await languageClientRef.client.sendRequest(pklDownloadPackageRequest, packageUri);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_SYNC_PROJECTS, async () => {
      if (languageClientRef.client === undefined) {
        return;
      }
      await languageClientRef.client.sendRequest(pklSyncProjectsRequest, null);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_PKL_CONFIGURE, async (configurationPath: string) => {
      await vscode.commands.executeCommand(COMMAND_OPEN_WORKSPACE_SETTINGS, configurationPath);
    })
  );
}

const showRestartMessage = (configPath: string) => async () => {
  if (languageClientRef.client?.needsStop() === true) {
    const response = await vscode.window.showInformationMessage(
      `The configuration value "${configPath}" has changed, and the VSCode window needs to be reloaded to take effect.`,
      "Reload Window"
    );
    // Calling `LanguageClient#stop()` causes all sorts of havoc for some reason.
    if (response === "Reload Window") {
      vscode.commands.executeCommand(COMMAND_RELOAD_WORKSPACE_WINDOW);
      return;
    }
  }
};

export async function activate(context: vscode.ExtensionContext) {
  await registerSubscriptions(context);
  const [javaDistribution, lspDistribution] = await Promise.all([
    getJavaDistribution(),
    getLspDistribution(),
  ]);
  await startLspServer(javaDistribution, lspDistribution);
  onDidChangeJavaDistribution(showRestartMessage(CONFIG_JAVA_PATH));
  onDidChangeLspDistribution(showRestartMessage(CONFIG_LSP_PATH));
  queryForLatestLspDistribution();
}

export function deactivate(): Thenable<void> | undefined {
  if (languageClientRef.client?.needsStop() === true) {
    return languageClientRef.client.stop();
  }
}
