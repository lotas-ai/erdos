/**
 * Downloads and extracts Quarto CLI binaries for bundling with Erdos
 * This creates the standalone CLI that the extension will call
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const QUARTO_VERSION = '1.7.32';

function getQuartoDownloadUrl(platform, arch) {
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

function extractArchive(archivePath, extractDir, platform) {
    console.log(`Extracting: ${archivePath} to ${extractDir}`);
    
    if (platform === 'win32') {
        // Use PowerShell to extract ZIP on Windows
        execSync(`powershell -command "Expand-Archive -Path '${archivePath}' -DestinationPath '${extractDir}' -Force"`, { stdio: 'inherit' });
    } else {
        // Use tar for macOS and Linux
        execSync(`tar -xzf "${archivePath}" -C "${extractDir}"`, { stdio: 'inherit' });
    }
    
    console.log('Extraction complete');
}

function setExecutablePermissions(binDir, platform) {
    if (platform === 'win32') {
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

async function downloadForPlatform(platform, arch, rootDir) {
    const downloadDir = path.join(rootDir, 'temp');
    const outputDir = path.join(rootDir, 'quarto', `${platform}-${arch}`);
    
    // Create directories
    if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir, { recursive: true });
    }
    
    if (fs.existsSync(outputDir)) {
        fs.rmSync(outputDir, { recursive: true, force: true });
    }
    fs.mkdirSync(outputDir, { recursive: true });
    
    // Download Quarto CLI
    const downloadUrl = getQuartoDownloadUrl(platform, arch);
    const filename = path.basename(downloadUrl);
    const archivePath = path.join(downloadDir, filename);
    
    await downloadFile(downloadUrl, archivePath);
    
    // Extract archive
    extractArchive(archivePath, outputDir, platform);
    
    // The archive extracts into a versioned folder; flatten it
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
    
    // Set executable permissions
    setExecutablePermissions(outputDir, platform);
    
    console.log(`Quarto CLI ${QUARTO_VERSION} (${platform}-${arch}) successfully downloaded to: ${outputDir}`);
}

async function main() {
    try {
        const rootDir = path.resolve(__dirname, '..');
        
        console.log('========================================');
        console.log('Downloading Quarto CLI for all platforms');
        console.log('========================================');
        
        // Download for all platforms
        const platforms = [
            { platform: 'darwin', arch: 'arm64' },
            { platform: 'darwin', arch: 'x64' },
            { platform: 'win32', arch: 'x64' },
            { platform: 'linux', arch: 'x64' },
            { platform: 'linux', arch: 'arm64' }
        ];
        
        for (const { platform, arch } of platforms) {
            console.log(`\nDownloading Quarto for ${platform}-${arch}...`);
            await downloadForPlatform(platform, arch, rootDir);
        }
        
        // Clean up download directory
        const downloadDir = path.join(rootDir, 'temp');
        if (fs.existsSync(downloadDir)) {
            fs.rmSync(downloadDir, { recursive: true, force: true });
        }
        
        console.log('\n========================================');
        console.log('All Quarto CLI downloads completed!');
        console.log('========================================');
        
    } catch (error) {
        console.error('Failed to download Quarto CLI:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { main };

