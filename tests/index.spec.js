import fs from 'fs'
import webpack from 'webpack'
import LibraryPlugin from '../libs'


const compile = webpack({
  entry: '',
  output: '[name].js'
})
