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

import { httpsDownload, httpsGetText } from "../utils";
import path from "node:path";
import Semver from "../Semver";

export type MavenSolrResponse = {
  response: {
    numFound: number;
    start: number;
    docs: MavenSolrResponseDocs[];
  };
};

export type MavenSolrResponseDocs = {
  id: string;
  g: string;
  a: string;
  latestVersion: string;
  repositoryId: string;
};

export const getLatestVersion = async (query: {
  group: string;
  artifact: string;
}): Promise<Semver> => {
  const groupSearch = query.group.replace(".", "/");
  const artifactSearch = query.artifact.replace(".", "/");
  const xml = await httpsGetText(
    `https://repo1.maven.org/maven2/${groupSearch}/${artifactSearch}/maven-metadata.xml`
  );
  const versionString = extractVersion(xml);
  const version = versionString ? Semver.parse(versionString) : null;
  if (version == null) {
    throw new Error(`Got an artifact from Maven that is not valid semver: ${versionString}`);
  }
  return version;
};

export const downloadArtifact = async (
  coordinates: { group: string; artifact: string; version: string },
  destination: string
) => {
  const jarPath = path.join(
    coordinates.group.replace(/\./g, "/"),
    coordinates.artifact,
    coordinates.version,
    `${coordinates.artifact}-${coordinates.version}.jar`
  );
  const checksumPath = `${jarPath}.sha256`;
  const checksum = await httpsGetText(`https://repo1.maven.org/maven2/${checksumPath}`);
  await httpsDownload(`https://repo1.maven.org/maven2/${jarPath}`, destination, checksum);
};

function extractVersion(xml: string): string | null {
  const match = xml.match(/<latest>([0-9.]+)<\/latest>/);
  return match ? match[1] : null;
}
