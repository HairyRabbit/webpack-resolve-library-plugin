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
import fs          from 'fs-extra'
import path        from 'path'
import webpack     from 'webpack'

const DefaultOptions = {
  base: path.resolve('.'),
  dllDirectoryName: '.dll-cache',
  dllName: 'vendor'
}

export default function (webpackOptions) {
  const library = webpackOptions.library 
  const options = Object.assign({}, DefaultOptions, library)
  const dirname = options.dllDirectoryName
  const name    = options.dllName

  // The this.options.base must be a absolute path.
  let base = options.base
  if(path.isAbsolute(base)) base = path.resolve(base)

  const dllDirectory = path.resolve(base, dirname)
  const manifestName = 'vendor-manifest.json'
  const manifestPath = path.resolve(dllDirectory, manifestName)
  const dllCacheName = 'dll.json'
  const dllCachePath = path.resolve(dllDirectory, dllCacheName)
  const dllAssetName = name + '.js'
  const dllAssetPath = path.resolve(dllDirectory, dllAssetName)

  const pkg  = require(path.resolve(base, 'package.json'))
  const deps = pkg.dependencies

  return Promise.resolve(webpackOptions)
    .then(validate)
    .catch(make)
  // Catch compile error
  // .catch()
    .then(inject)
  
  function validate () {
    return fs.readFile(dllCachePath).then(function (dllCache) {
      return new Promise(function (resolve, reject) {
        if(!isEqual(JSON.parse(dllCache), deps)) return reject()
        return resolve()
      })
    })
  }

  function make () {
    // Compile dll.
    const entry = {
      [name]: Object.keys(deps) 
    }
    const output = {
      path: dllDirectory,
      filename: '[name].js',
      library:  '[name]'
    }
    
    return new Promise(function (resolve, reject) {
      // TODO: Merge with webpackOptions.
      webpack({
        entry,
        output,
        context: base,
        module: library && library.module || webpackOptions.module,
        plugins: [
          new webpack.DllPlugin({
            path: manifestPath,
            name: '[name]'
          })
        ]
      }, (err, stats) => {
        if (err) {
          console.error(err.stack || err)
          if (err.details) console.error(err.details)
          reject(err)
          return
        }

        const info = stats.toJson()
        if (stats.hasErrors())   console.error(info.errors.join('\n'))
        if (stats.hasWarnings()) console.warn(info.warnings.join('\n'))

        return Promise.all([
          function () {
            // NOTE: Fix https://github.com/webpack/watchpack/issues/25
            const now = Date.now() / 1000 - 10
            fs.utimesSync(manifestPath, now, now)
          },
          function () {
            // Compile done, write to cache.
            fs.writeFile(dllCachePath, JSON.stringify(deps))
          }
        ]).then(resolve)
      })
    })    
  }

  function inject () {
    return new Promise(function (resolve, reject) {
      // Remove custom options props.
      delete webpackOptions.library

      // Add dll directory to options.devServer.contentBase.
      webpackOptions.devServer = webpackOptions.devServer || {}
      const contentBase = webpackOptions.devServer.contentBase
      if(typeof contentBase === 'string') {
        webpackOptions.devServer.contentBase = [ contentBase, dllDirectory ]
      } else if(Array.isArray(contentBase)) {
        webpackOptions.devServer.contentBase.push(dllDirectory)
      } else {
        webpackOptions.devServer.contentBase = [ dllDirectory ]
      }

      // Add LibraryPlugin to options.plugins.
      webpackOptions.plugins.push({ apply(compiler) {
        // Push DllReferencePlugin to plugins.
        // NOTE: The dll bundles already created.
        // It will throw error when the manifest is not exists.
        compiler.plugin('after-plugins', function(compiler) {
          compiler.apply(new webpack.DllReferencePlugin({
            context:  base,
            manifest: manifestPath
          }))
        })

        // Add dll assets to HTMLWebpackPlugin.
        compiler.plugin('compilation', function(compilation) {
          const htmlPluginHook = 'html-webpack-plugin-before-html-generation'
          compilation.plugin(htmlPluginHook, function(data, callback) {
            data.assets.js.unshift(dllAssetName)
            callback(null, data)
          })
        })
      }})
      
      resolve(webpackOptions)
    })
  }
}
