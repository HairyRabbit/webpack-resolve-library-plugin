// -*- mode: js-jsx -*-
// -*- coding: utf-8 -*-
// @flow

/**
 * WebpackResolveLibraryPlugin
 *
 * Manange 3rd library for development and production.
 *
 * At development:
 * 1. Build `pkg.dependencies` to dll-cache use webpack.
 * 2. Add `<script src="vendor.js">` tag to HTML file via webpack-html-plugin.
 * 3. Watch `package.json` and recompile dll on dependencies changed.
 *
 * At production:
 * 1. Map `pkg.dependencies` to CDN sources then add as `<script>`.
 * 2. Build all dependencies to vendor.js. 
 *
 *
 * Examples:
 *
 * const LibraryPlugin = require('rabbit-webpack-resolve-library-plugin')
 *
 * module.exports = {
 *   //... webpack options
 *   plugins: [
 *     //... webpack plugins
 *     new LibraryPlugin() 
 *   ]
 * }
 */

// import { defaultTo } from 'lodash'
import fs      from 'fs'
import path    from 'path'
import webpack from 'webpack'

// { DllPlugin, DllReferencePlugin }

const DefaultOptions = {
  base: path.resolve('.'),
  dllDirectoryName: '.dll-cache',
  dllName: 'vendor'
}

export default class WebpackResolveLibraryPlugin {
  constructor(options) {
    this.options = Object.assign({}, DefaultOptions, options)
  }
  apply(compiler) {
    const { options } = this

    compiler.plugin('compile', function(params) {       
      
      // Find pkg.dependencies.
      const pkg = require(path.resolve(options.base, 'package.json'))
      const deps = pkg.dependencies      

      // Make webpack options
      const dllDirectory = path.resolve(
        options.base,
        options.dllDirectoryName
      )

      this.options.devServer = {}
      this.options.devServer.contentBase = dllDirectory

      console.log(this.options)
      
      const webpackOptions = {
        entry: {
          [options.dllName]: Object.keys(deps) 
        },
        output: {
          path: dllDirectory,
          filename: '[name].js',
          library: '[name]'
        },
        context: options.base,
        module: {
          rules: [
            {
              test: /\.css$/,
              use: ['style-loader', 'css-loader']
            },
            {
              test: /\.(jpg|png|gif|ttf|eot|woff|woff2)$/,
              use: 'url-loader'
            }
          ]
        },
        plugins: [
          new webpack.DllPlugin({
            path: path.resolve(dllDirectory, '[name]-manifest.json'),
            name: '[name]'
          })
        ]
      }

      // Compile
      const compile = webpack(webpackOptions)

      // TODO Skip when compare pass
      compile.run((err, stats) => {
        
        // Valide
        
        if (err) {
          console.error(err.stack || err)
          if (err.details) {
            console.error(err.details)
          }
          return
        }

        const info = stats.toJson()

        if (stats.hasErrors()) console.error(info.errors.join('\n'))
        if (stats.hasWarnings()) console.warn(info.warnings.join('\n'))

        fs.linkSync(
          path.resolve(dllDirectory, options.dllName + '.js'),
          path.resolve(this.options.output.path, '.' + options.dllName + '.js')
        )

      })

      compiler.plugin('compilation', function(compilation) {
        compilation.plugin('html-webpack-plugin-before-html-generation', function(data, callback) {
          data.assets.js.unshift('.' + options.dllName + '.js')
          console.log(data)
          callback(null, data)
        })
      })
    })
  }
} 
