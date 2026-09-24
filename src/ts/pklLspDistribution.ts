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
import config from "./config";
import { debounce, execFile, isRegularFile } from "./utils";
import Semver from "./Semver";
import * as vscode from "vscode";
import fs from "fs/promises";
import {
  COMMAND_OPEN_WORKSPACE_SETTINGS,
  CONFIG_LSP_PATH,
  LSP_DISTRIBUTIONS_DIR,
  LSP_EXECUTABLE_NAME,
  LSP_INSTALLATION_DOCS_URL,
  MINIMUM_LSP_VERSION,
} from "./consts";
import logger from "./clients/logger";
import {
  downloadLspDistribution,
  getDownloadedDistributionPath,
  getLatestCompatibleLspRelease,
  getPlatformAssetName,
  minimumLspVersion,
} from "./pklLspDistributionUpdater";

const emitter = new vscode.EventEmitter<LspDistribution>();

export const onDidChangeLspDistribution = emitter.event;

export let currentLspDistribution: LspDistribution | undefined = undefined;

export type LspDistribution = {
  path: string;
  version: Semver;
  /**
   * Where the distribution comes from:
   *
   * - `configured`: the `pkl.lsp.path` setting.
   * - `path`: the `$PATH` environment variable.
   * - `downloaded`: downloaded by this extension into {@link LSP_DISTRIBUTIONS_DIR}.
   */
  source: "configured" | "path" | "downloaded";
};

export const getLspDistribution = (): Promise<LspDistribution> => {
  return new Promise((resolve) => {
    if (currentLspDistribution !== undefined) {
      resolve(currentLspDistribution);
      return;
    }
    const disposables: vscode.Disposable[] = [];
    onDidChangeLspDistribution(
      (distribution) => {
        resolve(distribution);
        disposables.every((it) => it.dispose());
      },
      null,
      disposables,
    );
  });
};

const setLspDistribution = (distro: LspDistribution) => {
  logger.log(`Using pkl-lsp ${distro.version} (${distro.source}) at ${distro.path}`);
  currentLspDistribution = distro;
  emitter.fire(distro);
};

const getLspVersion = async (executablePath: string): Promise<Semver | undefined> => {
  const { stdout } = await execFile(executablePath, ["--version"]);
  const stdoutParts = stdout.replace(/\r?\n$/, "").split(" version ");
  const versionStr = stdoutParts[stdoutParts.length - 1];
  if (versionStr === undefined) {
    logger.log(
      `Got malformed version output from executable at ${executablePath}: ${stdout}. Expected "pkl-lsp version <version>"`,
    );
    return;
  }
  const semver = Semver.parse(versionStr);
  if (semver === undefined) {
    logger.log(`Got malformed semver string from executable at ${executablePath}: ${versionStr}`);
    return;
  }
  return semver;
};

const CTA_CONFIGURE_LSP_PATH = "Configure path to pkl-lsp";

const CTA_DOWNLOAD_LSP = "Download pkl-lsp";

const CTA_INSTALLATION_DOCS = "Installation instructions";

const handleCallToAction = (response: string | undefined) => {
  switch (response) {
    case CTA_CONFIGURE_LSP_PATH:
      vscode.commands.executeCommand(COMMAND_OPEN_WORKSPACE_SETTINGS, CONFIG_LSP_PATH);
      break;
    case CTA_INSTALLATION_DOCS:
      vscode.env.openExternal(vscode.Uri.parse(LSP_INSTALLATION_DOCS_URL));
      break;
  }
};

const tellInvalidConfiguredLspPath = async () => {
  const response = await vscode.window.showWarningMessage(
    `Configured path ${config.lspPath} is not a valid pkl-lsp executable.`,
    CTA_CONFIGURE_LSP_PATH,
  );
  handleCallToAction(response);
};

const handleConfiguredLspDistribution = async (lspPath: string) => {
  try {
    const version = await getLspVersion(lspPath);
    if (version === undefined) {
      tellInvalidConfiguredLspPath();
      return;
    }
    // permit an incompatible version, but warn users about it.
    if (!version.isCompatibleWith(minimumLspVersion)) {
      vscode.window.showWarningMessage(
        `This version of pkl-vscode is not compatible with pkl-lsp version ${version}. Features are not guaranteed to work.`,
      );
    }
    setLspDistribution({ path: lspPath, version, source: "configured" });
  } catch (err) {
    tellInvalidConfiguredLspPath();
  }
};

