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
  const pkgJsonPath  = path.resolve(base, 'package.json')

  return Promise.resolve(webpackOptions)
    .then(make)
  // .catch(make)
  // Catch compile error
  // .catch()
    .then(inject)

  
  function make () {
    return Promise.resolve({})
      .then(opts => {
        return fs.readFile(pkgJsonPath)
          .then(pkg => {
            opts.deps = JSON.parse(pkg).dependencies
            return opts
          })
          .catch(err => {
            // Can't find 'package.json' file
            throw new Error(`Can't find package.json`)
          })
      })
      .then(opts => {
        return fs.readFile(dllCachePath)
          .then(cache => {
            opts.cache = JSON.parse(cache)
            return opts
          })
          .catch(err => {
            // Initial build, can't find dll cache file.
            return opts
          })
      })
      .then(opts => {
        const { cache, deps } = opts
        if(cache && isEqual(cache, deps)) return
        return build(deps)
      })
  }

  function build (deps) {
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

        // NOTE: Fix https://github.com/webpack/watchpack/issues/25
        const now = Date.now() / 1000 - 10

        Promise.all([
          fs.utimes(manifestPath, now, now),
          fs.writeFile(dllCachePath, JSON.stringify(deps))
        ]).then(resolve).catch(reject)
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

      // Add package.json to entry, let it's watchable.
      // Initial pkg timestamp.
      let pkgTimestamp = 0

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

        // Watch pkg.dependencies changed.
        compiler.plugin('watch-run', function(watching, callback) {
          const timestamp = watching.compiler.contextTimestamps[pkgJsonPath]
          if(!timestamp || timestamp === pkgTimestamp) {
            done()
            return
          }

          // TODO error handle.
          make().then(done).catch(callback)

          function done () {
            pkgTimestamp = timestamp
            callback(null)
          }
        })
      }})
      
      resolve(webpackOptions)
    })
  }
}
