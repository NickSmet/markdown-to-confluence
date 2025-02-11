const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');
const { processReferences, parseFrontmatter, updateFrontmatter } = require('./reference-processor');

// Add timestamp to logs
function log(...args) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [Publisher]`, ...args);
}

// Function to update page IDs in original files
function updatePageIds(docsFolder, output) {
    log('Starting updatePageIds for folder:', docsFolder);
    const urlRegex = /SUCCESS: (.+?) Content: .+?Page URL: https:\/\/coreljira\.atlassian\.net\/wiki\/spaces\/([^\/]+)\/pages\/(\d+)/g;
    const pageIdMap = new Map();
    const spaceKeyMap = new Map();
    let hasNewIds = false;
    
    log('Processing command output for page IDs...');
    let match;
    while ((match = urlRegex.exec(output)) !== null) {
        const [_, relativePath, spaceKey, pageId] = match;
        log(`Found page ID mapping: ${relativePath} -> ${pageId} (space: ${spaceKey})`);
        pageIdMap.set(relativePath, { pageId, spaceKey });
    }
    
    function processFile(filePath) {
        log(`Processing file: ${filePath}`);
        const content = fs.readFileSync(filePath, 'utf8');
        log(`File content length: ${content.length} bytes`);
        log(`File content preview: ${content.substring(0, 200)}...`);
        
        const { frontmatter: existingFrontmatter, content: restContent } = parseFrontmatter(content);
        log('Existing frontmatter:', existingFrontmatter);
        
        const relativePath = path.relative(docsFolder, filePath);
        const pageInfo = pageIdMap.get(relativePath);
        
        if (pageInfo) {
            log(`Found page info for ${relativePath}:`, pageInfo);
            const newFrontmatter = Object.assign({}, existingFrontmatter);
            newFrontmatter['connie-page-id'] = pageInfo.pageId;
            newFrontmatter['connie-publish'] = true;
            newFrontmatter['connie-space-key'] = pageInfo.spaceKey;
            newFrontmatter['connie-dont-change-parent-page'] = false;
            
            if (!newFrontmatter['connie-title'] || newFrontmatter['connie-title'].trim() === '') {
                newFrontmatter['connie-title'] = path.basename(filePath, '.md');
            }
            
            const updatedContent = updateFrontmatter(restContent, newFrontmatter);
            log(`Updated content preview: ${updatedContent.substring(0, 200)}...`);
            fs.writeFileSync(filePath, updatedContent);
            log(`Updated frontmatter for ${relativePath} with page ID ${pageInfo.pageId}`);
            hasNewIds = true;
            return true;
        }
        log(`No page info found for ${relativePath}`);
        return false;
    }
    
    function processDir(dir) {
        log(`Processing directory: ${dir}`);
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        log(`Found ${entries.length} entries in directory`);
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                processDir(fullPath);
            } else if (entry.name.endsWith('.md')) {
                log(`Found markdown file: ${entry.name}`);
                processFile(fullPath);
            }
        }
    }
    
    processDir(docsFolder);
    return hasNewIds;
}

async function publishToConfluence(docsFolder = '.') {
    log('Starting publishToConfluence for folder:', docsFolder);
    
    // 1. Read the local .markdown-confluence.json from docsFolder
    const configPath = path.join(docsFolder, '.markdown-confluence.json');
    let config;
    try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        log('Successfully loaded config from:', configPath);
    } catch (err) {
        log('Error reading config:', err);
        throw new Error(`Could not read .markdown-confluence.json in ${docsFolder}.`);
    }

    // Add ignore patterns to the config if not present
    if (!config.ignore) {
        config.ignore = [];
    }
    // Add 'images' folder to ignored paths if not already present
    if (!config.ignore.includes('images')) {
        config.ignore.push('images');
    }
    if (!config.ignore.includes('assets/images')) {
        config.ignore.push('assets/images');
    }
    log('Updated config ignore patterns:', config.ignore);

    // Hard-coded fixed references directory
    const FIXED_REFS_DIR = 'docs-fixed-references';
    log('Using fixed references directory:', FIXED_REFS_DIR);

    // Set up the fixed folder path
    const fixedFolder = path.join(docsFolder, FIXED_REFS_DIR);
    log('Fixed folder path:', fixedFolder);

    // Store original config state
    const originalConfig = { ...config };

    try {
        // First phase: publish all files and get their IDs
        log('\nPhase 1: Publishing files and getting page IDs...');
        
        // Set contentRoot to the temp folder where the files with fixed references are stored
        log(`Setting temporary content root folder to: ${fixedFolder}`);
        config.contentRoot = fixedFolder;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

        // Check if the fixed folder exists and list its contents
        if (!fs.existsSync(fixedFolder)) {
            log(`Fixed folder doesn't exist at: ${fixedFolder}`);
            log(`Current working directory: ${process.cwd()}`);
            log(`Contents of docsFolder (${docsFolder}):`, fs.readdirSync(docsFolder));
            throw new Error(`Fixed folder '${fixedFolder}' doesn't exist.`);
        } else {
            log('Listing contents of fixed folder:');
            function listDir(dir, indent = '') {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                entries.forEach(entry => {
                    const fullPath = path.join(dir, entry.name);
                    log(`${indent}${entry.name}${entry.isDirectory() ? '/' : ''}`);
                    if (entry.isDirectory()) {
                        listDir(fullPath, indent + '  ');
                    } else if (entry.name.endsWith('.md')) {
                        const content = fs.readFileSync(fullPath, 'utf8');
                        log(`${indent}  Content preview: ${content.substring(0, 100)}...`);
                    }
                });
            }
            listDir(fixedFolder);
        }

        // Build the absolute path to cli-executor.js
        const markdownConfluenceScript = path.join(__dirname, 'cli-executor.js');
        log(`Using cli-executor.js from: ${markdownConfluenceScript}`);
        log('Current working directory:', process.cwd());
        log('Content root directory:', config.contentRoot);
        log('Checking if content root exists:', fs.existsSync(config.contentRoot));
        
        // Log configuration for debugging
        log('Current configuration:', {
            ...config,
            atlassianApiToken: config.atlassianApiToken ? '***' : undefined
        });
        
        // Verify the script exists
        if (!fs.existsSync(markdownConfluenceScript)) {
            throw new Error(`cli-executor.js not found at: ${markdownConfluenceScript}`);
        }
        
        // Run the first publish to get page IDs
        log('Executing cli-executor.js...');
        try {
            const output = execSync(`node "${markdownConfluenceScript}"`, { 
                cwd: docsFolder, 
                encoding: 'utf8',
                env: {
                    ...process.env,
                    DEBUG: 'markdown-confluence:*'  // Enable debug logging
                },
                stdio: ['inherit', 'pipe', 'pipe']  // Capture both stdout and stderr
            });
            log('cli-executor.js output:', output);

            // Update page IDs in original files and check if we got any new IDs
            log('\nUpdating page IDs in original files...');
            const hasNewIds = updatePageIds(docsFolder, output);

            // Second phase: if we got new IDs, reprocess references and republish
            if (hasNewIds) {
                log('\nPhase 2: New page IDs found, updating references and republishing...');
                
                // Clean up the fixed folder before the second run
                if (fs.existsSync(fixedFolder)) {
                    fs.rmSync(fixedFolder, { recursive: true, force: true });
                    log(`Cleaned up temporary folder before second run: ${fixedFolder}`);
                }
                
                // Process references again with the new IDs
                await processReferences(docsFolder);
                
                // Run the second publish to update references
                log('\nRepublishing with updated references...');
                const secondOutput = execSync(`node "${markdownConfluenceScript}"`, { cwd: docsFolder, encoding: 'utf8' });
                log(secondOutput);
            }

            log('\nDone! All changes have been published to Confluence.');
        } catch (error) {
            log('Error executing cli-executor.js:');
            log('Exit code:', error.status);
            log('Signal:', error.signal);
            log('stdout:', error.stdout);
            log('stderr:', error.stderr);
            log('Working directory:', docsFolder);
            log('Script path:', markdownConfluenceScript);
            throw error;
        }
    } catch (error) {
        log('Error during publishing:', error);
        throw error;
    } finally {
        // Always restore the original config
        fs.writeFileSync(configPath, JSON.stringify(originalConfig, null, 2));
        log('Restored original configuration.');

        // Always clean up the temporary folder
        if (fs.existsSync(fixedFolder)) {
            try {
                fs.rmSync(fixedFolder, { recursive: true, force: true });
                log(`Cleaned up temporary folder: ${fixedFolder}`);
            } catch (cleanupError) {
                log(`Warning: Failed to clean up temporary folder ${fixedFolder}:`, cleanupError);
            }
        }
    }
}

module.exports = publishToConfluence;