
import path from "node:path";
import { downloadArtifact } from "../src/ts/clients/maven";
import { BUNDLED_LSP_VERSION } from "../src/ts/consts";

/**
 * Downloads the pkl lsp, and places it into `out`.
 */
(async () => {
  await downloadArtifact(
    {
      group: "org.pkl-lang",
      artifact: "pkl-lsp",
      version: BUNDLED_LSP_VERSION
    },
    path.join(__dirname, "../out/pkl-lsp.jar")
  );
})();
