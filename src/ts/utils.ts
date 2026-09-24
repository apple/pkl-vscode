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

import { promisify } from "node:util";
import { execFile as _execFile } from "node:child_process";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline as _pipeline } from "node:stream";
import https from "node:https";
import { IncomingMessage } from "node:http";
import crypto from "node:crypto";
import path from "node:path";

export const execFile = promisify(_execFile);

const pipeline = promisify(_pipeline);

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

const MAX_REDIRECTS = 5;

/**
 * Make an HTTPS GET request to the provided URL, following redirects.
 */
const httpsGetFollowingRedirects = (
  url: string,
  redirectsLeft: number = MAX_REDIRECTS,
): Promise<IncomingMessage> => {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "user-agent": "pkl-vscode" } }, (response) => {
        const { statusCode, headers } = response;
        if (statusCode !== undefined && statusCode >= 300 && statusCode < 400 && headers.location) {
          response.resume();
          if (redirectsLeft === 0) {
            reject(new Error(`Too many redirects when fetching ${url}`));
            return;
          }
          const location = new URL(headers.location, url).toString();
          httpsGetFollowingRedirects(location, redirectsLeft - 1).then(resolve, reject);
          return;
        }
        if (statusCode !== 200) {
          response.resume();
          reject(new Error(`Failed to fetch ${url}: got status code ${statusCode}`));
          return;
        }
        resolve(response);
      })
      .on("error", reject);
  });
};

const downloadAndComputeChecksum = async (url: string, dest: string): Promise<string> => {
  const response = await httpsGetFollowingRedirects(url);
  const hash = crypto.createHash("sha256");
  await pipeline(
    response,
    async function* (source: AsyncIterable<Buffer>) {
      for await (const chunk of source) {
        hash.update(chunk);
        yield chunk;
      }
    },
    createWriteStream(dest, { mode: 0o755 }),
  );
  return hash.digest().toString("hex");
};

/**
 * Downloads the file at the specified URL, verifying its contents against the provided SHA-256
 * checksum.
 */
export const httpsDownload = async (url: string, dest: string, checksum: string): Promise<void> => {
  const destDir = path.dirname(dest);
  await fs.mkdir(destDir, { recursive: true });
  // download next to the destination
  const suffix = crypto.randomBytes(8).toString("hex");
  const tempFile = path.join(destDir, `.${path.basename(dest)}.${suffix}.download`);
  try {
    const computedChecksum = await downloadAndComputeChecksum(url, tempFile);
    if (computedChecksum !== checksum) {
      throw new Error(
        `Failed to download ${url}: expected checksum ${checksum}, but got ${computedChecksum}`,
      );
    }
    await fs.rename(tempFile, dest);
  } finally {
    await fs.rm(tempFile, { force: true });
  }
};
