/**
 * Downloads and extracts Quarto CLI for the CURRENT platform only
 * Based on the original extensions/quarto/build/download-quarto.js approach
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const QUARTO_VERSION = '1.7.32';

function getQuartoDownloadUrl() {
    const platform = process.platform;
    const arch = process.arch;
    
    let filename;
    if (platform === 'win32') {
        filename = `quarto-${QUARTO_VERSION}-win.zip`;
    } else if (platform === 'darwin') {
        filename = `quarto-${QUARTO_VERSION}-macos.tar.gz`;
    } else if (platform === 'linux') {
        const archSuffix = arch === 'arm64' ? 'arm64' : 'amd64';
        filename = `quarto-${QUARTO_VERSION}-linux-${archSuffix}.tar.gz`;
    } else {
        throw new Error(`Unsupported platform: ${platform}`);
    }
    
    return `https://github.com/quarto-dev/quarto-cli/releases/download/v${QUARTO_VERSION}/${filename}`;
}

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        console.log(`Downloading Quarto CLI from: ${url}`);

        const request = https.get(url, (response) => {
            if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                const redirectUrl = response.headers.location;
                response.destroy();
                return downloadFile(redirectUrl, dest).then(resolve).catch(reject);
            }

            if (response.statusCode !== 200) {
                response.resume();
                reject(new Error(`Download failed with status: ${response.statusCode}`));
                return;
            }

            const fileStream = fs.createWriteStream(dest);
            let settled = false;

            const resolveOnce = () => {
                if (settled) return;
                settled = true;
                resolve();
            };

            const cleanup = (error) => {
                if (settled) return;
                settled = true;
                fileStream.destroy();
                fs.unlink(dest, () => reject(error));
            };

            response.pipe(fileStream);

            fileStream.on('finish', () => {
                fileStream.close((err) => {
                    if (err) {
                        cleanup(err);
                        return;
                    }
                    console.log(`Downloaded: ${dest}`);
                    resolveOnce();
                });
            });

            fileStream.on('error', cleanup);
            response.on('error', cleanup);
        });

        request.on('error', reject);
    });
}

function extractArchive(archivePath, extractDir) {
    console.log(`Extracting: ${archivePath} to ${extractDir}`);
    
    const platform = process.platform;
    
    if (platform === 'win32') {
        execSync(`powershell -command "Expand-Archive -Path '${archivePath}' -DestinationPath '${extractDir}' -Force"`, { stdio: 'inherit' });
    } else {
        execSync(`tar -xzf "${archivePath}" -C "${extractDir}"`, { stdio: 'inherit' });
    }
    
    console.log('Extraction complete');
}

function setExecutablePermissions(binDir) {
    if (process.platform === 'win32') {
        return;
    }
    
    console.log('Setting executable permissions...');
    
    const executables = ['quarto', 'pandoc', 'dart', 'deno', 'esbuild', 'sass', 'typst'];
    
    function makeExecutableRecursive(dir) {
        if (!fs.existsSync(dir)) return;
        
        const items = fs.readdirSync(dir);
        for (const item of items) {
            const itemPath = path.join(dir, item);
            const stat = fs.statSync(itemPath);
            
            if (stat.isDirectory()) {
                makeExecutableRecursive(itemPath);
            } else if (executables.some(exe => item === exe || item.startsWith(exe))) {
                try {
                    execSync(`chmod +x "${itemPath}"`, { stdio: 'inherit' });
                    console.log(`Made executable: ${itemPath}`);
                } catch (error) {
                    console.warn(`Failed to make executable: ${itemPath}`, error.message);
                }
            }
        }
    }
    
    makeExecutableRecursive(binDir);
}

async function main() {
    try {
        const rootDir = path.resolve(__dirname, '..');
        const downloadDir = path.join(rootDir, 'temp');
        const outputDir = path.join(rootDir, 'quarto');
        
        console.log(`Downloading Quarto CLI ${QUARTO_VERSION} for ${process.platform}-${process.arch}`);
        
        if (!fs.existsSync(downloadDir)) {
            fs.mkdirSync(downloadDir, { recursive: true });
        }
        
        if (fs.existsSync(outputDir)) {
            console.log('Removing existing quarto directory...');
            fs.rmSync(outputDir, { recursive: true, force: true });
        }
        fs.mkdirSync(outputDir, { recursive: true });
        
        const downloadUrl = getQuartoDownloadUrl();
        const filename = path.basename(downloadUrl);
        const archivePath = path.join(downloadDir, filename);
        
        await downloadFile(downloadUrl, archivePath);
        
        extractArchive(archivePath, outputDir);
        
        // Flatten the extracted directory structure
        const extractedDirs = fs.readdirSync(outputDir).filter(item =>
            fs.statSync(path.join(outputDir, item)).isDirectory() && item.startsWith('quarto-')
        );

        if (extractedDirs.length === 1) {
            const extractedDir = path.join(outputDir, extractedDirs[0]);
            const tempDir = path.join(outputDir, 'temp-move');

            fs.renameSync(extractedDir, tempDir);
            const contents = fs.readdirSync(tempDir);
            for (const item of contents) {
                const srcPath = path.join(tempDir, item);
                const destPath = path.join(outputDir, item);
                if (fs.existsSync(destPath)) {
                    fs.rmSync(destPath, { recursive: true, force: true });
                }
                fs.renameSync(srcPath, destPath);
            }
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
        
        setExecutablePermissions(outputDir);
        
        fs.rmSync(downloadDir, { recursive: true, force: true });
        
        console.log(`Quarto CLI ${QUARTO_VERSION} successfully downloaded to: ${outputDir}`);
        
        const quartoPath = path.join(outputDir, 'bin', process.platform === 'win32' ? 'quarto.exe' : 'quarto');
        if (fs.existsSync(quartoPath)) {
            console.log(`Quarto CLI executable found at: ${quartoPath}`);
        } else {
            console.warn(`Warning: Quarto CLI executable not found at expected path: ${quartoPath}`);
        }
        
    } catch (error) {
        console.error('Failed to download Quarto CLI:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { main };


