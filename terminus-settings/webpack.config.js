const path = require('path')
const webpack = require('webpack')

module.exports = {
  target: 'node',
  entry: 'src/index.ts',
  devtool: 'source-map',
  context: __dirname,
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'index.js',
    pathinfo: true,
    libraryTarget: 'umd',
    devtoolModuleFilenameTemplate: 'webpack-terminus-settings:///[resource-path]',
  },
  resolve: {
    modules: ['.', 'src', 'node_modules', '../app/node_modules'].map(x => path.join(__dirname, x)),
    extensions: ['.ts', '.js'],
  },
  module: {
    loaders: [
      {
        test: /\.ts$/,
        loader: 'awesome-typescript-loader',
        options: {
          configFileName: path.resolve(__dirname, 'tsconfig.json'),
          typeRoots: [path.resolve(__dirname, 'node_modules/@types')],
          paths: {
            "terminus-*": [path.resolve(__dirname, '../terminus-*')],
            "*": [path.resolve(__dirname, '../app/node_modules/*')],
          }
        }
      },
      { test: /\.pug$/, use: ['apply-loader', 'pug-loader'] },
      { test: /\.scss$/, use: ['to-string-loader', 'css-loader', 'sass-loader'] },
      { test: /\.css$/, use: ['to-string-loader', 'css-loader', 'sass-loader'] },
    ]
  },
  externals: [
    'fs',
    'fs-promise',
    'path',
    'node-pty',
    'fs-promise',
    /^rxjs/,
    /^@angular/,
    /^@ng-bootstrap/,
    /^terminus-/,
  ],
  plugins: [
    new webpack.optimize.ModuleConcatenationPlugin(),
  ],
}
