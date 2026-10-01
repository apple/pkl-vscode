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

import path from "node:path";
import os from "node:os";

export const CONFIG_LSP_PATH = "pkl.lsp.path";

export const CONFIG_LSP_SOCKET_PORT = "pkl.lsp.socket.port";

export const CONFIG_LSP_SOCKET_HOST = "pkl.lsp.socket.host";

// only used by the LSP server
export const CONFIG_CLI_PATH = "pkl.cli.path";

// only used by the LSP server
export const CONFIG_PROJECTS_EXCLUDED_DIRECTORIES = "pkl.projects.excludedDirectories";

export const COMMAND_DOWNLOAD_PACKAGE = "pkl.downloadPackage";

export const COMMAND_PKL_OPEN_FILE = "pkl.open.file";

export const COMMAND_SYNC_PROJECTS = "pkl.syncProjects";

export const COMMAND_PKL_CONFIGURE = "pkl.configure";

export const COMMAND_OPEN_WORKSPACE_SETTINGS = "workbench.action.openSettings";

export const COMMAND_RELOAD_WORKSPACE_WINDOW = "workbench.action.reloadWindow";

/**
 * The lowest version of pkl-lsp that this extension supports.
 *
 * This is the first version of pkl-lsp that is published as a native executable.
 */
export const MINIMUM_LSP_VERSION = "0.9.0";

export const LSP_GITHUB_REPO = "apple/pkl-lsp";

export const LSP_INSTALLATION_DOCS_URL = "https://pkl-lang.org/lsp/current/installation.html";

export const LSP_EXECUTABLE_NAME = process.platform === "win32" ? "pkl-lsp.exe" : "pkl-lsp";

/**
 * The directory that pkl-lsp distributions get saved to.
 *
 * Structure: `~/.pkl/editor-support/lsp-distributions/<version>/pkl-lsp`
 */
export const LSP_DISTRIBUTIONS_DIR = path.join(
  os.homedir(),
  ".pkl/editor-support/lsp-distributions/",
);
