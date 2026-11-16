/*
 * Copyright © 2026 Apple Inc. and the Pkl project authors. All rights reserved.
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
  DynamicFeature,
  LanguageClient,
  LanguageClientOptions,
  ServerCapabilities,
  ServerOptions,
  StaticFeature,
} from "vscode-languageclient/node";

export default class PklLanguageClient extends LanguageClient {
  #clientLegend: vscode.SemanticTokensLegend;

  #serverSupportsSemanticTokens = false;

  /** Whether the server can answer `textDocument/semanticTokens/full` requests. */
  get serverSupportsSemanticTokens(): boolean {
    return this.#serverSupportsSemanticTokens;
  }

  constructor(
    serverOptions: ServerOptions,
    clientOptions: LanguageClientOptions,
    clientLegend: vscode.SemanticTokensLegend,
  ) {
    super("Pkl", "Pkl Language Server", serverOptions, clientOptions);
    this.#clientLegend = clientLegend;
  }

  // merge semantic token legend from LSP with the ones provided by this plugin, because vscode doesn't support multiple
  // semantic token providers
  override registerFeature(feature: StaticFeature | DynamicFeature<any>): void {
    if (
      "registrationType" in feature &&
      feature.registrationType.method === "textDocument/semanticTokens"
    ) {
      const original = feature.initialize.bind(feature);
      feature.initialize = (capabilities: ServerCapabilities, documentSelector) => {
        const provider = capabilities.semanticTokensProvider;
        this.#serverSupportsSemanticTokens = !!provider?.full;
        if (!this.#serverSupportsSemanticTokens) {
          // Keep the server's legend if it has one (e.g. it only supports range requests).
          capabilities.semanticTokensProvider = {
            ...provider,
            legend: provider?.legend ?? { tokenTypes: [], tokenModifiers: [] },
            full: true,
          };
        }
        const legend = capabilities.semanticTokensProvider!.legend;
        for (const type of this.#clientLegend.tokenTypes) {
          if (!legend.tokenTypes.includes(type)) {
            legend.tokenTypes.push(type);
          }
        }
        for (const modifier of this.#clientLegend.tokenModifiers) {
          if (!legend.tokenModifiers.includes(modifier)) {
            legend.tokenModifiers.push(modifier);
          }
        }
        original(capabilities, documentSelector);
      };
    }
    super.registerFeature(feature);
  }
}