/**
 * Find a compatible pkl-lsp executable in `$PATH`.
 */
const findLspInPath = async (): Promise<LspDistribution | undefined> => {
  const pathEnvVar = process.env.PATH;
  if (pathEnvVar === undefined) {
    return;
  }
  for (const dir of pathEnvVar.split(path.delimiter)) {
    if (dir === "") {
      continue;
    }
    const candidate = path.join(dir, LSP_EXECUTABLE_NAME);
    try {
      if (!(await isRegularFile(candidate))) {
        continue;
      }
      const version = await getLspVersion(candidate);
      if (version === undefined) {
        continue;
      }
      if (!version.isCompatibleWith(minimumLspVersion)) {
        logger.log(`Ignoring pkl-lsp at ${candidate}: version ${version} is not compatible.`);
        continue;
      }
      return { path: candidate, version, source: "path" };
    } catch (err) {
      logger.warn(`Failed to resolve pkl-lsp at ${candidate}: ${err}`);
    }
  }
};

/**
 * Get the highest supported pkl-lsp distribution that was downloaded by this extension.
 */
const getDownloadedDistribution = async (): Promise<LspDistribution | undefined> => {
  try {
    const distroFolders = await fs.readdir(LSP_DISTRIBUTIONS_DIR);
    const versions = distroFolders
      .map(Semver.parse)
      .filter((it): it is Semver => it !== undefined && it.isCompatibleWith(minimumLspVersion))
      .sort((a, b) => -a.compareTo(b));
    for (const version of versions) {
      const executable = getDownloadedDistributionPath(version);
      if (await isRegularFile(executable)) {
        return { path: executable, version, source: "downloaded" };
      }
    }
  } catch (err) {
    return;
  }
};

const downloadLatestLspDistribution = async () => {
  try {
    const release = await getLatestCompatibleLspRelease();
    if (release === undefined) {
      vscode.window.showErrorMessage(
        `Could not find a version of pkl-lsp to download that is compatible with this extension (requires ${MINIMUM_LSP_VERSION} or higher).`,
      );
      return;
    }
    setLspDistribution(await downloadLspDistribution(release));
  } catch (err) {
    logger.error(`Failed to download pkl-lsp: ${err}`);
    const response = await vscode.window.showErrorMessage(
      `Failed to download pkl-lsp: ${err}`,
      CTA_INSTALLATION_DOCS,
      CTA_CONFIGURE_LSP_PATH,
    );
    handleCallToAction(response);
  }
};

const promptForLspDistribution = async () => {
  const assetName = getPlatformAssetName();
  if (assetName === undefined) {
    const response = await vscode.window.showWarningMessage(
      `Pkl language features require pkl-lsp ${MINIMUM_LSP_VERSION} or higher, but it could not be found in $PATH, and no pre-built executable is available for ${process.platform}/${process.arch}. Install pkl-lsp into $PATH, or configure ${CONFIG_LSP_PATH}.`,
      CTA_INSTALLATION_DOCS,
      CTA_CONFIGURE_LSP_PATH,
    );
    handleCallToAction(response);
    return;
  }
  const response = await vscode.window.showInformationMessage(
    `Pkl language features require pkl-lsp ${MINIMUM_LSP_VERSION} or higher, but it could not be found in $PATH. Would you like to download it?`,
    CTA_DOWNLOAD_LSP,
    CTA_CONFIGURE_LSP_PATH,
  );
  if (response === CTA_DOWNLOAD_LSP) {
    await downloadLatestLspDistribution();
  } else {
    handleCallToAction(response);
  }
};

vscode.workspace.onDidChangeConfiguration(
  // debounce because vscode fires configuration changes _as_ users are typing.
  debounce(async (event: vscode.ConfigurationChangeEvent) => {
    if (!event.affectsConfiguration(CONFIG_LSP_PATH) || config.lspPath === undefined) {
      return;
    }
    handleConfiguredLspDistribution(config.lspPath);
  }, 5000),
);

(async () => {
  if (config.lspPath !== undefined) {
    await handleConfiguredLspDistribution(config.lspPath);
    // currentLspDistribution only gets set if it was a valid distribution.
    if (currentLspDistribution !== undefined) {
      return;
    }
  }
  const distro = (await findLspInPath()) ?? (await getDownloadedDistribution());
  if (distro !== undefined) {
    setLspDistribution(distro);
    return;
  }
  await promptForLspDistribution();
})();
