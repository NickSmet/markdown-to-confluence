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

// Ensure proper mapping of environment variables for @markdown-confluence/cli
if (env.CONFLUENCE_API_TOKEN) {
    env.MARKDOWN_CONFLUENCE_TOKEN = env.CONFLUENCE_API_TOKEN;
    // Try additional environment variables that the CLI might look for
    env.CONFLUENCE_TOKEN = env.CONFLUENCE_API_TOKEN;
    env.ATLASSIAN_API_TOKEN = env.CONFLUENCE_API_TOKEN;
}
if (env.CONNIE_API_TOKEN) {
    env.MARKDOWN_CONFLUENCE_TOKEN = env.CONNIE_API_TOKEN;
    env.CONFLUENCE_TOKEN = env.CONNIE_API_TOKEN;
    env.ATLASSIAN_API_TOKEN = env.CONNIE_API_TOKEN;
}

// Map username environment variables
if (env.ATLASSIAN_USER_NAME) {
    env.MARKDOWN_CONFLUENCE_USERNAME = env.ATLASSIAN_USER_NAME;
    env.CONFLUENCE_USERNAME = env.ATLASSIAN_USER_NAME;
}
if (env.CONNIE_USER) {
    env.MARKDOWN_CONFLUENCE_USERNAME = env.CONNIE_USER;
    env.CONFLUENCE_USERNAME = env.CONNIE_USER;
}

logger.debug('Executing @markdown-confluence/cli via npx...');
logger.debug('Environment variables being passed to CLI:');
logger.debug('CONFLUENCE_API_TOKEN present:', !!env.CONFLUENCE_API_TOKEN);
logger.debug('CONNIE_API_TOKEN present:', !!env.CONNIE_API_TOKEN);
logger.debug('MARKDOWN_CONFLUENCE_TOKEN present:', !!env.MARKDOWN_CONFLUENCE_TOKEN);
logger.debug('CONFLUENCE_TOKEN present:', !!env.CONFLUENCE_TOKEN);
logger.debug('ATLASSIAN_API_TOKEN present:', !!env.ATLASSIAN_API_TOKEN);
logger.debug('ATLASSIAN_USER_NAME present:', !!env.ATLASSIAN_USER_NAME);
logger.debug('MARKDOWN_CONFLUENCE_USERNAME present:', !!env.MARKDOWN_CONFLUENCE_USERNAME);
logger.debug('CONFLUENCE_USERNAME present:', !!env.CONFLUENCE_USERNAME);
logger.debug('All relevant env vars:', Object.keys(env).filter(key => 
    key.startsWith('CONFLUENCE_') || key.startsWith('CONNIE_') || 
    key.startsWith('MARKDOWN_CONFLUENCE_') || key.startsWith('ATLASSIAN_')
).join(', '));

// Get the config file path
const configPath = path.join(process.cwd(), '.markdown-confluence.json');
logger.debug('Config file path:', configPath);

const cli = spawn('npx', [
    '@markdown-confluence/cli',
    '--config', configPath
], { env, stdio: 'pipe' });

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