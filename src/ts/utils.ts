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

import { promisify } from "node:util";
import { exec as _exec, spawn as _spawn } from "node:child_process";

export const exec = promisify(_exec);

export const debounce = <A extends any[]>(
  f: (...args: A) => any,
  wait: number
): ((...args: A) => void) => {
  let timeout: NodeJS.Timeout | undefined = undefined;
  return (...args: A) => {
    if (timeout != null) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => f(...args), wait);
  };
};
