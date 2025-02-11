const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Add timestamp to logs
function log(...args) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}]`, ...args);
}

// Function to check if a package is installed
function checkPackageInstalled(packageName) {
    try {
        require.resolve(packageName);
        return true;
    } catch (e) {
        return false;
    }
}

// Function to clear the cache
function clearCache() {
    const cacheDir = path.join(process.cwd(), '.confluence-confluence');
    if (fs.existsSync(cacheDir)) {
        fs.rmSync(cacheDir, { recursive: true, force: true });
        log('Cleared confluence cache directory');
    }
}

// Check if package is installed
const isInstalled = checkPackageInstalled('@markdown-confluence/cli');
if (!isInstalled) {
    log('Package @markdown-confluence/cli is not installed');
}

// Clear cache before running
clearCache();

// Copy environment variables
const env = { ...process.env };

// Try to find the package executable
let packagePath;
try {
    packagePath = require.resolve('@markdown-confluence/cli/bin/cli.js');
} catch (e) {
    log('Error finding package:', e.message);
}

// Try different ways to spawn the CLI
const methods = [
    () => spawn('npx', ['@markdown-confluence/cli'], { env, stdio: 'pipe' }),
    () => spawn('node', [packagePath], { env, stdio: 'pipe' }),
    () => spawn('node', ['./node_modules/@markdown-confluence/cli/bin/cli.js'], { env, stdio: 'pipe' })
];

let succeeded = false;

for (let i = 0; i < methods.length; i++) {
    try {
        const cli = methods[i]();

        cli.stdout.on('data', (data) => {
            console.log(data.toString().trim());
        });

        cli.stderr.on('data', (data) => {
            console.error(data.toString().trim());
        });

        cli.on('error', (error) => {
            log(`CLI execution error:`, error.message);
            if (i === methods.length - 1) {
                log('All execution methods failed');
                process.exit(1);
            }
        });

        cli.on('exit', (code, signal) => {
            if (code !== 0) {
                log(`CLI exited with code: ${code}`);
            }
            if (signal) {
                log('Process was killed with signal:', signal);
            }
            if (code === 0) {
                succeeded = true;
            }
            if (i === methods.length - 1 || succeeded) {
                process.exit(code);
            }
        });

        // If we get here without error, break the loop
        succeeded = true;
        break;
    } catch (error) {
        log(`Execution method ${i + 1} failed:`, error.message);
    }
} 