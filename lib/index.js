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
 * module.exports = LibraryPlugin({
 *   //... webpack options
 *   library: {
 *     //... options
 *   }
 * })
 *
 *
 * Code:
 */

import { isEqual, isPlainObject, omit } from 'lodash'
import fs                               from 'fs-extra'
import glob                             from 'glob'
import path                             from 'path'
import vm                               from 'vm'
import { JSDOM }                        from 'jsdom'
import request                          from 'request'
import webpack                          from 'webpack'


type Options = {
  base:             string,
  dllDirectoryName: string,
  dllName:          string,
  include:          Array<string>,
  exclude:          Array<string>,
  log:              boolean | 'info' | 'verbose' | 'none',
}

type WebpackOptions = {
  library?: Options,
  devServer: Object,
  [key: string]: *
}

type ContentBase = string | Array<string>

export default function (webpackOptions: WebpackOptions): Promise<WebpackOptions> {
  // Default options
  const DefaultOptions: Options = {
    base:             path.resolve('.'),
    dllDirectoryName: '.dll-cache',
    dllName:          'vendor',
    include:          [],
    exclude:          [],
    log:              true
  }
  
  const library = webpackOptions.library 
  const options = Object.assign({}, DefaultOptions, library)
  const dirname = options.dllDirectoryName
  const name    = options.dllName
  const include = options.include
  const exclude = options.exclude
  const log     = options.log

  // Ensure the options.base be a absolute path.
  let base = options.base
  if(path.isAbsolute(base)) base = path.resolve(base)

  // Test environment.
  // TODO production mode.
  const env          = process.env.NODE_ENV
  const development  = !env || env === 'development'

  // Paths
  const dllDirectory = path.resolve(base, dirname)
  const manifestName = 'vendor-manifest.json'
  const manifestPath = path.resolve(dllDirectory, manifestName)
  const dllCacheName = 'dll.json'
  const dllCachePath = path.resolve(dllDirectory, dllCacheName)
  const dllAssetName = name + '.js'
  const dllAssetPath = path.resolve(dllDirectory, dllAssetName)
  const pkgJsonPath  = path.resolve(base, 'package.json')


  // Main process.
  if(development) {
    // Will run at app start.
    return make().then(injectOptionsForDevelopment).catch(err => { throw err })
  } else {
    
  }
  

  /**
   * Make dll bundle.
   */
  function make (): Promise<*> {
    return Promise.resolve({})
      .then(opts => {
        return fs.readFile(pkgJsonPath)
          .then(pkg => {
            opts.deps = JSON.parse(pkg).dependencies
            return opts
          })
          .catch(err => {
            // Can't find 'package.json' file, maybe was never happen.
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
            if(log !== false || log !== 'none') {
              console.log('\nLibraryPlugin start to build dll bundle…\n')
            }
            return opts
          })
      })
      .then(opts => {
        const { cache, deps } = opts
        
        // Pass when not first run and valid successfully.
        if(cache && isEqual(cache, deps)) return

        // Need build dll-vendor. 
        return build(deps)
      })
  }

  /**
   * Build dll bundle use webpack.
   */
  function build (deps): Promise<*> {
    // Compile dll.
    const entry = {
      [name]: Object.keys(deps)
        .concat(include)
        .filter(x => !~exclude.indexOf(x)) 
    }
    const output = {
      path: dllDirectory,
      filename: '[name].js',
      library:  '[name]'
    }
    
    return new Promise(function (resolve, reject) {
      webpack({
        entry,
        output,
        context: base,
        // The loader setting extends from webpackOptions.module. 
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
        if (stats.hasWarnings()) {
          console.warn(info.warnings.join('\n'))
        }
        if (stats.hasErrors()) {
          console.error(info.errors.join('\n'))
          reject(info.errors)
        }

        // Log webpack stats.
        if(log === 'verbose') {
          console.log(stats.toString(true))
        }        
        
        // NOTE: Fix https://github.com/webpack/watchpack/issues/25
        const now = Date.now() / 1000 - 10

        Promise.all([
          fs.utimes(manifestPath, now, now),
          fs.writeFile(dllCachePath, JSON.stringify(deps))
        ]).then(() => {
          if(log !== false || log !== 'none') {
            console.log('\nLibraryPlugin build dll successfully\n')
          }
          resolve()
        }).catch(reject)
      })
    })    
  }  

  /**
   * Modify webpack options for development.
   */
  function injectOptionsForDevelopment () {
    return new Promise(function (resolve, reject) {
      // Remove custom options props.
      delete webpackOptions.library

      // Add dll directory to options.devServer.contentBase.
      // Let webpack-dev-server resolve the dll bundle.      
      webpackOptions.devServer = webpackOptions.devServer || {}  
      const contentBase: ?ContentBase = webpackOptions.devServer.contentBase
      if(typeof contentBase === 'string') {
        webpackOptions.devServer.contentBase = [ contentBase, dllDirectory ]
      } else if(Array.isArray(contentBase)) {
        webpackOptions.devServer.contentBase.push(dllDirectory)
      } else {
        webpackOptions.devServer.contentBase = [ dllDirectory ]
      }

      // Add package.json into entry to watchable.
      const entry = webpackOptions.entry
      if(typeof entry === 'string') {
        webpackOptions.entry = [ pkgJsonPath, entry ]
      } else if(Array.isArray(entry)) {
        webpackOptions.entry.unshift(pkgJsonPath)
      } else if(isPlainObject(entry)) {
        // TODO object type entry.
        const keys = Object.keys(entry)
        if(keys.length > 0) {
          webpackOptions.entry[keys[0]] = [ pkgJsonPath, entry[keys[0]] ]
        }
      } else if (typeof entry === 'function') {
        // TODO function type entry.
        webpackOptions.entry = entry(pkgJsonPath)
      }
      
      // Initial pkg timestamp, used to check package.json update.  
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
          // TODO If manifest was removed and compiling, need rewrite build.
          const timestamp = watching.compiler.contextTimestamps[pkgJsonPath]

          // Initial build or not changed.
          if(!timestamp || timestamp === pkgTimestamp) {
            done()
            return
          }

          // Rebuild dll bundle.
          if(log !== false || log !== 'none') {
            console.log('\nLibraryPlugin found package.json changed\n')
          }
          make().then(done).catch(callback)

          function done () {
            // Update timestamp.
            pkgTimestamp = timestamp
            callback(null)
          }
        })
      }})
      
      resolve(webpackOptions)
    })
  }

  /**
   * Modify webpack options for production.
   */
  function injectOptionsForProduction () {
    return new Promise(function (resolve, reject) {
      // Read pkg.dependencies
      fs.readFile(pkgJsonPath).then(pkg => {
        const deps = JSON.parse(pkg).dependencies
        return deps
      }).then(deps => {        
        const libs = Object.keys(deps).concat(include).filter(x => !~exclude.indexOf(x))
        return Promise.all(libs.map(libname => Promise.all(
          // Make libTuple.
          [ libname, getExportName(libname), getCDNUrl(libname) ]
        )))
      }).then(libTuples => {
        let externalLibrarys = {}, libraryTags = [], unResolved = []

        // Filter the resolve failed library and report it.
        // If failed, exclude it and build it from webpack, bundle into vendor.js.
        libTuples.filter((name, exportor, url) => {
          if(exportor === null) {
            unResolved.push(name)
            return false
          }

          if(url === null) {
            unResolved.push(name)
            return false
          }

          return true
        }).forEach((name, exportor, url) => {
          externalLibrarys[name] = exportor
          libraryTags.push(url)
        })
        

        // Rewite webpackOptions.externals.
        const externals = webpackOptions.externals || {}
        webpackOptions.externals = Object.assign({}, externals, externalLibrarys)

        // Build unresolved to vendor.js.
        const entry = webpackOptions.entry
        if(typeof entry === 'string' || Array.isArray(entry)) {
          webpackOptions.entry = { main: entry, vendor: unResolved }
        } else if(isPlainObject(entry)) {
          const vendor = webpackOptions.entry.vendor
          if(typeof vendor === 'string' || Array.isArray(vendor)) {
            webpackOptions.entry.vendor = unResolved.concat[vendor]
          } else {
            webpackOptions.entry.vendor = unResolved
          }
        } else if (typeof entry === 'function') {
          // TODO function type entry.
          webpackOptions.entry = entry(unResolved)
        }

        // Apply plugins.
        webpackOptions.plugins.push({ apply(compiler) {                    
          // Make HTMLWebpackPlugin script tags.
          compiler.plugin('compilation', function (compilation) {
            const htmlPluginHook = 'html-webpack-plugin-before-html-generation'
            compilation.plugin(htmlPluginHook, function (data, callback) {
              // TODO css library need add <link rel="stylesheet" />
              libraryTags.forEach(lib => {
                data.assets.js.push(lib)
              })
              callback(null, data)
            })
          })
        }})

        
        return webpackOptions
      }).then(resolve)
    })
  }

  /**
   * Get library global export name.
   */
  function getExportName (libname) {
    return fs.readFile(require.resolve(libname)).then(scripts => {
      return new vm.Script(scripts)
    }).then(scripts => {
      const dom = new JSDOM('', { runScripts: 'outside-only' })
      const cache = Object.keys(dom.window)
      dom.runVMScript(scripts)
      const name = Object.keys(omit(dom.window, cache))
      if(name.length === 1) return name
      else if(name.length > 1) return name[0]
      else {
        // Suggest name
        // TODO Maybe library used just a plugin, like bootstrap.
        // It's haven't a export name
        return name
      }
    })
    
    function suggest (str: string): string {
      
    }
  }

  /**
   * Get library unpkg.com uri.
   */
  function getCDNUrl (libname) {
    // TODO Let path resolver configurable.
    // TODO May use other CDN like cdnjs.com.
    const dirResolver      = makePatten(['umd', 'dist', 'build'])
    const fileResolver     = makePatten([libname, 'index'])
    const fileFlagResolver = makePatten(['min', 'production'])
    const directoryPath    = `node_modules/${libname}`
    const umdPathName      = `${dirResolver}`
    const fileName         = `${fileResolver}.${fileFlagResolver}.js`
    const libraryUMDPath   = [directoryPath, umdPathName, fileName].join('/')
    
    return glob(libraryUMDPath).then(paths => {
      // TODO more then one path.
      if(paths.length > 0) return paths[0]
      else {
        // Can't find any file. Need build library from source.
      }
    }).then(libpath => {
      return new Promise(function (resolve, reject) {
        request(libpath.replace('node_modules', 'https://unpkg.com'), (err, res) => {
          if(err) {
            reject(err)
            return
          }

          const code = res.statusCode
          if(code !== 200) {
            // Can't find files from CDN server.
            // Need build from source and report.
            return
          }
          
          resolve(res.request.uri.href)
        })
      })
    })

    function makePatten (arr: Array<string>): string {
      return `+(arr.join('|')))`
    }    
  }
}
