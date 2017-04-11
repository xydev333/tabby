module.exports = {
  target: 'node',
  entry: 'src/index.ts',
  devtool: 'source-map',
  output: {
    filename: './dist/index.js',
    pathinfo: true,
    libraryTarget: 'umd',
    devtoolModuleFilenameTemplate: 'webpack-terminus-terminal:///[resource-path]',
  },
  resolve: {
    modules: ['.', 'node_modules', '../app/node_modules'],
    extensions: ['.ts', '.js'],
  },
  module: {
    loaders: [
      { test: /\.ts$/, use: 'awesome-typescript-loader' },
      { test: /schemes\/.*$/, use: "raw-loader" },
      { test: /\.pug$/, use: ['apply-loader', 'pug-loader'] },
      { test: /\.scss$/, use: ['to-string-loader', 'css-loader', 'sass-loader'] },
      { test: /\.css$/, use: ['to-string-loader', 'css-loader', 'sass-loader'] },
    ]
  },
  externals: [
    'fs',
    'fs-promise',
    'font-manager',
    'path',
    'node-pty',
    'child-process-promise',
    /^rxjs/,
    /^@angular/,
    /^@ng-bootstrap/,
    /^terminus-/,
  ]
}
