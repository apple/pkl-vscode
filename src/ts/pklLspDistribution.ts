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
import config from "./config";
import { getJavaDistribution } from "./javaDistribution";
import { debounce, exec, isRegularFile } from "./utils";
import Semver from "./Semver";
import * as vscode from "vscode";
import fs from "fs/promises";
import {
  BUNDLED_LSP_VERSION,
  COMMAND_OPEN_WORKSPACE_SETTINGS,
  CONFIG_LSP_PATH,
  LSP_DISTRIBUTIONS_DIR,
} from "./consts";
import logger from "./clients/logger";

const emitter = new vscode.EventEmitter<LspDistribution>();

export const onDidChangeLspDistribution = emitter.event;

export let currentLspDistribution: LspDistribution | undefined = undefined;

export type LspDistribution = {
  path: string;
  version: Semver;
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
      disposables
    );
  });
};

export const bundledDistribution: LspDistribution = {
  path: path.join(__dirname, "pkl-lsp.jar"),
  version: Semver.parse(BUNDLED_LSP_VERSION)!!,
};

const getLspVersion = async (jarPath: string): Promise<Semver | undefined> => {
  const javaDistribution = await getJavaDistribution();
  const { stdout } = await exec(`${javaDistribution.path} -jar ${jarPath} --version`);
  const versionStr = stdout
    .replace(/\r?\n$/, "")
    .split(" version ")
    .findLast((it) => true);
  if (versionStr === undefined) {
    logger.log(
      `Got malformed version output from jar file at ${jarPath}: ${stdout}. Expected "pkl-lsp version <version>"`
    );
    return;
  }
  const semver = Semver.parse(versionStr);
  if (semver === undefined) {
    logger.log(`Got malformed semver string from jar file at ${jarPath}: ${versionStr}`);
    return;
  }
  return semver;
};

const CTA_CONFIGURE_LSP_PATH = "Configure path to pkl-lsp";

const tellInvalidConfiguredLspPath = async () => {
  const response = await vscode.window.showWarningMessage(
    `Configured path ${config.lspPath} is not a valid lsp jar.`,
    CTA_CONFIGURE_LSP_PATH
  );
  if (response === CTA_CONFIGURE_LSP_PATH) {
    vscode.commands.executeCommand(COMMAND_OPEN_WORKSPACE_SETTINGS, CONFIG_LSP_PATH);
  }
};

const handleConfiguredLspDistribution = async (lspPath: string) => {
  try {
    const version = await getLspVersion(lspPath);
    if (version === undefined) {
      tellInvalidConfiguredLspPath();
      return;
    }
    // permit a higher version if it exists, but warn users about it.
    if (!version.isCompatibleWith(bundledDistribution.version)) {
      vscode.window.showWarningMessage(
        `This version of pkl-vscode is not compatible with pkl-lsp version ${version}. Features are not guaranteed to work.`
      );
    }
    const distro = { path: lspPath, version };
    logger.log(`Using pkl-lsp.jar from configured ${CONFIG_LSP_PATH}`);
    currentLspDistribution = distro;
    emitter.fire(distro);
  } catch (err) {
    tellInvalidConfiguredLspPath();
  }
};

/**
 * Get the highest supported pkl-lsp distribution.
 */
const getDownloadedDistribution = async (): Promise<LspDistribution | undefined> => {
  try {
    const distroFolders = await fs.readdir(LSP_DISTRIBUTIONS_DIR);
    const versions = distroFolders
      .map(Semver.parse)
      .filter(
        (it): it is Semver => it !== undefined && it.isCompatibleWith(bundledDistribution.version)
      )
      .sort((a, b) => -a.compareTo(b));
    for (const version of versions) {
      const lspJar = path.join(LSP_DISTRIBUTIONS_DIR, version.toString(), `pkl-lsp-${version}.jar`);
      if (await isRegularFile(lspJar)) {
        return { path: lspJar, version };
      }
    }
  } catch (err) {
    return;
  }
};

vscode.workspace.onDidChangeConfiguration(
  // debounce because vscode fires configuration changes _as_ users are typing.
  debounce(async (event: vscode.ConfigurationChangeEvent) => {
    if (!event.affectsConfiguration(CONFIG_LSP_PATH) || config.lspPath === undefined) {
      return;
    }
    handleConfiguredLspDistribution(config.lspPath);
  }, 5000)
);

(async () => {
  if (config.lspPath !== undefined) {
    await handleConfiguredLspDistribution(config.lspPath);
    // currentLspDistribution only gets set if it was a valid distribution.
    if (currentLspDistribution !== undefined) {
      return;
    }
  }
  let distro = await getDownloadedDistribution();
  if (distro !== undefined && distro.version.isGreaterThan(bundledDistribution.version)) {
    logger.log(`Using downloaded pkl-lsp.jar at ${distro.path}`);
  } else {
    distro = bundledDistribution;
    logger.log(`Using built-in pkl-lsp.jar`);
  }
  currentLspDistribution = distro;
  emitter.fire(distro);
})();
