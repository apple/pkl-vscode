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

import { afterEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { httpsDownload, httpsGetText } from "../src/ts/utils";

class FakeIncomingMessage extends EventEmitter {
  statusCode?: number;
  setEncoding(_encoding: string) {}
  resume() {}
}

class FakeClientRequest extends EventEmitter {}

describe("HTTP utils", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("rejects httpsGetText on request error", async () => {
    mock.method(https, "get", (() => {
      const req = new FakeClientRequest();
      queueMicrotask(() => req.emit("error", new Error("ECONNREFUSED")));
      return req;
    }) as any);

    await assert.rejects(httpsGetText("https://example.invalid/test"), /ECONNREFUSED/);
  });

  it("rejects httpsDownload on non-200 status and removes temporary directory", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pkl-vscode-test-"));
    const dest = path.join(tmpRoot, "artifact.jar");
    const before = new Set(await fs.readdir(os.tmpdir()));

    mock.method(https, "get", ((_url: any, cb: (res: any) => void) => {
      const req = new FakeClientRequest();
      const res = new FakeIncomingMessage();
      res.statusCode = 404;
      queueMicrotask(() => cb(res));
      return req;
    }) as any);

    try {
      await assert.rejects(
        httpsDownload("https://example.invalid/missing.jar", dest, "deadbeef"),
        /HTTP 404/,
      );
      const after = await fs.readdir(os.tmpdir());
      const leaked = after.filter((name) => name.startsWith("pkl-vscode-") && !before.has(name));
      assert.deepEqual(leaked, []);
    } finally {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it("downloads file, verifies checksum, flushes stream, and removes temporary directory", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pkl-vscode-test-"));
    const dest = path.join(tmpRoot, "nested", "artifact.jar");
    const payload = Buffer.from("pkl-lsp-binary-contents");
    const expectedChecksum = crypto.createHash("sha256").update(payload).digest("hex");
    const before = new Set(await fs.readdir(os.tmpdir()));

    mock.method(https, "get", ((_url: any, cb: (res: any) => void) => {
      const req = new FakeClientRequest();
      const res = new FakeIncomingMessage();
      res.statusCode = 200;
      queueMicrotask(() => {
        cb(res);
        res.emit("data", payload);
        res.emit("end");
      });
      return req;
    }) as any);

    try {
      await httpsDownload("https://example.invalid/ok.jar", dest, expectedChecksum);
      const written = await fs.readFile(dest);
      assert.deepEqual(written, payload);
      const after = await fs.readdir(os.tmpdir());
      const leaked = after.filter((name) => name.startsWith("pkl-vscode-") && !before.has(name));
      assert.deepEqual(leaked, []);
    } finally {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    }
  });
});
