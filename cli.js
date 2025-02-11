#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const inquirer = require('inquirer');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

// IMPORTANT: Adjust these requires to match your local filenames
const { processReferences } = require('./reference-processor');
const publishToConfluence = require('./confluence-publisher');

const REQUIRED_CONFIG_KEYS = [
  'confluenceBaseUrl',
  'confluenceSpaceKey',
  'confluenceParentId',
  'atlassianUserName',
  'atlassianApiToken'
];

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
      console.log('Found local configuration at:', configPath);
    }
  } catch (err) {
    console.log('Error reading local config:', err.message);
  }

  // Fill missing values from environment variables
  const envMapping = {
    confluenceBaseUrl: ['CONFLUENCE_BASE_URL', 'CONNIE_BASE_URL'],
    atlassianUserName: ['ATLASSIAN_USER_NAME', 'CONNIE_USER'],
    confluenceSpaceKey: ['CONFLUENCE_SPACE_KEY', 'CONNIE_SPACE'],
    confluenceParentId: ['CONFLUENCE_PARENT_ID', 'CONNIE_PARENT'],
    atlassianApiToken: ['CONFLUENCE_API_TOKEN', 'CONNIE_API_TOKEN']
  };

  // Check shell environment variables
  for (const [configKey, envKeys] of Object.entries(envMapping)) {
    if (!config[configKey]) {
      for (const envKey of envKeys) {
        if (process.env[envKey]) {
          config[configKey] = process.env[envKey];
          console.log(`Found ${configKey} in environment variable ${envKey}`);
          break;
        }
      }
    }
  }

  return config;
}

async function ensureConfig(configPath) {
  // First load existing configuration
  const existingConfig = loadConfig(configPath);
  
  // Check if any required values are missing
  const missingKeys = REQUIRED_CONFIG_KEYS.filter(key => !existingConfig[key]);
  
  let newConfig = { ...existingConfig };
  
  if (missingKeys.length > 0) {
    console.log('\nSome required configuration values are missing:');
    
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
      console.log(`\nSaved configuration at ${configPath}`);
      console.log('Tip: To avoid entering these values again, you can export them in your shell:');
      for (const [configKey, envKeys] of Object.entries(envMapping)) {
        if (missingKeys.includes(configKey)) {
          console.log(`export ${envKeys[0]}="${newConfig[configKey]}"`);
        }
      }
    } else {
      console.log('\nContinuing without saving configuration.');
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
  console.log('Welcome to the Markdown-to-Confluence CLI!');
  console.log(`Working with folder: ${docsFolder}`);

  const configPath = path.join(docsFolder, '.markdown-confluence.json');
  const config = await ensureConfig(configPath);

  // Hard-coded fixed references directory
  const FIXED_REFS_DIR = 'docs-fixed-references';
  const fixedFolder = path.join(docsFolder, FIXED_REFS_DIR);

  try {
    console.log('\nRunning reference fixing...');
    await processReferences(docsFolder);

    console.log('\nPublishing to Confluence...');
    await publishToConfluence(docsFolder);

    console.log('\nAll tasks completed successfully.\n');
  } catch (err) {
    console.error('CLI Error:', err);
    throw err;
  } finally {
    // Always try to clean up the temporary folder
    if (fs.existsSync(fixedFolder)) {
      try {
        fs.rmSync(fixedFolder, { recursive: true, force: true });
        console.log(`\nCleaned up temporary folder: ${fixedFolder}`);
      } catch (cleanupError) {
        console.error(`Warning: Failed to clean up temporary folder ${fixedFolder}:`, cleanupError);
      }
    }
  }
}

runCLI().catch((err) => {
  process.exit(1);
});