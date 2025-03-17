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

export default class Semver {
  major: number;
  minor: number;
  patch: number;
  preRelease?: string;
  build?: string;

  static parse(versionStr: string): Semver | undefined {
    const parsed = versionStr.match(SEMVER_REGEXP);
    if (parsed === null) {
      return;
    }
    const [, major, minor, patch, preRelease, build] = parsed;
    return new Semver(parseInt(major), parseInt(minor), parseInt(patch), preRelease, build);
  }

  constructor(major: number, minor: number, patch: number, preRelease?: string, build?: string) {
    this.major = major;
    this.minor = minor;
    this.patch = patch;
    this.preRelease = preRelease;
    this.build = build;
  }

  toString(): string {
    let ret = `${this.major}.${this.minor}.${this.patch}`;
    if (this.preRelease !== undefined) {
      ret += `-${this.preRelease}`;
      if (this.build !== undefined) {
        ret += `+${this.build}`;
      }
    }
    return ret;
  }

  /**
   * Returns `1` if this is greater than `other`, `-1` if this is less than `other`, and `0` otherwise.
   *
   * Doesn't handle prerelease identifiers.
   */
  compareTo(other: Semver) {
    if (this.major !== other.major) {
      return this.major > other.major ? 1 : -1;
    }
    if (this.minor !== other.minor) {
      return this.minor > other.minor ? 1 : -1;
    }
    if (this.patch !== other.patch) {
      return this.patch > other.patch ? 1 : -1;
    }
    return 0;
  }

  isGreaterThan(other: Semver) {
    return this.compareTo(other) === 1;
  }

  isGreaterThanOrEqualTo(other: Semver) {
    return this.compareTo(other) >= 0;
  }

  isLessThan(other: Semver) {
    return this.compareTo(other) === -1;
  }

  isLessThanOrEqualTo(other: Semver) {
    return this.compareTo(other) <= 0;
  }

  isCompatibleWith(other: Semver) {
    if (this.major === 0) {
      return other.major === 0 && this.minor === other.minor && this.patch >= other.patch;
    }
    return this.major === other.major && this.minor >= other.minor;
  }
}

const SEMVER_REGEXP =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
