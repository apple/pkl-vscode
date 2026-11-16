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
import { LanguageClientRef } from "../extension";
import { DocumentSemanticsTokensSignature } from "vscode-languageclient/node";
import PklLanguageClient from "../PklLanguageClient";
import { PklSemanticTokensProvider } from "../providers/PklSemanticTokensProvider";
import logger from "../clients/logger";

type Token = {
  line: number;
  start: number;
  length: number;
  type: number;
  modifiers: number;
};

function decode(data: Uint32Array): Token[] {
  const tokens: Token[] = [];
  let line = 0;
  let start = 0;
  for (let i = 0; i + 4 < data.length; i += 5) {
    const deltaLine = data[i];
    line += deltaLine;
    start = deltaLine === 0 ? start + data[i + 1] : data[i + 1];
    tokens.push({
      line,
      start,
      length: data[i + 2],
      type: data[i + 3],
      modifiers: data[i + 4],
    });
  }
  return tokens;
}

const byPosition = (a: Token, b: Token) => a.line - b.line || a.start - b.start;

/**
 * Translates tokens encoded against `from` so that they are encoded against `to`.
 *
 * Tokens whose type does not exist in `to` are dropped. Modifiers that don't exist in `to` are
 * dropped from the token.
 */
function remap(
  tokens: Token[],
  from: vscode.SemanticTokensLegend,
  to: vscode.SemanticTokensLegend,
): Token[] {
  const typeMap = from.tokenTypes.map((it) => to.tokenTypes.indexOf(it));
  const modifierMap = from.tokenModifiers.map((it) => to.tokenModifiers.indexOf(it));
  const result: Token[] = [];
  for (const token of tokens) {
    const type = typeMap[token.type];
    if (type === undefined || type < 0) {
      continue;
    }
    let modifiers = 0;
    for (let bit = 0; bit < modifierMap.length; bit++) {
      if ((token.modifiers & (1 << bit)) !== 0 && modifierMap[bit] >= 0) {
        modifiers |= 1 << modifierMap[bit];
      }
    }
    result.push({ ...token, type, modifiers });
  }
  return result;
}

/**
 * Merges semantic tokens from the language server with tokens from the in-client provider.
 *
 * Tokens from the language server take precedence. A client token is only kept if it doesn't
 * overlap with any server token. The result is encoded using the server's legend, because that is
 * the legend the language client registers with VS Code.
 *
 * The result intentionally has no `resultId`, because it doesn't correspond to any state tracked by
 * the server, so VS Code must not request deltas against it.
 */
function mergeSemanticTokens(
  clientTokens: vscode.SemanticTokens | null | undefined,
  clientLegend: vscode.SemanticTokensLegend,
  serverTokens: vscode.SemanticTokens | null | undefined,
  serverLegend: vscode.SemanticTokensLegend | undefined,
): vscode.SemanticTokens | null | undefined {
  if (!clientTokens || !serverLegend) {
    return serverTokens;
  }

  const server = serverTokens ? decode(serverTokens.data) : [];
  const client = remap(decode(clientTokens.data), clientLegend, serverLegend).sort(byPosition);

  // Index server token ranges by line.
  const occupied = new Map<number, Array<[number, number]>>();
  for (const token of server) {
    const ranges = occupied.get(token.line) ?? [];
    ranges.push([token.start, token.start + token.length]);
    occupied.set(token.line, ranges);
  }

  const keptClient: Token[] = [];
  let lastLine = -1;
  let lastEnd = -1;
  for (const token of client) {
    const end = token.start + token.length;
    // Drop client tokens that overlap an earlier client token (e.g. nested captures).
    if (token.line === lastLine && token.start < lastEnd) {
      continue;
    }
    const overlapsServer = occupied
      .get(token.line)
      ?.some(([sStart, sEnd]) => token.start < sEnd && sStart < end);
    if (overlapsServer) {
      continue;
    }
    keptClient.push(token);
    lastLine = token.line;
    lastEnd = end;
  }

  const merged = [...server, ...keptClient].sort(byPosition);
  // No legend is needed because the token types and modifiers are already numeric.
  const builder = new vscode.SemanticTokensBuilder();
  for (const token of merged) {
    builder.push(token.line, token.start, token.length, token.type, token.modifiers);
  }
  return builder.build();
}

async function fetchLspTokens(
  client: PklLanguageClient,
  document: vscode.TextDocument,
  token: vscode.CancellationToken,
  next: DocumentSemanticsTokensSignature,
): Promise<vscode.SemanticTokens | null | undefined> {
  // pkl-lsp <= 0.8 doesn't provide semantic tokens; skip calling `next()` to fetch.
  if (!client.serverSupportsSemanticTokens) return null;
  try {
    return await next(document, token);
  } catch (error) {
    logger.warn(`Failed to fetch semantic tokens from pkl-lsp: ${error}`);
  }
}

const provideSemanticTokens =
  (languageClientRef: LanguageClientRef, semanticTokensProvider: PklSemanticTokensProvider) =>
  async (
    document: vscode.TextDocument,
    token: vscode.CancellationToken,
    next: DocumentSemanticsTokensSignature,
  ): Promise<vscode.SemanticTokens | null | undefined> => {
    const languageClient = languageClientRef.client;
    if (languageClient === null || languageClient === undefined) {
      return await semanticTokensProvider.provideDocumentSemanticTokens(document, token);
    }
    const [clientTokens, serverTokens] = await Promise.all([
      semanticTokensProvider.provideDocumentSemanticTokens(document, token),
      fetchLspTokens(languageClient, document, token, next),
    ]);
    const serverLegend =
      languageClientRef.client?.initializeResult?.capabilities.semanticTokensProvider?.legend;
    const clientLegend = semanticTokensProvider.legend;
    return mergeSemanticTokens(clientTokens, clientLegend, serverTokens, serverLegend);
  };

export default provideSemanticTokens;
