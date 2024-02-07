# Development

## Building locally

### Emscripten

At the moment, we require emscripten version 2.0.24 to build the project, because tree-sitter-pkl
is incompatible with `.wasm` modules built using newer versions.

The easiest way to set up emscripten is through [emsdk](https://github.com/emscripten-core/emsdk).
Clone the project down, and within the repo, run `./emsdk install 2.0.24 && ./emsdk activate 2.0.24`.

### Building the extension

To install all NPM dependencies, run `npm install`.

To build the extension, run `npm run package`. This will build a `.vsix` bundle and place it into `.dist/vscode/pkl-vscode`.

To install the extension locally, run `npm run installextension`.

## Developing locally

To develop locally, there is a "Launch Extension" task. In VSCode, navigate to the "Run and Debug" pane, and select "Launch Extension" to launch an extension host instance of VSCode.

Prior to launching, ensure the project environment is set up by running `npm run build:local`.

The local development environment requires that the [esbuild Problem Matchers](https://marketplace.visualstudio.com/items?itemName=connor4312.esbuild-problem-matchers) plugin is installed into VSCode.

## Changing the grammar

The Pkl grammar is generated from `src/pkl/pkl.tmLanguage.pkl` and stored in `grammars/pkl.tmLanguage.json`.
To generate it run `npm run build` or `npm run build:local`.

The generated grammar should be commited along with the Pkl source.