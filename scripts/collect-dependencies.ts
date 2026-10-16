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

/**
 * Collects the source code (including license files) of every 3rd party component that is
 * distributed inside the pkl-vscode vsix, and bundles it into a zip.
 *
 * Usage: npm run collect-dependencies -- [--output <path.zip>] [--registry <url>]
 *
 * Each component gets its own folder in the archive:
 *
 *   <name>-<version>/npm/       the exact npm tarball we ship (verified against package-lock.json)
 *   <name>-<version>/upstream/  the upstream git source at the matching commit
 *
 * Components:
 *
 *   - npm production dependencies (what vsce packages into node_modules/), taken from
 *     package-lock.json.
 *   - @apple/tree-sitter-pkl: a dev dependency, but it is compiled into out/pkl.wasm.
 *   - apple/pkl.tmbundle (git submodule): out/pkl.tmLanguage.json is generated from it.
 *   - emscripten: its runtime (libc, malloc, JS glue) is linked into tree-sitter.wasm and
 *     pkl.wasm. Included at the version used for each of them.
 *
 * Dev dependencies and build tools that are not shipped are excluded.
 *
 * Requires network access to the npm registry and GitHub, and the `tar` and `zip` executables.
 * Set GITHUB_TOKEN (or have `gh` logged in) to avoid GitHub API rate limits. If you are behind an
 * HTTP proxy, set NODE_USE_ENV_PROXY=1 so that Node honors HTTPS_PROXY.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

const ROOT = path.resolve(__dirname, "..");

/** Dev dependencies whose build output ends up in the vsix. */
const SHIPPED_DEV_DEPENDENCIES: Record<string, string> = {
  "@apple/tree-sitter-pkl": "compiled into out/pkl.wasm",
};

/**
 * Upstream paths to collect for monorepos, in addition to top-level files (LICENSE, etc.).
 * Defaults to the `repository.directory` of the package, or the whole repo if unset.
 */
const UPSTREAM_PATHS: Record<string, string[]> = {
  // tree-sitter.wasm is compiled from the C runtime in lib/src, not just lib/binding_web.
  "web-tree-sitter": ["lib"],
};

/**
 * Parts of emscripten that can end up in a compiled binary: system libraries (musl libc, dlmalloc,
 * compiler-rt, ...), their headers, and the JS runtime/glue (tree-sitter.cjs).
 */
const EMSCRIPTEN_PATHS = ["system/lib", "system/include", "src"];

/** Dual licensed (see its LICENSE file), which GitHub's license API reports as NOASSERTION. */
const EMSCRIPTEN_LICENSE = "MIT OR NCSA";

const NPM_DEFAULT_REGISTRY = "https://registry.npmjs.org";
const USER_AGENT = "pkl-vscode-collect-dependencies";

class Fatal extends Error {}

class HttpError extends Error {
  constructor(
    readonly status: number,
    url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
  }
}

function log(msg: string): void {
  console.error(msg);
}

// ---------------------------------------------------------------------------------------------
// HTTP

function githubToken(): string | undefined {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) {
    return token;
  }
  try {
    return execFileSync("gh", ["auth", "token"], { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}

const GITHUB_TOKEN = githubToken();

async function fetchRetry(
  url: string,
  headers: Record<string, string> = {},
  retries = 3,
): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    let failure: unknown;
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, ...headers } });
      if (res.ok) {
        return res;
      }
      await res.body?.cancel();
      failure = new HttpError(res.status, url);
    } catch (e) {
      failure = e;
    }
    const retryable = !(failure instanceof HttpError) || failure.status >= 500;
    if (!retryable || attempt >= retries) {
      throw failure;
    }
    await sleep(2 ** attempt * 1000);
  }
}

async function httpGetJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  return (await (await fetchRetry(url, headers)).json()) as T;
}

async function httpDownload(url: string, dest: string): Promise<void> {
  const res = await fetchRetry(url);
  await pipeline(Readable.fromWeb(res.body as WebReadableStream), fs.createWriteStream(dest));
}

async function githubApi<T>(apiPath: string): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  }
  return httpGetJson<T>(`https://api.github.com/${apiPath}`, headers);
}

