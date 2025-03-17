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

import fs from "node:fs/promises";
import path from "node:path";
import * as vscode from "vscode";
import { debounce, execFile } from "./utils";
import { COMMAND_OPEN_WORKSPACE_SETTINGS, CONFIG_JAVA_PATH } from "./consts";
import config from "./config";
import logger from "./clients/logger";

const emitter = new vscode.EventEmitter<JavaDistribution>();

const MINIMUM_JAVA_VERSION = 22;

/**
 * The currently configured Java distribution, if any.
 */
export let currentJavaDistribution: JavaDistribution | undefined = undefined;

/**
 * Fires when the java distribution changes due to users changing it in workspace/user settings.
 *
 * Also fires on startup if there is a suitable Java distribution.
 *
 * Excludes Java versions that are incompatible.
 */
export const onDidChangeJavaDistribution = emitter.event;

export const getJavaDistribution = (): Promise<JavaDistribution> => {
  return new Promise((resolve) => {
    if (currentJavaDistribution !== undefined) {
      resolve(currentJavaDistribution);
      return;
    }
    const disposables: vscode.Disposable[] = [];
    onDidChangeJavaDistribution(
      (distribution) => {
        resolve(distribution);
        disposables.every((it) => it.dispose());
      },
      null,
      disposables
    );
  });
};

export type JavaDistribution = {
  path: string;
  version: number;
};

const resolveJava = async (path: string): Promise<JavaDistribution | null> => {
  try {
    const stats = await fs.stat(path);
    if (!stats.isFile()) {
      return null;
    }
    const result = await execFile(path, ["-version"]);
    const { stderr } = result;
    const versionStr = stderr.split('"')[1];
    if (versionStr == null) {
      logger.warn(`Unexpected version string: ${stderr}`);
      return null;
    }
    const majorVersion = versionStr.split(".")[0];
    if (majorVersion == null) {
      logger.warn(`Malformed version: ${versionStr}`);
      return null;
    }
    var version = parseInt(majorVersion);
    return { path, version };
  } catch (err: any) {
    if (err.code !== "ENOENT") {
      logger.warn(`Received unexpected error when spawning java: ${err}`);
    }
    return null;
  }
};

const extEnvVar = process.env.PATHEXT ?? "";
const possibleJavaFilenames = extEnvVar.split(path.delimiter).map((it) => `java${it}`);

const findJavaInDir = async (dir: string) => {
  for (const filename of possibleJavaFilenames) {
    const candidate = path.join(dir, filename);
    const java = await resolveJava(candidate);
    if (java != null) {
      return java;
    }
  }
  return null;
};

const CTA_CONFIGURE_JAVA_PATH = "Configure path to Java";

/**
 * Find Java from either `$JAVA_HOME`, or `$PATH`.
 */
const findJavaFromSystem = async () => {
  const javaHome = process.env.JAVA_HOME;
  if (javaHome != null) {
    var distro = await findJavaInDir(path.join(javaHome, "bin"));
    if (distro != null && distro.version >= MINIMUM_JAVA_VERSION) {
      emitter.fire(distro);
      return;
    }
  }
  const pathEnvVar = process.env.PATH;
  if (pathEnvVar != null) {
    for (const pathStr of pathEnvVar.split(path.delimiter)) {
      const distro = await findJavaInDir(pathStr);
      if (distro != null && distro.version >= MINIMUM_JAVA_VERSION) {
        emitter.fire(distro);
        return;
      }
    }
  }
  const response = await vscode.window.showWarningMessage(
    `Cannot find suitable Java in $PATH or $JAVA_HOME. pkl-vscode requires Java ${MINIMUM_JAVA_VERSION} or higher.`,
    CTA_CONFIGURE_JAVA_PATH
  );
  if (response === CTA_CONFIGURE_JAVA_PATH) {
    vscode.commands.executeCommand(COMMAND_OPEN_WORKSPACE_SETTINGS, CONFIG_JAVA_PATH);
  }
};

const handleConfiguredJavaPath = async (path: string) => {
  const distribution = await resolveJava(path);
  if (distribution === null) {
    vscode.window
      .showWarningMessage(
        `Could not resolve Java version information from ${config.javaPath}. Ensure it is the path to the Java executable.`,
        CTA_CONFIGURE_JAVA_PATH
      )
      .then((response) => {
        if (response === CTA_CONFIGURE_JAVA_PATH) {
          vscode.commands.executeCommand(COMMAND_OPEN_WORKSPACE_SETTINGS, CONFIG_JAVA_PATH);
        }
      });
    return;
  }
  if (distribution.version < MINIMUM_JAVA_VERSION) {
    vscode.window
      .showWarningMessage(
        `pkl-vscode requires Java ${MINIMUM_JAVA_VERSION} or higher, but was configured to use version ${distribution.version} in ${CONFIG_JAVA_PATH}`,
        CTA_CONFIGURE_JAVA_PATH
      )
      .then((response) => {
        if (response === CTA_CONFIGURE_JAVA_PATH) {
          vscode.commands.executeCommand(COMMAND_OPEN_WORKSPACE_SETTINGS, CONFIG_JAVA_PATH);
        }
      });
    return;
  }
  currentJavaDistribution = distribution;
  emitter.fire(distribution);
};

if (config.javaPath === undefined) {
  findJavaFromSystem();
} else {
  handleConfiguredJavaPath(config.javaPath);
}

vscode.workspace.onDidChangeConfiguration(
  // debounce because vscode fires configuration changes _as_ users are typing.
  debounce(async (event: vscode.ConfigurationChangeEvent) => {
    if (!event.affectsConfiguration(CONFIG_JAVA_PATH) || config.javaPath === undefined) {
      return;
    }
    handleConfiguredJavaPath(config.javaPath);
  }, 5000)
);
