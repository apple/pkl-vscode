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
  CONFIG_LSP_PATH,
} from "./consts";
import config from "./config";
import { pklDownloadPackageRequest, pklSyncProjectsRequest } from "./requests";
import PklTextDocumentContentProvider from "./providers/PklTextDocumentContentProvider";
import { JavaDistribution, onDidChangeJavaDistribution } from "./javaDistribution";

export type LanguageClientRef = {
  client?: LanguageClient;
};

let languageClientRef: LanguageClientRef = {};

const languageClientOptions: LanguageClientOptions = {
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

function createLanguageClient(java: JavaDistribution) {
  const pklLspPath = config.lspPath!!;
  const pklLspDebugPort = config.lspDebugPort;
  const serverOptions: ServerOptions = {
    run: {
      command: java.path,
      args: ["-jar", pklLspPath],
      options: {},
    },
    debug: {
      command: java.path,
      args: [
        `-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,quiet=y,address=*:${pklLspDebugPort}`,
        "-jar",
        pklLspPath,
        "--verbose",
      ],
      options: {},
    },
  };
  return new LanguageClient("Pkl", "Pkl Language Server", serverOptions, languageClientOptions);
}

async function startLspServer(java: JavaDistribution) {
  if (languageClientRef.client?.needsStop() === true) {
    const response = await vscode.window.showInformationMessage(
      "The java path has changed, and the VSCode window needs to be reloaded to take effect.",
      "Reload Window"
    );
    // Calling `LanguageClient#stop()` causes all sorts of havoc for some reason.
    if (response === "Reload Window") {
      vscode.commands.executeCommand(COMMAND_RELOAD_WORKSPACE_WINDOW);
      return;
    }
  }
  console.log("Starting language server");
  const client = createLanguageClient(java);
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

async function askForLspJar() {
  const response = await vscode.window.showWarningMessage(
    "Path to pkl-lsp.jar not configured",
    "Configure path to pkl-lsp.jar"
  );
  if (response === "Configure path to pkl-lsp.jar") {
    vscode.commands.executeCommand(COMMAND_OPEN_WORKSPACE_SETTINGS, CONFIG_LSP_PATH);
  }
}

export async function activate(context: vscode.ExtensionContext) {
  await registerSubscriptions(context);
  onDidChangeJavaDistribution(async (distribution) => {
    // TODO: This is temporary logic; pkl-lsp should either be downloaded from the internet, or bundled together with vsix
    const lspPath = config.lspPath;
    if (lspPath == null) {
      askForLspJar();
      return;
    }
    startLspServer(distribution);
  });
}

export function deactivate(): Thenable<void> | undefined {
  if (languageClientRef.client?.needsStop() === true) {
    return languageClientRef.client.stop();
  }
}