/** Rethrows `e` unless it is an HttpError with one of the given statuses. */
function expectHttpError(e: unknown, ...statuses: number[]): void {
  if (!(e instanceof HttpError && statuses.includes(e.status))) {
    throw e;
  }
}

async function githubFile(repo: string, filePath: string, ref: string): Promise<Buffer | null> {
  try {
    const { content } = await githubApi<{ content: string }>(
      `repos/${repo}/contents/${filePath}?ref=${encodeURIComponent(ref)}`,
    );
    return Buffer.from(content, "base64");
  } catch (e) {
    expectHttpError(e, 404);
    return null;
  }
}

async function githubResolveCommit(repo: string, ref: string): Promise<string | null> {
  try {
    const { sha } = await githubApi<{ sha: string }>(
      `repos/${repo}/commits/${encodeURIComponent(ref)}`,
    );
    return sha;
  } catch (e) {
    expectHttpError(e, 404, 422);
    return null;
  }
}

async function githubLicense(repo: string): Promise<string | null> {
  try {
    const { license } = await githubApi<{ license?: { spdx_id?: string } }>(
      `repos/${repo}/license`,
    );
    const spdx = license?.spdx_id;
    return !spdx || spdx === "NOASSERTION" ? null : spdx;
  } catch (e) {
    if (e instanceof HttpError) {
      return null;
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------
// Components

interface Upstream {
  /** owner/name on GitHub */
  repo: string;
  commit: string;
  /** Empty means the whole repo. */
  paths: string[];
  resolvedBy: string;
}

interface Component {
  name: string;
  version: string;
  license: string | null;
  reason: string;
  npmTarball?: string;
  npmIntegrity?: string;
  upstream?: Upstream;
  notes: string[];
}

function folderOf(c: Component): string {
  return `${c.name.replace(/^@+/, "").replaceAll("/", "-")}-${c.version}`;
}

interface LockEntry {
  version: string;
  resolved: string;
  integrity: string;
  license?: string;
  dev?: boolean;
  link?: boolean;
}

interface NpmMetadata {
  license?: string;
  gitHead?: string;
  repository?: string | { url?: string; directory?: string };
}

function npmRegistry(): string {
  try {
    const registry = execFileSync("npm", ["config", "get", "registry"], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    if (registry.startsWith("http")) {
      return registry;
    }
  } catch {
    // fall through
  }
  return NPM_DEFAULT_REGISTRY;
}

function parseGithubRepo(repository: unknown): string | null {
  const url =
    typeof repository === "object" && repository !== null
      ? (repository as { url?: unknown }).url
      : repository;
  if (typeof url !== "string") {
    return null;
  }
  if (/^[\w.-]+\/[\w.-]+$/.test(url)) {
    // "owner/repo" shorthand
    return url;
  }
  const m =
    /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url) ??
    /^github:([\w.-]+)\/([\w.-]+)$/.exec(url);
  return m ? `${m[1]}/${m[2]}` : null;
}

async function findReleaseCommit(
  repo: string,
  name: string,
  version: string,
  directory: string | undefined,
  gitHead: string | undefined,
): Promise<{ commit: string | null; how: string }> {
  if (gitHead) {
    return { commit: gitHead, how: "gitHead in npm metadata" };
  }
  const tags = [`v${version}`, version, `${name}@${version}`, `${name}-v${version}`];
  if (directory) {
    tags.push(`release/${directory}/${version}`, `${directory}/${version}`);
  }
  for (const tag of tags) {
    const commit = await githubResolveCommit(repo, `refs/tags/${tag}`);
    if (commit) {
      return { commit, how: `tag ${tag}` };
    }
  }
  // No tag: use the oldest commit in which package.json has this version (the release commit).
  const pkgJson = directory ? `${directory}/package.json` : "package.json";
  const commits = await githubApi<{ sha: string }[]>(
    `repos/${repo}/commits?path=${pkgJson}&per_page=30`,
  );
  let match: string | undefined;
  for (const { sha } of commits) {
    const content = await githubFile(repo, pkgJson, sha);
    const found = content ? (JSON.parse(content.toString()) as { version?: string }).version : null;
    if (found === version) {
      match = sha;
    } else if (match) {
      break;
    }
  }
  if (match) {
    return {
      commit: match,
      how: `approximate: oldest commit with version ${version} in ${pkgJson} (no tag)`,
    };
  }
  return { commit: null, how: "not found" };
}

async function npmComponents(registry: string): Promise<Component[]> {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8")) as {
    lockfileVersion?: number;
    packages: Record<string, LockEntry>;
  };
  if ((lock.lockfileVersion ?? 1) < 2) {
    throw new Fatal("package-lock.json must be lockfileVersion 2 or later");
  }
  const components = new Map<string, Component>();
  for (const [lockPath, entry] of Object.entries(lock.packages)) {
    if (!lockPath.startsWith("node_modules/") || entry.link) {
      continue;
    }
    const name = lockPath.slice(lockPath.lastIndexOf("node_modules/") + "node_modules/".length);
    let reason: string;
    if (entry.dev) {
      if (!(name in SHIPPED_DEV_DEPENDENCIES)) {
        continue;
      }
      reason = SHIPPED_DEV_DEPENDENCIES[name];
    } else {
      reason = "npm production dependency (packaged in node_modules/)";
    }
    const key = `${name}@${entry.version}`;
    if (components.has(key)) {
      continue;
    }
    log(`Resolving ${key}`);
    const meta = await httpGetJson<NpmMetadata>(
      `${registry}/${name.replaceAll("/", "%2F")}/${entry.version}`,
    );
    const component: Component = {
      name,
      version: entry.version,
      license: entry.license || meta.license || null,
      reason,
      npmTarball: entry.resolved,
      npmIntegrity: entry.integrity,
      notes: [],
    };
    const repo = parseGithubRepo(meta.repository);
    const directory = typeof meta.repository === "object" ? meta.repository.directory : undefined;
    if (repo) {
      const { commit, how } = await findReleaseCommit(
        repo,
        name,
        entry.version,
        directory,
        meta.gitHead,
      );
      if (commit) {
        const paths = UPSTREAM_PATHS[name] ?? (directory ? [directory] : []);
        component.upstream = { repo, commit, paths, resolvedBy: how };
        if (how.startsWith("approximate")) {
          component.notes.push(how);
        }
      } else {
        component.notes.push(`upstream commit for ${repo} could not be determined`);
      }
    } else {
      component.notes.push("no GitHub repository in package metadata");
    }
    components.set(key, component);
  }
  return [...components.values()];
}

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT }).toString().trim();
}

