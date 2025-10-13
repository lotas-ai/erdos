/**
 * Downloads and extracts Quarto CLI binaries for bundling with VS Code extension
 * Based on Positron's approach in positron/build/lib/quarto.ts
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
            // Handle redirects (3xx)
            if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                const redirectUrl = response.headers.location;
                response.destroy();
                return downloadFile(redirectUrl, dest).then(resolve).catch(reject);
            }

            if (response.statusCode !== 200) {
                response.resume(); // consume response to free the socket
                reject(new Error(`Download failed with status: ${response.statusCode}`));
                return;
            }

            const fileStream = fs.createWriteStream(dest);
            let settled = false;

            const resolveOnce = () => {
                if (settled) {
                    return;
                }
                settled = true;
                resolve();
            };

            const cleanup = (error) => {
                if (settled) {
                    return;
                }
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
        // Use PowerShell to extract ZIP on Windows
        execSync(`powershell -command "Expand-Archive -Path '${archivePath}' -DestinationPath '${extractDir}' -Force"`, { stdio: 'inherit' });
    } else {
        // Use tar for macOS and Linux
        execSync(`tar -xzf "${archivePath}" -C "${extractDir}"`, { stdio: 'inherit' });
    }
    
    console.log('Extraction complete');
}

function setExecutablePermissions(binDir) {
    if (process.platform === 'win32') {
        return; // Windows doesn't need executable permissions
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
        const extensionDir = path.dirname(__dirname);
        const downloadDir = path.join(extensionDir, 'temp');
        const binDir = path.join(extensionDir, 'bin');
        
        // Create directories
        if (!fs.existsSync(downloadDir)) {
            fs.mkdirSync(downloadDir, { recursive: true });
        }
        
        if (fs.existsSync(binDir)) {
            fs.rmSync(binDir, { recursive: true, force: true });
        }
        fs.mkdirSync(binDir, { recursive: true });
        
        // Download Quarto CLI
        const downloadUrl = getQuartoDownloadUrl();
        const filename = path.basename(downloadUrl);
        const archivePath = path.join(downloadDir, filename);
        
        await downloadFile(downloadUrl, archivePath);
        
        // Extract archive
        extractArchive(archivePath, binDir);
        
        // The archive extracts into a versioned folder; flatten it so bin/ sits at the expected root.
        const extractedDirs = fs.readdirSync(binDir).filter(item =>
            fs.statSync(path.join(binDir, item)).isDirectory() && item.startsWith('quarto-')
        );

        if (extractedDirs.length === 1) {
            const extractedDir = path.join(binDir, extractedDirs[0]);
            const tempDir = path.join(binDir, 'temp-move');

            fs.renameSync(extractedDir, tempDir);
            const contents = fs.readdirSync(tempDir);
            for (const item of contents) {
                const srcPath = path.join(tempDir, item);
                const destPath = path.join(binDir, item);
                if (fs.existsSync(destPath)) {
                    fs.rmSync(destPath, { recursive: true, force: true });
                }
                fs.renameSync(srcPath, destPath);
            }
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
        
        // Set executable permissions
        setExecutablePermissions(binDir);
        
        // Clean up download
        fs.rmSync(downloadDir, { recursive: true, force: true });
        
        console.log(`Quarto CLI ${QUARTO_VERSION} successfully downloaded and extracted to: ${binDir}`);
        
        // Verify installation
        const quartoPath = path.join(binDir, 'bin', process.platform === 'win32' ? 'quarto.exe' : 'quarto');
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
