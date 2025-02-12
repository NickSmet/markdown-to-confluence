const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const createLogger = require('./logger');

const logger = createLogger('CLI');

// Function to clear the cache
function clearCache() {
    const cacheDir = path.join(process.cwd(), '.confluence-confluence');
    if (fs.existsSync(cacheDir)) {
        fs.rmSync(cacheDir, { recursive: true, force: true });
        logger.info('Cleared confluence cache directory');
    }
}

// Clear cache before running
clearCache();

// Copy environment variables
const env = { ...process.env };

logger.debug('Executing @markdown-confluence/cli via npx...');

const cli = spawn('npx', ['@markdown-confluence/cli'], { env, stdio: 'pipe' });

cli.stdout.on('data', (data) => {
    process.stdout.write(data);
});

cli.stderr.on('data', (data) => {
    process.stderr.write(data);
});

cli.on('error', (error) => {
    logger.error('CLI execution error:', error.message);
    process.exit(1);
});

cli.on('exit', (code, signal) => {
    if (code !== 0) {
        logger.error(`CLI exited with code: ${code}`);
    }
    if (signal) {
        logger.warn('Process was killed with signal:', signal);
    }
    if (code === 0) {
        logger.success('CLI execution completed successfully');
    }
    process.exit(code);
}); 