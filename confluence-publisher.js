const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');
const { processReferences, parseFrontmatter, updateFrontmatter } = require('./reference-processor');
const createLogger = require('./logger');

const logger = createLogger('Publisher');

// Function to update page IDs in original files
function updatePageIds(docsFolder, output) {
    logger.info('Starting updatePageIds for folder:', docsFolder);
    const urlRegex = /SUCCESS: (.+?) Content: .+?Page URL: https:\/\/coreljira\.atlassian\.net\/wiki\/spaces\/([^\/]+)\/pages\/(\d+)/g;
    const pageIdMap = new Map();
    const spaceKeyMap = new Map();
    let hasNewIds = false;
    
    logger.info('Processing command output for page IDs...');
    let match;
    while ((match = urlRegex.exec(output)) !== null) {
        const [_, relativePath, spaceKey, pageId] = match;
        logger.debug(`Found page ID mapping: ${relativePath} -> ${pageId} (space: ${spaceKey})`);
        pageIdMap.set(relativePath, { pageId, spaceKey });
    }
    
    function processFile(filePath) {
        logger.debug(`Processing file: ${filePath}`);
        const content = fs.readFileSync(filePath, 'utf8');
        
        const { frontmatter: existingFrontmatter, content: restContent } = parseFrontmatter(content);
        logger.debug('Existing frontmatter:', existingFrontmatter);
        
        const relativePath = path.relative(docsFolder, filePath);
        const pageInfo = pageIdMap.get(relativePath);
        
        if (pageInfo) {
            logger.debug(`Found page info for ${relativePath}:`, pageInfo);
            const newFrontmatter = Object.assign({}, existingFrontmatter);
            newFrontmatter['connie-page-id'] = pageInfo.pageId;
            newFrontmatter['connie-publish'] = true;
            newFrontmatter['connie-space-key'] = pageInfo.spaceKey;
            newFrontmatter['connie-dont-change-parent-page'] = false;
            
            if (!newFrontmatter['connie-title'] || newFrontmatter['connie-title'].trim() === '') {
                newFrontmatter['connie-title'] = path.basename(filePath, '.md');
            }
            
            const updatedContent = updateFrontmatter(restContent, newFrontmatter);
            fs.writeFileSync(filePath, updatedContent);
            logger.success(`Updated frontmatter for ${relativePath} with page ID ${pageInfo.pageId}`);
            hasNewIds = true;
            return true;
        }
        logger.debug(`No page info found for ${relativePath}`);
        return false;
    }
    
    function processDir(dir) {
        logger.debug(`Processing directory: ${dir}`);
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        logger.debug(`Found ${entries.length} entries in directory`);
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                processDir(fullPath);
            } else if (entry.name.endsWith('.md')) {
                logger.debug(`Found markdown file: ${entry.name}`);
                processFile(fullPath);
            }
        }
    }
    
    processDir(docsFolder);
    return hasNewIds;
}

async function publishToConfluence(docsFolder = '.') {
    logger.info('Starting publishToConfluence for folder:', docsFolder);
    
    // 1. Read the local .markdown-confluence.json from docsFolder
    const configPath = path.join(docsFolder, '.markdown-confluence.json');
    let config;
    try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        logger.success('Successfully loaded config from:', configPath);
    } catch (err) {
        logger.error('Error reading config:', err);
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
    logger.debug('Updated config ignore patterns:', config.ignore);

    // Hard-coded fixed references directory
    const FIXED_REFS_DIR = 'docs-fixed-references';
    logger.debug('Using fixed references directory:', FIXED_REFS_DIR);

    // Set up the fixed folder path
    const fixedFolder = path.join(docsFolder, FIXED_REFS_DIR);
    logger.debug('Fixed folder path:', fixedFolder);

    // Store original config state
    const originalConfig = { ...config };

    try {
        // First phase: publish all files and get their IDs
        logger.info('\nPhase 1: Publishing files and getting page IDs...');
        
        // Set contentRoot to the temp folder where the files with fixed references are stored
        logger.debug(`Setting temporary content root folder to: ${fixedFolder}`);
        config.contentRoot = fixedFolder;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

        // Check if the fixed folder exists
        if (!fs.existsSync(fixedFolder)) {
            logger.error(`Fixed folder doesn't exist at: ${fixedFolder}`);
            logger.debug(`Current working directory: ${process.cwd()}`);
            logger.debug(`Contents of docsFolder (${docsFolder}):`, fs.readdirSync(docsFolder));
            throw new Error(`Fixed folder '${fixedFolder}' doesn't exist.`);
        }

        // Build the absolute path to cli-executor.js
        const markdownConfluenceScript = path.join(__dirname, 'cli-executor.js');
        logger.debug(`Using cli-executor.js from: ${markdownConfluenceScript}`);
        
        // Verify the script exists
        if (!fs.existsSync(markdownConfluenceScript)) {
            throw new Error(`cli-executor.js not found at: ${markdownConfluenceScript}`);
        }
        
        // Run the first publish to get page IDs
        logger.info('Executing cli-executor.js...');
        try {
            const output = execSync(`node "${markdownConfluenceScript}"`, { 
                cwd: docsFolder, 
                encoding: 'utf8',
                env: {
                    ...process.env,
                    DEBUG: 'markdown-confluence:*'
                },
                stdio: ['inherit', 'pipe', 'pipe']
            });

            // Update page IDs in original files and check if we got any new IDs
            logger.info('\nUpdating page IDs in original files...');
            const hasNewIds = updatePageIds(docsFolder, output);

            // Second phase: if we got new IDs, reprocess references and republish
            if (hasNewIds) {
                logger.info('\nPhase 2: New page IDs found, updating references and republishing...');
                
                // Clean up the fixed folder before the second run
                if (fs.existsSync(fixedFolder)) {
                    fs.rmSync(fixedFolder, { recursive: true, force: true });
                    logger.debug(`Cleaned up temporary folder before second run: ${fixedFolder}`);
                }
                
                // Process references again with the new IDs
                await processReferences(docsFolder);
                
                // Run the second publish to update references
                logger.info('\nRepublishing with updated references...');
                const secondOutput = execSync(`node "${markdownConfluenceScript}"`, { 
                    cwd: docsFolder, 
                    encoding: 'utf8',
                    env: {
                        ...process.env,
                        DEBUG: 'markdown-confluence:*'
                    },
                    stdio: ['inherit', 'pipe', 'pipe']
                });
                logger.debug(secondOutput);
            }

            logger.success('\nAll changes have been published to Confluence.');
        } catch (error) {
            logger.error('Error executing cli-executor.js:');
            logger.error('Exit code:', error.status);
            logger.error('Signal:', error.signal);
            logger.error('stdout:', error.stdout);
            logger.error('stderr:', error.stderr);
            throw error;
        }
    } catch (error) {
        logger.error('Error during publishing:', error);
        throw error;
    } finally {
        // Always restore the original config
        fs.writeFileSync(configPath, JSON.stringify(originalConfig, null, 2));
        logger.info('Restored original configuration.');

        // Always clean up the temporary folder
        if (fs.existsSync(fixedFolder)) {
            try {
                fs.rmSync(fixedFolder, { recursive: true, force: true });
                logger.success(`Cleaned up temporary folder: ${fixedFolder}`);
            } catch (cleanupError) {
                logger.warn(`Failed to clean up temporary folder ${fixedFolder}:`, cleanupError);
            }
        }
    }
}

module.exports = publishToConfluence;