/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Lotas Inc. 2025. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

const path = require('path');
const withDefaults = require('../shared.webpack.config');
const { nodePlugins } = require('../shared.webpack.config');

const config = withDefaults({
    context: __dirname,
    entry: {
        extension: './src/client/extension.ts',
        'shellExec.worker': './src/client/common/process/worker/shellExec.worker.ts',
        'plainExec.worker': './src/client/common/process/worker/plainExec.worker.ts',
        'registryKeys.worker': './src/client/pythonEnvironments/common/registryKeys.worker.ts',
        'registryValues.worker': './src/client/pythonEnvironments/common/registryValues.worker.ts',
    },
    output: {
        path: path.join(__dirname, 'dist'),
        filename: 'client/[name].js',
        chunkFilename: 'client/[name].js',
    },
    plugins: [...nodePlugins(__dirname)],
});

// Add our custom loaders after the defaults are applied
config.module.rules.push(
    {
        test: /\.node$/,
        use: ['node-loader'],
    },
    {
        test: /\.worker\.js$/,
        use: { loader: 'worker-loader' },
    }
);

module.exports = config;
