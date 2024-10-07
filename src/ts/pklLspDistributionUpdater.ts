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

import path from "node:path";
import { COMMAND_RELOAD_WORKSPACE_WINDOW, LSP_DISTRIBUTIONS_DIR } from "./consts";
import { downloadArtifact, getLatestVersion } from "./clients/maven";
import { isRegularFile } from "./utils";
import * as vscode from "vscode";
import logger from "./clients/logger";
import { bundledDistribution } from "./pklLspDistribution";

export const queryForLatestLspDistribution = async () => {
  try {
    const latestVersion = await getLatestVersion({ group: "org.pkl-lang", artifact: "pkl-lsp" });
    if (!latestVersion.isCompatibleWith(bundledDistribution.version)) {
      logger.log(`Latest version is ${latestVersion}, which I am not compatible with.`);
      return;
    }
    const pathOnDisk = path.join(
      LSP_DISTRIBUTIONS_DIR,
      latestVersion.toString(),
      `pkl-lsp-${latestVersion}.jar`
    );
    const isFile = await isRegularFile(pathOnDisk);
    if (isFile) {
      // is already downloaded
      logger.log(`Latest version of pkl-lsp is ${latestVersion}, and it is already downloaded.`);
      return;
    }
    if (bundledDistribution.version.isGreaterThanOrEqualTo(latestVersion)) {
      logger.log(
        `Latest version of pkl-lsp is ${latestVersion}, which is less than or equal to my built-in version.`
      );
      return;
    }
    const callToAction = "Download and reload VSCode";
    const response = await vscode.window.showInformationMessage(
      `A new version of pkl-lsp (${latestVersion}) is available.`,
      callToAction,
      "Later"
    );
    if (response !== callToAction) {
      return;
    }
    await downloadArtifact(
      { group: "org.pkl-lang", artifact: "pkl-lsp", version: latestVersion.toString() },
      pathOnDisk
    );
    vscode.commands.executeCommand(COMMAND_RELOAD_WORKSPACE_WINDOW);
  } catch (err) {
    logger.error(`Failed to handle query for latest distribution: ${err}`);
  }
};