async function tmbundleComponent(): Promise<Component> {
  const commit = git("ls-tree", "HEAD", "textmate-bundle").split(/\s+/)[2];
  const url = git("config", "-f", ".gitmodules", "submodule.textmate-bundle.url");
  const repo = parseGithubRepo(url);
  if (!repo) {
    throw new Fatal(`unexpected submodule url ${url}`);
  }
  return {
    name: repo.split("/")[1],
    version: commit.slice(0, 12),
    license: await githubLicense(repo),
    reason: "out/pkl.tmLanguage.json is generated from it",
    upstream: { repo, commit, paths: [], resolvedBy: "git submodule textmate-bundle" },
    notes: [],
  };
}

async function emscriptenComponents(components: Component[]): Promise<Component[]> {
  const versions = new Map<string, string[]>();
  const addBinary = (version: string, binary: string) =>
    versions.set(version, [...(versions.get(version) ?? []), binary]);

  // tree-sitter.wasm: built by tree-sitter with the emscripten version pinned in its repo.
  const webTreeSitter = components.find((c) => c.name === "web-tree-sitter")?.upstream;
  if (webTreeSitter) {
    let version: string | undefined;
    for (const file of ["crates/loader/emscripten-version", "cli/loader/emscripten-version"]) {
      const content = await githubFile(webTreeSitter.repo, file, webTreeSitter.commit);
      if (content) {
        version = content.toString().trim();
        break;
      }
    }
    if (!version) {
      throw new Fatal("Could not determine the emscripten version used by web-tree-sitter");
    }
    addBinary(version, "node_modules/web-tree-sitter/tree-sitter.wasm, tree-sitter.cjs");
  }

  // pkl.wasm: built by our release workflow.
  const workflow = fs.readFileSync(path.join(ROOT, ".github/workflows/release.yml"), "utf8");
  const pklWasmVersion = /emsdk install (\S+)/.exec(workflow)?.[1];
  if (!pklWasmVersion) {
    throw new Fatal("Could not determine the emscripten version from release.yml");
  }
  addBinary(pklWasmVersion, "out/pkl.wasm");

  const repo = "emscripten-core/emscripten";
  const result: Component[] = [];
  for (const [version, binaries] of versions) {
    const commit = await githubResolveCommit(repo, `refs/tags/${version}`);
    if (!commit) {
      throw new Fatal(`emscripten tag ${version} not found`);
    }
    result.push({
      name: "emscripten",
      version,
      license: EMSCRIPTEN_LICENSE,
      reason: `runtime linked into ${binaries.join("; ")}`,
      upstream: { repo, commit, paths: EMSCRIPTEN_PATHS, resolvedBy: `tag ${version}` },
      notes: [],
    });
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Archive

function run(command: string, args: string[], cwd?: string): void {
  try {
    execFileSync(command, args, { cwd, stdio: ["ignore", "ignore", "inherit"] });
  } catch (e) {
    throw new Fatal(`\`${command}\` failed (is it installed?): ${(e as Error).message}`);
  }
}

function verifyIntegrity(file: string, integrity: string): void {
  const content = fs.readFileSync(file);
  // Subresource integrity: one or more space separated `<algorithm>-<base64 digest>`.
  const valid = integrity.split(/\s+/).some((candidate) => {
    const [algorithm, expected] = candidate.split("-", 2);
    return createHash(algorithm).update(content).digest("base64") === expected;
  });
  if (!valid) {
    throw new Fatal(`integrity mismatch for ${path.basename(file)}`);
  }
}

/**
 * Extracts the tarball `archive` into `dest`, stripping its top-level folder.
 *
 * Archives are untrusted: `tar` refuses to write outside of `dest`, and symlinks are removed so
 * that they can't make the zip pick up files from elsewhere on this machine.
 */
function extract(archive: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  run("tar", ["-xzf", archive, "--strip-components=1", "-C", dest]);
  for (const entry of fs.readdirSync(dest, { withFileTypes: true, recursive: true })) {
    if (entry.isSymbolicLink()) {
      fs.rmSync(path.join(entry.parentPath, entry.name));
    }
  }
}

/**
 * Copies the top-level files (LICENSE, etc.) and the given `paths` of `src` into `dest`. Copies
 * everything if there are no `paths`.
 */
function copySelected(src: string, dest: string, paths: string[]): void {
  fs.mkdirSync(dest, { recursive: true });
  if (paths.length === 0) {
    fs.cpSync(src, dest, { recursive: true });
    return;
  }
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.isFile()) {
      fs.cpSync(path.join(src, entry.name), path.join(dest, entry.name));
    }
  }
  for (const p of paths) {
    if (!fs.existsSync(path.join(src, p))) {
      throw new Fatal(`${p} not found in ${path.basename(src)}`);
    }
    fs.mkdirSync(path.dirname(path.join(dest, p)), { recursive: true });
    fs.cpSync(path.join(src, p), path.join(dest, p), { recursive: true });
  }
}

