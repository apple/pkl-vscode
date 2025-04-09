//@ts-check

const webpack = require("webpack");
const path = require("path");

/**@type {import('webpack').Configuration}*/
const config = {
  // can't target webworker right now because we rely on the child_process API.
  target: "node",
  entry: "./src/ts/extension.ts",
  output: {
    path: path.resolve(__dirname, "out"),
    filename: "extension.js",
    libraryTarget: "commonjs2",
    devtoolModuleFilenameTemplate: "../[resource-path]"
  },
  devtool: "source-map",
  externals: {
    // the vscode-module is created on-the-fly and must be excluded from the bundle.
    vscode: "commonjs vscode",
  },
  resolve: {
    conditionNames: ['import', 'require'],
    mainFields: ['module', 'main'],
    extensions: [".ts", ".js"]
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          { loader: "ts-loader" }
        ]
      }
    ]
  }
}

module.exports = config;
