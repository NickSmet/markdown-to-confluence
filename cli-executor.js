import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import createLogger from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const logger = createLogger('CLI');

// Required config keys that should be present either in JSON or env vars
const REQUIRED_KEYS = [
    'confluenceBaseUrl',
    'confluenceSpaceKey',
    'confluenceParentId',
    'atlassianUserName',
    'atlassianApiToken'
];

// Mapping between JSON config keys and their corresponding environment variables
const ENV_MAPPING = {
    confluenceBaseUrl: ['CONFLUENCE_BASE_URL', 'CONNIE_BASE_URL'],
    atlassianUserName: ['ATLASSIAN_USER_NAME', 'CONNIE_USER', 'MARKDOWN_CONFLUENCE_USERNAME', 'CONFLUENCE_USERNAME'],
    confluenceSpaceKey: ['CONFLUENCE_SPACE_KEY', 'CONNIE_SPACE'],
    confluenceParentId: ['CONFLUENCE_PARENT_ID', 'CONNIE_PARENT'],
    atlassianApiToken: ['CONFLUENCE_API_TOKEN', 'CONNIE_API_TOKEN', 'MARKDOWN_CONFLUENCE_TOKEN', 'CONFLUENCE_TOKEN', 'ATLASSIAN_API_TOKEN']
};

// Function to clear the cache
function clearCache() {
    const cacheDir = path.join(process.cwd(), '.confluence-confluence');
    if (fs.existsSync(cacheDir)) {
        fs.rmSync(cacheDir, { recursive: true, force: true });
        logger.info('Cleared confluence cache directory');
    }
}

function checkConfiguration() {
    const configPath = path.resolve(process.cwd(), '.markdown-confluence.json');
    let jsonConfig = {};
    
    // Load JSON config
    if (fs.existsSync(configPath)) {
        try {
            jsonConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            logger.debug('Loaded JSON config:', configPath);
        } catch (error) {
            logger.error('Error reading config file:', error.message);
        }
    }

    // Check each required key
    const missingKeys = [];
    const configStatus = {};

    for (const key of REQUIRED_KEYS) {
        const envVars = ENV_MAPPING[key] || [];
        const envValue = envVars.find(envVar => process.env[envVar]);
        
        configStatus[key] = {
            inJson: !!jsonConfig[key],
            jsonValue: jsonConfig[key],
            inEnv: !!envValue,
            envVar: envValue ? envVars.find(v => process.env[v]) : null,
            envValue: envValue ? process.env[envValue] : null
        };

        if (!jsonConfig[key] && !envValue) {
            missingKeys.push(key);
        }
    }

    // Log configuration status
    logger.debug('\nConfiguration Status:');
    for (const [key, status] of Object.entries(configStatus)) {
        logger.debug(`\n${key}:`);
        logger.debug(`  JSON: ${status.inJson ? 'Present' : 'Missing'}${status.inJson ? ` (${status.jsonValue})` : ''}`);
        logger.debug(`  ENV:  ${status.inEnv ? 'Present' : 'Missing'}${status.inEnv ? ` (${status.envVar}=${status.envValue})` : ''}`);
    }

    if (missingKeys.length > 0) {
        logger.error('\nMissing required configuration:', missingKeys.join(', '));
        logger.error('Please provide these values either in .markdown-confluence.json or as environment variables');
        process.exit(1);
    }

    return configStatus;
}

// Clear cache before running
clearCache();

// Check configuration before proceeding
const configStatus = checkConfiguration();

// Copy environment variables and ensure proper mapping
const env = { ...process.env };

// Map all possible environment variables based on the config status
for (const [key, status] of Object.entries(configStatus)) {
    const envVars = ENV_MAPPING[key] || [];
    
    // If we have a value (either from JSON or ENV), map it to all possible env vars
    const value = status.envValue || status.jsonValue;
    if (value) {
        for (const envVar of envVars) {
            env[envVar] = value;
        }
    }
}

logger.debug('\nExecuting @markdown-confluence/cli via npx...');
logger.debug('Environment variables being passed to CLI:');
for (const [key, vars] of Object.entries(ENV_MAPPING)) {
    for (const envVar of vars) {
        logger.debug(`${envVar} present:`, !!env[envVar]);
    }
}

const cli = spawn('npx', [
    '@markdown-confluence/cli',
    '--config', path.resolve(process.cwd(), '.markdown-confluence.json')
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

function executeCliCommand(args) {
    logger.debug('Executing @markdown-confluence/cli via npx...');
    
    // Log environment variables for debugging
    logger.debug('Environment variables being passed to CLI:');
    logger.debug('CONFLUENCE_API_TOKEN present: ' + (process.env.CONFLUENCE_API_TOKEN !== undefined));
    logger.debug('CONNIE_API_TOKEN present: ' + (process.env.CONNIE_API_TOKEN !== undefined));
    logger.debug('MARKDOWN_CONFLUENCE_TOKEN present: ' + (process.env.MARKDOWN_CONFLUENCE_TOKEN !== undefined));
    logger.debug('CONFLUENCE_TOKEN present: ' + (process.env.CONFLUENCE_TOKEN !== undefined));
    logger.debug('ATLASSIAN_API_TOKEN present: ' + (process.env.ATLASSIAN_API_TOKEN !== undefined));
    logger.debug('ATLASSIAN_USER_NAME present: ' + (process.env.ATLASSIAN_USER_NAME !== undefined));
    logger.debug('MARKDOWN_CONFLUENCE_USERNAME present: ' + (process.env.MARKDOWN_CONFLUENCE_USERNAME !== undefined));
    logger.debug('CONFLUENCE_USERNAME present: ' + (process.env.CONFLUENCE_USERNAME !== undefined));

    // Log which env vars are set
    const envVars = [];
    if (process.env.ATLASSIAN_USER_NAME) envVars.push('ATLASSIAN_USER_NAME');
    if (process.env.CONFLUENCE_API_TOKEN) envVars.push('CONFLUENCE_API_TOKEN');
    if (process.env.MARKDOWN_CONFLUENCE_TOKEN) envVars.push('MARKDOWN_CONFLUENCE_TOKEN');
    if (process.env.CONFLUENCE_TOKEN) envVars.push('CONFLUENCE_TOKEN');
    if (process.env.ATLASSIAN_API_TOKEN) envVars.push('ATLASSIAN_API_TOKEN');
    if (process.env.MARKDOWN_CONFLUENCE_USERNAME) envVars.push('MARKDOWN_CONFLUENCE_USERNAME');
    if (process.env.CONFLUENCE_USERNAME) envVars.push('CONFLUENCE_USERNAME');
    logger.debug('All relevant env vars: ' + envVars.join(', '));

    // Log config file path if it exists
    const configPath = path.resolve(process.cwd(), '.markdown-confluence.json');
    if (fs.existsSync(configPath)) {
        logger.debug('Config file path: ' + configPath);
    }

    const child = spawn('npx', ['@markdown-confluence/cli', ...args], {
        stdio: 'inherit'
    });

    child.on('close', (code) => {
        if (code !== 0) {
            logger.error(`Process exited with code ${code}`);
        }
        process.exit(code);
    });
}

if (process.argv.length > 1) {
    executeCliCommand(process.argv.slice(2));
}

export default executeCliCommand; 