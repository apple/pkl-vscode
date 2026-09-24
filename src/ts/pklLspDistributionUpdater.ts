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
import * as vscode from "vscode";
import {
  COMMAND_RELOAD_WORKSPACE_WINDOW,
  LSP_DISTRIBUTIONS_DIR,
  LSP_EXECUTABLE_NAME,
  LSP_GITHUB_REPO,
  MINIMUM_LSP_VERSION,
} from "./consts";
import { GitHubRelease, getLatestRelease, getSha256Checksum } from "./clients/github";
import { httpsDownload, isRegularFile } from "./utils";
import logger from "./clients/logger";
import Semver from "./Semver";
import type { LspDistribution } from "./pklLspDistribution";

export const minimumLspVersion = Semver.parse(MINIMUM_LSP_VERSION)!!;

const isMusl = (): boolean => {
  const report = process.report?.getReport() as any;
  return report?.header?.glibcVersionRuntime === undefined;
};

/**
 * The name of the pkl-lsp release asset for the current platform, or `undefined` if pkl-lsp is not
 * published as a native executable for this platform.
 */
export const getPlatformAssetName = (): string | undefined => {
  switch (`${process.platform}-${process.arch}`) {
    case "darwin-arm64":
      return "pkl-lsp-macos-aarch64";
    case "linux-x64":
      return isMusl() ? "pkl-lsp-alpine-linux-amd64" : "pkl-lsp-linux-amd64";
    case "linux-arm64":
      return isMusl() ? undefined : "pkl-lsp-linux-aarch64";
    case "win32-x64":
      return "pkl-lsp-windows-amd64.exe";
    default:
      return undefined;
  }
};

/**
 * The path that a downloaded pkl-lsp distribution of the given version is saved to.
 */
export const getDownloadedDistributionPath = (version: Semver): string =>
  path.join(LSP_DISTRIBUTIONS_DIR, version.toString(), LSP_EXECUTABLE_NAME);

/**
 * Get the latest release of pkl-lsp, if it is compatible with this extension.
 */
export const getLatestCompatibleLspRelease = async (): Promise<GitHubRelease | undefined> => {
  const release = await getLatestRelease(LSP_GITHUB_REPO);
  if (!release.version.isCompatibleWith(minimumLspVersion)) {
    logger.log(`Latest version of pkl-lsp is ${release.version}, which I am not compatible with.`);
    return;
  }
  return release;
};

/**
 * Download the native executable of the given pkl-lsp release for the current platform.
 */
export const downloadLspDistribution = async (release: GitHubRelease): Promise<LspDistribution> => {
  const assetName = getPlatformAssetName();
  const asset = release.assets.find((it) => it.name === assetName);
  if (asset === undefined) {
    throw new Error(`pkl-lsp ${release.version} does not have an executable named ${assetName}`);
  }
  const checksum = getSha256Checksum(asset);
  if (checksum === undefined) {
    throw new Error(`pkl-lsp ${release.version} does not have a SHA-256 checksum for ${assetName}`);
  }
  const pathOnDisk = getDownloadedDistributionPath(release.version);
  logger.log(`Downloading ${asset.browser_download_url} to ${pathOnDisk}`);
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Downloading pkl-lsp ${release.version}`,
    },
    () => httpsDownload(asset.browser_download_url, pathOnDisk, checksum),
  );
  return { path: pathOnDisk, version: release.version, source: "downloaded" };
};

/**
 * Offer to download a newer version of pkl-lsp, if one exists.
 *
 * Only distributions that were downloaded by this extension are updated.
 */
export const queryForLatestLspDistribution = async (current: LspDistribution) => {
  if (current.source !== "downloaded" || getPlatformAssetName() === undefined) {
    return;
  }
  try {
    const release = await getLatestCompatibleLspRelease();
    if (release === undefined) {
      return;
    }
    if (current.version.isGreaterThanOrEqualTo(release.version)) {
      logger.log(
        `Latest version of pkl-lsp is ${release.version}, which is less than or equal to the current version.`,
      );
      return;
    }
    if (await isRegularFile(getDownloadedDistributionPath(release.version))) {
      logger.log(`Latest version of pkl-lsp is ${release.version}, and it is already downloaded.`);
      return;
    }
    const callToAction = "Download and reload VSCode";
    const response = await vscode.window.showInformationMessage(
      `A new version of pkl-lsp (${release.version}) is available.`,
      callToAction,
      "Later",
    );
    if (response !== callToAction) {
      return;
    }
    await downloadLspDistribution(release);
    vscode.commands.executeCommand(COMMAND_RELOAD_WORKSPACE_WINDOW);
  } catch (err) {
    logger.error(`Failed to handle query for latest distribution: ${err}`);
  }
};
