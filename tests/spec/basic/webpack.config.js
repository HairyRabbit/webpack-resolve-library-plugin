const path = require('path')
const webpack = require('webpack')
const HTMLWebpackPlugin = require('html-webpack-plugin')
const LibraryPlugin = require(path.resolve('.', 'dist/webpack-resolve-library-plugin.js'))

console.log(__dirname)

module.exports = {
  entry: path.resolve(__dirname, './foo.js'),
  output: {
    filename: '[name].js',
    path: path.resolve(__dirname)
  },
  module: {
    rules: [
      { test: /\.css$/, use: [
	'style-loader',
	'css-loader'
      ] },
      { test: /\.(jpg|png|gif|ttf|eot|woff|woff2)$/, use: 'url-loader' }
    ]
  },
  plugins: [    
    new LibraryPlugin({
      base: __dirname
    }),
    new HTMLWebpackPlugin()
  ],
  devServer: {
    // contentBase: [path.resolve(__dirname, '.dll-cache')],
    before: (app, ctx) => {
      console.log(ctx)
    }
  }
}
