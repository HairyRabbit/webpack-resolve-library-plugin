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

import { isEqual } from 'lodash'
import fs      from 'fs-extra'
import path    from 'path'
import webpack from 'webpack'

// { DllPlugin, DllReferencePlugin }

const DefaultOptions = {
  base: path.resolve('.'),
  dllDirectoryName: '.dll-cache',
  dllName: 'vendor'
}

class DllRebuildError extends Error {
  constructor() {
    super()
  }
}

class WebpackResolveLibraryPlugin {
  constructor(options) {
    this.options = options
  }
  
  apply(compiler) {
    const {
      base,
      dllDirectoryName: dirname,
      dllName: name
    } = this.options

    // if(path.isAbsolute(base))
    //   base = path.resolve(base)
    
    const dllDirectory = path.resolve(base, dirname)
    const manifestName = 'vendor-manifest.json'
    const manifestPath = path.resolve(dllDirectory, manifestName)
    const dllCacheName = 'dll.json'
    const dllCachePath = path.resolve(dllDirectory, dllCacheName)
    const dllAssetName = name + '.js'

    const pkg  = require(path.resolve(base, 'package.json'))
    const deps = pkg.dependencies


    compiler.plugin('after-plugins', function(compiler) {
      compiler.apply(new webpack.DllReferencePlugin({
        context:  base,
        manifest: manifestPath
      }))
    })

    // Push to build-in file system memory-fs.
    compiler.plugin('compile', function() {
      const memoryFS    = this.outputFileSystem
      const outputPath  = this.options.output.path
      memoryFS.mkdirpSync(outputPath)
      memoryFS.writeFileSync(
        path.resolve(outputPath, dllAssetName),
        fs.readFileSync(path.resolve(dllDirectory, dllAssetName))
      )
    })

    // Add dll assets to HTMLWebpackPlugin.
    compiler.plugin('compilation', function(compilation) {
      const htmlPluginHook = 'html-webpack-plugin-before-html-generation'
      compilation.plugin(htmlPluginHook, function(data, callback) {
        data.assets.js.unshift(dllAssetName)
        callback(null, data)
      })
    })
  }
} 




export default function (webpackOptions) {
  
  const options = Object.assign(
    {},
    DefaultOptions,
    webpackOptions.library
  )

  const {
    base,
    dllDirectoryName: dirname,
    dllName: name
  } = options

  const dllDirectory = path.resolve(base, dirname)
  const manifestName = 'vendor-manifest.json'
  const manifestPath = path.resolve(dllDirectory, manifestName)
  const dllCacheName = 'dll.json'
  const dllCachePath = path.resolve(dllDirectory, dllCacheName)
  const dllAssetName = name + '.js'

  const pkg  = require(path.resolve(base, 'package.json'))
  const deps = pkg.dependencies

  return Promise.resolve()
    .then(validate)
    .catch(make)
    .then(inject)
  
  function validate () {
    return fs.readFile(dllCachePath)
      .then(function (dllCache) {
        return new Promise(function (resolve, reject) {
          if(!isEqual(JSON.parse(dllCache), deps)) return reject()
          return resolve()
        })
      })
  }

  function make () {
    const webpackOptions = {
      entry: {
        [name]: Object.keys(deps) 
      },
      output: {
        path: dllDirectory,
        filename: '[name].js',
        library:  '[name]'
      },
      context: base,
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
          path: manifestPath,
          name: '[name]'
        })
      ]
    }

    // Compile dll.
    return new Promise(function (resolve, reject) {
      webpack(webpackOptions, (err, stats) => {
        if (err) {
          console.error(err.stack || err)
          if (err.details) console.error(err.details)
          reject(err)
          return
        }

        const info = stats.toJson()
        if (stats.hasErrors())   console.error(info.errors.join('\n'))
        if (stats.hasWarnings()) console.warn(info.warnings.join('\n'))

        // Compile done, write to cache.
        return fs.writeFile(dllCachePath, JSON.stringify(deps))
          .then(resolve)
      })
    })
  }

  function inject () {
    return new Promise(function (resolve, reject) {
      delete webpackOptions.library
      webpackOptions.plugins.push(new WebpackResolveLibraryPlugin(options))
      resolve(webpackOptions)
    })
  }
}
