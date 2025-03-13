/*
 * Copyright © 2024-2025 Apple Inc. and the Pkl project authors. All rights reserved.
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

import vscode from "vscode";
import Parser from "web-tree-sitter";
import fs from "fs";
import path from "path";

const foldsQueries = fs.readFileSync(path.join(__dirname, "../queries/folds.scm"), {
  encoding: "utf-8",
});

const highlightsQueries = fs.readFileSync(path.join(__dirname, "../queries/highlights.scm"), {
  encoding: "utf-8",
});

export class PklSemanticTokensProvider
  implements vscode.DocumentSemanticTokensProvider, vscode.FoldingRangeProvider
{
  #previousTrees: Map<vscode.TextDocument, { version: number; tree: Parser.Tree }> = new Map();

  #parser: Parser;

  #highlightsQuery: Parser.Query;

  #foldsQuery: Parser.Query;

  legend: vscode.SemanticTokensLegend;

  constructor(parser: Parser) {
    this.#parser = parser;
    this.#highlightsQuery = parser.getLanguage().query(highlightsQueries);
    this.#foldsQuery = parser.getLanguage().query(foldsQueries);
    this.legend = this.#buildLegend();
  }

  #buildLegend() {
    const tokenTypes: string[] = [];
    const tokenModifiers: string[] = [];
    for (const capture of this.#highlightsQuery.captureNames) {
      const [type, ...modifiers] = capture.split(".");
      if (!tokenTypes.includes(type)) {
        tokenTypes.push(type);
      }
      for (const modifier of modifiers) {
        if (!tokenModifiers.includes(modifier)) {
          tokenModifiers.push(modifier);
        }
      }
    }
    return new vscode.SemanticTokensLegend(tokenTypes, tokenModifiers);
  }

  #parse(document: vscode.TextDocument): Parser.Tree {
    const previousParse = this.#previousTrees.get(document);
    if (previousParse && previousParse.version === document.version) {
      return previousParse.tree;
    }
    const tree = this.#parser.parse(document.getText());
    this.#previousTrees.set(document, { version: document.version, tree });
    return tree;
  }

  provideDocumentSemanticTokens(
    document: vscode.TextDocument,
    _: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.SemanticTokens> {
    const tree = this.#parse(document);
    const captures = this.#highlightsQuery.captures(tree.rootNode);
    const builder = new vscode.SemanticTokensBuilder(this.legend);

    for (const capture of captures) {
      const [term, ...modifiers] = capture.name.split(".");
      const node = capture.node;
      // A token can't span multiple lines.
      // We'll have to rely on our textmate grammar here.
      if (node.endPosition.row > node.startPosition.row) {
        continue;
      }
      const range = new vscode.Range(
        new vscode.Position(node.startPosition.row, node.startPosition.column),
        new vscode.Position(node.endPosition.row, node.endPosition.column)
      );
      builder.push(range, term, modifiers);
    }
    const tokens = builder.build();
    return tokens;
  }

  provideFoldingRanges(
    document: vscode.TextDocument,
    context: vscode.FoldingContext,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.FoldingRange[]> {
    const tree = this.#parse(document);
    const captures = this.#foldsQuery.captures(tree.rootNode);
    return captures
      .filter((it) => it.node.endPosition.row > it.node.startPosition.row)
      .map((it) => {
        return new vscode.FoldingRange(it.node.startPosition.row, it.node.endPosition.row);
      });
  }
}

export async function newPklSemanticTokenProvider(): Promise<PklSemanticTokensProvider> {
  await Parser.init();
  const language = await Parser.Language.load(path.join(__dirname, "pkl.wasm"));
  const parser = new Parser();
  parser.setLanguage(language);
  return new PklSemanticTokensProvider(parser);
}
