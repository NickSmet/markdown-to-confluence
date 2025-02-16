#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import createLogger from './logger.js';
import { processReferences } from './reference-processor.js';
import publishToConfluence from './confluence-publisher.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const logger = createLogger('CLI');

const REQUIRED_CONFIG_KEYS = [
  'confluenceBaseUrl',
  'confluenceSpaceKey',
  'confluenceParentId',
  'atlassianUserName',
  'atlassianApiToken'
];

// Define envMapping at the module level
const envMapping = {
  confluenceBaseUrl: ['CONFLUENCE_BASE_URL', 'CONNIE_BASE_URL'],
  atlassianUserName: ['ATLASSIAN_USER_NAME', 'CONNIE_USER'],
  confluenceSpaceKey: ['CONFLUENCE_SPACE_KEY', 'CONNIE_SPACE'],
  confluenceParentId: ['CONFLUENCE_PARENT_ID', 'CONNIE_PARENT'],
  atlassianApiToken: ['CONFLUENCE_API_TOKEN', 'CONNIE_API_TOKEN']
};

/**
 * Load configuration following the hierarchy:
 * 1. Local .markdown-confluence.json in the target directory
 * 2. Shell environment variables
 */
function loadConfig(configPath) {
  let config = {};
  
  // Try to load local config file
  try {
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      logger.info('Found local configuration at:', configPath);
      logger.debug('Initial config from file:', JSON.stringify(config, null, 2));
    }
  } catch (err) {
    logger.error('Error reading local config:', err.message);
  }

  // Fill missing values from environment variables
  logger.debug('Environment variable mapping:', JSON.stringify(envMapping, null, 2));
  logger.debug('Current process.env keys:', Object.keys(process.env).filter(key => 
    Object.values(envMapping).flat().includes(key)
  ));

  // Check shell environment variables for any missing or undefined config values
  for (const [configKey, envKeys] of Object.entries(envMapping)) {
    logger.debug(`Checking config key: ${configKey}, current value:`, config[configKey]);
    if (!config[configKey] || config[configKey] === undefined) {
      for (const envKey of envKeys) {
        if (process.env[envKey]) {
          config[configKey] = process.env[envKey];
          logger.debug(`Set ${configKey} from env var ${envKey}: ${process.env[envKey]}`);
          break;
        } else {
          logger.debug(`Environment variable ${envKey} not found`);
        }
      }
    } else {
      logger.debug(`Using existing value for ${configKey} from config file`);
    }
  }

  logger.debug('Final config after merging env vars:', JSON.stringify(config, null, 2));
  return config;
}

async function ensureConfig(configPath) {
  // First load existing configuration
  logger.info('Loading configuration...');
  const existingConfig = loadConfig(configPath);
  
  // Check if any required values are missing
  const missingKeys = REQUIRED_CONFIG_KEYS.filter(key => !existingConfig[key]);
  logger.debug('Missing required keys:', missingKeys);
  
  let newConfig = { ...existingConfig };
  
  if (missingKeys.length > 0) {
    logger.warn('\nSome required configuration values are missing:');
    
    const answers = await inquirer.prompt(
      missingKeys.map(key => ({
        type: 'input',
        name: key,
        message: `Enter ${key}:`,
        default: existingConfig[key],
        validate: (value) => value.trim() !== '' || 'This field is required'
      }))
    );

    newConfig = {
      ...existingConfig,
      ...answers
    };

    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Would you like to save these values to local config?',
        default: true
      }
    ]);

    if (confirm) {
      fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), 'utf8');
      logger.success(`\nSaved configuration at ${configPath}`);
      logger.info('Tip: To avoid entering these values again, you can export them in your shell:');
      for (const [configKey, envKeys] of Object.entries(envMapping)) {
        if (missingKeys.includes(configKey)) {
          logger.info(`export ${envKeys[0]}="${newConfig[configKey]}"`);
        }
      }
    } else {
      logger.info('\nContinuing without saving configuration.');
    }
  }

  // Ensure default values for non-required fields
  newConfig = {
    ...newConfig,
    folderToPublish: newConfig.folderToPublish || '.',
    mermaid: newConfig.mermaid || {
      theme: 'default',
      padding: 5
    }
  };

  return newConfig;
}

async function runCLI() {
  const argv = yargs(hideBin(process.argv))
    .option('d', {
      alias: 'docsDir',
      type: 'string',
      default: '.',
      describe: 'Path to the folder containing markdown files (defaults to current folder)'
    })
    .help()
    .argv;

  const docsFolder = path.resolve(process.cwd(), argv.docsDir);
  logger.info('Welcome to the Markdown-to-Confluence CLI!');
  logger.info(`Working with folder: ${docsFolder}`);

  const configPath = path.join(docsFolder, '.markdown-confluence.json');
  await ensureConfig(configPath);

  // Hard-coded fixed references directory
  const FIXED_REFS_DIR = 'docs-fixed-references';
  const fixedFolder = path.join(docsFolder, FIXED_REFS_DIR);

  try {
    logger.info('\nRunning reference fixing...');
    await processReferences(docsFolder);

    logger.info('\nPublishing to Confluence...');
    await publishToConfluence(docsFolder);

    logger.success('\nAll tasks completed successfully.\n');
  } catch (error) {
    logger.error('CLI Error:', error);
    throw error;
  } finally {
    // Always try to clean up the temporary folder
    if (fs.existsSync(fixedFolder)) {
      try {
        fs.rmSync(fixedFolder, { recursive: true, force: true });
        logger.success(`\nCleaned up temporary folder: ${fixedFolder}`);
      } catch (cleanupError) {
        logger.warn(`Warning: Failed to clean up temporary folder ${fixedFolder}:`, cleanupError);
      }
    }
  }
}

runCLI().catch((error) => {
  process.exit(1);
});