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

import { httpsGetJson } from "../utils";
import Semver from "../Semver";

type GitHubReleaseResponse = {
  tag_name: string;
  assets: GitHubReleaseAsset[];
};

export type GitHubReleaseAsset = {
  name: string;
  browser_download_url: string;
  /**
   * Digest of the asset, in the form `<algorithm>:<hex>`, e.g. `sha256:abc123`.
   */
  digest: string | null;
};

export type GitHubRelease = {
  version: Semver;
  assets: GitHubReleaseAsset[];
};

/**
 * Get the latest (non-prerelease) release of the given repository, in the form `owner/repo`.
 */
export const getLatestRelease = async (repo: string): Promise<GitHubRelease> => {
  const response = await httpsGetJson<GitHubReleaseResponse>(
    `https://api.github.com/repos/${repo}/releases/latest`,
  );
  const version = Semver.parse(response.tag_name);
  if (version === undefined) {
    throw new Error(`Got a release from GitHub that is not valid semver: ${response.tag_name}`);
  }
  return { version, assets: response.assets };
};

/**
 * Get the SHA-256 checksum of a release asset, as a hex string.
 */
export const getSha256Checksum = (asset: GitHubReleaseAsset): string | undefined => {
  const [algorithm, checksum] = asset.digest?.split(":") ?? [];
  return algorithm === "sha256" ? checksum : undefined;
};
