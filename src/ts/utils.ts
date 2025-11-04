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

import { promisify } from "node:util";
import { execFile as _execFile } from "node:child_process";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import https from "node:https";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";

export const execFile = promisify(_execFile);

export const debounce = <A extends any[]>(
  f: (...args: A) => any,
  wait: number,
): ((...args: A) => void) => {
  let timeout: NodeJS.Timeout | undefined = undefined;
  return (...args: A) => {
    if (timeout != null) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => f(...args), wait);
  };
};

/**
 * Tells if the file exists, and is a file (and not a directory).
 */
export const isRegularFile = async (filepath: string) => {
  try {
    const stats = await fs.stat(filepath);
    return stats.isFile();
  } catch (err: any) {
    if (err.code !== "ENOENT") {
      throw err;
    }
    return false;
  }
};

/**
 * Make an HTTPS GET request to the provided URL, parsing the response body as UTF-8 encoded text.
 */
export const httpsGetText = (url: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { accept: "*/*", "user-agent": "pkl-vscode" } }, (response) => {
      response.setEncoding("utf-8");
      let body = "";
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        if (response.statusCode !== 200) {
          reject(new Error(body));
        } else {
          resolve(body);
        }
      });
      response.on("error", (err) => {
        reject(err);
      });
    });
  });
};

/**
 * Make an HTTPS GET request to the provided URL and parse the response as JSON.
 */
export const httpsGetJson = async <T>(url: string): Promise<T> => {
  const text = await httpsGetText(url);
  return JSON.parse(text) as T;
};

const downloadAndComputeChecksum = async (url: string, dest: string): Promise<string> => {
  const writeStream = createWriteStream(dest, { mode: 0o755 });
  const hash = crypto.createHash("sha256");
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      response
        .on("data", (chunk) => {
          hash.update(chunk);
          writeStream.write(chunk);
        })
        .on("end", () => {
          const computedChecksum = hash.digest().toString("hex");
          writeStream.end();
          resolve(computedChecksum);
        })
        .on("error", (err) => {
          writeStream.destroy(err);
          reject(err);
        });
    });
  });
};

/**
 * Downloads the file at the specified URL, verifying its contents against the provided checksum.
 */
export const httpsDownload = async (url: string, dest: string, checksum: string): Promise<void> => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pkl-vscode-"));
  const tempFile = `${tempDir}/contents.download`;
  const computedChecksum = await downloadAndComputeChecksum(url, tempFile);
  if (computedChecksum === checksum) {
    await fs.mkdir(path.resolve(dest, ".."), { recursive: true });
    await fs.rename(tempFile, dest);
  } else {
    throw new Error(`Failed to download ${url}: expected ${checksum}, but got ${computedChecksum}`);
  }
};