function readme(components: Component[], version: string): string {
  const lines = [
    `# Third party sources for pkl-vscode ${version}`,
    "",
    "Source code of all 3rd party components distributed in the pkl-vscode vsix.",
    "Each folder contains `npm/` (the published npm package we ship, when applicable)",
    "and/or `upstream/` (the upstream source at the matching git commit).",
    "See MANIFEST.json for exact URLs, checksums and commits.",
    "",
    "| Folder | License | Shipped as |",
    "|---|---|---|",
    ...components.map((c) => `| ${folderOf(c)} | ${c.license ?? "see folder"} | ${c.reason} |`),
  ];
  const notes = components.flatMap((c) => c.notes.map((n) => `- ${folderOf(c)}: ${n}`));
  if (notes.length > 0) {
    lines.push("", "## Notes", "", ...notes);
  }
  return `${lines.join("\n")}\n`;
}

function manifest(components: Component[], version: string): string {
  return `${JSON.stringify(
    {
      "pkl-vscode": version,
      components: components.map((c) => ({
        folder: folderOf(c),
        name: c.name,
        version: c.version,
        license: c.license,
        reason: c.reason,
        npm: c.npmTarball ? { tarball: c.npmTarball, integrity: c.npmIntegrity } : null,
        upstream: c.upstream
          ? {
              repository: `https://github.com/${c.upstream.repo}`,
              commit: c.upstream.commit,
              resolvedBy: c.upstream.resolvedBy,
              paths: c.upstream.paths.length > 0 ? c.upstream.paths : ["."],
            }
          : null,
        notes: c.notes,
      })),
    },
    null,
    2,
  )}\n`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      output: { type: "string", short: "o" },
      registry: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    log("Usage: npm run collect-dependencies -- [-o|--output <path.zip>] [--registry <url>]");
    return;
  }

  const version = (
    JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { version: string }
  ).version;
  const top = `pkl-vscode-${version}-third-party-sources`;
  const output = path.resolve(values.output ?? path.join(ROOT, ".dist", `${top}.zip`));
  if (!output.endsWith(".zip")) {
    throw new Fatal(`output must be a .zip file: ${output}`);
  }
  const registry = (values.registry ?? npmRegistry()).replace(/\/+$/, "");
  log(`Using npm registry ${registry}`);
  if (!GITHUB_TOKEN) {
    log("Warning: no GitHub token found, API rate limits may apply");
  }
  if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
    log("Warning: HTTPS_PROXY is set but NODE_USE_ENV_PROXY=1 is not, so Node will ignore it");
  }

  const components = await npmComponents(registry);
  components.push(await tmbundleComponent());
  components.push(...(await emscriptenComponents(components)));
  components.sort((a, b) => (folderOf(a) < folderOf(b) ? -1 : 1));

  // Downloaded archives are untrusted: each kind of file lives in its own empty directory.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pkl-vscode-collect-dependencies-"));
  const downloads = path.join(tmp, "downloads");
  const extracted = path.join(tmp, "extracted");
  const staging = path.join(tmp, "staging"); // what ends up in the zip
  const root = path.join(staging, top);
  fs.mkdirSync(downloads);
  fs.mkdirSync(root, { recursive: true });
  try {
    for (const c of components) {
      const folder = path.join(root, folderOf(c));
      if (c.npmTarball) {
        // Fetch from the configured registry; the integrity check guarantees we get the exact
        // tarball that package-lock.json pins.
        const url = `${registry}${new URL(c.npmTarball).pathname}`;
        log(`Downloading ${c.name}@${c.version} from npm`);
        const archive = path.join(downloads, "npm.tgz");
        await httpDownload(url, archive);
        verifyIntegrity(archive, c.npmIntegrity ?? "");
        extract(archive, path.join(folder, "npm"));
      }
      if (c.upstream) {
        const u = c.upstream;
        log(`Downloading ${u.repo}@${u.commit.slice(0, 12)} (${folderOf(c)})`);
        const archive = path.join(downloads, "upstream.tgz");
        await httpDownload(`https://codeload.github.com/${u.repo}/tar.gz/${u.commit}`, archive);
        fs.rmSync(extracted, { recursive: true, force: true });
        extract(archive, extracted);
        copySelected(extracted, path.join(folder, "upstream"), u.paths);
      }
    }
    fs.writeFileSync(path.join(root, "MANIFEST.json"), manifest(components, version));
    fs.writeFileSync(path.join(root, "README.md"), readme(components, version));

    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.rmSync(output, { force: true });
    try {
      run("zip", ["-r", "-q", "-X", output, top], staging);
    } catch (e) {
      fs.rmSync(output, { force: true });
      throw e;
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  log("");
  for (const c of components) {
    log(`  ${folderOf(c).padEnd(45)} ${(c.license ?? "?").padEnd(16)} ${c.reason}`);
    for (const note of c.notes) {
      log(`    note: ${note}`);
    }
  }
  const relative = path.relative(ROOT, output);
  log(`\nWrote ${relative.startsWith("..") ? output : relative}`);
}

main().catch((e) => {
  console.error(e instanceof Fatal ? `error: ${e.message}` : e);
  process.exit(1);
});
