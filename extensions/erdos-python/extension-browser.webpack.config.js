/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Lotas Inc. 2025. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

const { browser, browserPlugins } = require('../shared.webpack.config');
const NodePolyfillPlugin = require('node-polyfill-webpack-plugin');

const config = browser(
    {
        context: __dirname,
        entry: {
            extension: './src/client/browser/extension.ts',
        },
        output: {
            filename: '[name].browser.js',
        },
        resolve: {
            fallback: { 
                path: require.resolve('path-browserify') 
            },
        },
    },
    {
        configFile: 'tsconfig.browser.json',
    }
);

// Add NodePolyfillPlugin to the existing plugins
config.plugins.push(new NodePolyfillPlugin());

module.exports = config;

