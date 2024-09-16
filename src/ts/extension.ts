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

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { newPklLanguageSupport } from "./PklLanguageSupport";
import {
  LanguageClient,
  LanguageClientOptions,
  RequestType,
  TextDocumentIdentifier,
  ServerOptions,
} from "vscode-languageclient/node";
import { registerNotificationHandlers } from "./notifications";

let client: LanguageClient;

export async function activate(context: vscode.ExtensionContext) {
  const languageSupport = await newPklLanguageSupport();
  // const highlighter = await newSemanticHighlighter();
  // const foldingRangeProvider = await newFoldingRangeProvider();
  context.subscriptions.push(
    vscode.languages.registerDocumentSemanticTokensProvider(
      { language: "pkl" },
      languageSupport,
      languageSupport.legend
    ),
    vscode.languages.registerFoldingRangeProvider({ language: "pkl" }, languageSupport)
  );

  // lsp client
  const pklLspPath: string = vscode.workspace.getConfiguration().get("pklLSP.path") ?? "";
  const pklLspDebugPort: number =
    vscode.workspace.getConfiguration().get("pklLSP.debug.port") ?? 5005;
  const serverOptions: ServerOptions = {
    run: {
      command: pklLspPath,
      args: [],
      options: {},
    },
    debug: {
      command: "java",
      args: [
        `-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,quiet=y,address=*:${pklLspDebugPort}`,
        "-jar",
        pklLspPath,
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

  client = new LanguageClient("Pkl", "Pkl Language Server", serverOptions, clientOptions);

  const pklProvider = createPklContentProvider(client);

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider("pkl-lsp", pklProvider)
  );

  client.start();

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "pkl.open.file",
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
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("pkl.downloadPackage", async (packageUri: string) => {
      await client.sendRequest(pklDownloadPackageRequest, packageUri);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("pkl.syncProjects", async () => {
      await client.sendRequest(pklSyncProjectsRequest, null);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("pkl.configure", async (configurationPath: string) => {
      await vscode.commands.executeCommand("workbench.action.openSettings", configurationPath);
    })
  );

  registerNotificationHandlers(client);
}

// this method is called when your extension is deactivated
export function deactivate(): Thenable<void> | undefined {
  if (!client) return undefined;
  return client.stop();
}

const pklEventEmitter = new vscode.EventEmitter<vscode.Uri>();

const pklFileContentRequest = new RequestType<TextDocumentIdentifier, string, void>(
  "pkl/fileContents"
);

const pklDownloadPackageRequest = new RequestType<string, void, void>("pkl/downloadPackage");

const pklSyncProjectsRequest = new RequestType<void, void, void>("pkl/syncProjects");

function createPklContentProvider(client: LanguageClient): vscode.TextDocumentContentProvider {
  return <vscode.TextDocumentContentProvider>{
    onDidChange: pklEventEmitter.event,

    provideTextDocumentContent: async (
      uri: vscode.Uri,
      token: vscode.CancellationToken
    ): Promise<string> => {
      const content = await client.sendRequest(
        pklFileContentRequest,
        { uri: uri.toString() },
        token
      );
      return content ?? "";
    },
  };
}
