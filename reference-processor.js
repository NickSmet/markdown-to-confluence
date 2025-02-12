const fs = require('fs');
const path = require('path');
const { parseFrontmatter, updateFrontmatter } = require('./frontmatter-utils');
const createLogger = require('./logger');

const logger = createLogger('References');

/**
 * Dynamically load the config from the provided base folder.
 * This ensures that .markdown-confluence.json is read from the folder you're setting.
 */
function getUserConfig(baseFolder) {
    const configPath = path.join(baseFolder, '.markdown-confluence.json');
    if (!fs.existsSync(configPath)) {
        throw new Error(`Could not find .markdown-confluence.json in ${baseFolder}.`);
    }
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

/**
 * Recursively copy a directory from src to dest while excluding a specific folder (if encountered).
 * @param {string} src - source directory path
 * @param {string} dest - destination directory path
 * @param {string} [excludePath] - absolute path of the folder to exclude (if found under src)
 */
function copyDir(src, dest, excludePath) {
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }
    
    const entries = fs.readdirSync(src, { withFileTypes: true });
    
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        // Exclude the fixed (temp) folder if found inside the source.
        if (excludePath && path.resolve(srcPath) === path.resolve(excludePath)) {
            logger.debug(`Excluding temporary folder from copy: ${srcPath}`);
            continue;
        }
        const destPath = path.join(dest, entry.name);
        
        if (entry.isDirectory()) {
            copyDir(srcPath, destPath, excludePath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

// Function to normalize path for comparison
function normalizePath(p) {
    return p.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

// Function to build page ID map
function buildPageIdMap(dir) {
    const pageMap = new Map();
    
    function processDir(currentDir, relativePath = '') {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            const relPath = path.join(relativePath, entry.name);
            
            if (entry.isDirectory()) {
                processDir(fullPath, relPath);
            } else if (entry.name.endsWith('.md')) {
                const content = fs.readFileSync(fullPath, 'utf8');
                const { frontmatter } = parseFrontmatter(content);
                
                if (frontmatter && frontmatter['connie-page-id']) {
                    const basePath = relPath.replace(/\.md$/, '');
                    const normalizedPath = normalizePath(relPath);
                    const normalizedBasePath = normalizePath(basePath);
                    
                    pageMap.set(normalizedPath, frontmatter['connie-page-id']);
                    pageMap.set(normalizedBasePath, frontmatter['connie-page-id']);
                    
                    const parentDir = path.dirname(normalizedPath);
                    if (parentDir !== '.') {
                        pageMap.set(parentDir, frontmatter['connie-page-id']);
                    }
                    
                    logger.debug(`Added page ID mapping: ${normalizedPath} -> ${frontmatter['connie-page-id']}`);
                }
            }
        }
    }
    
    processDir(dir);
    return pageMap;
}

// Function to update original files with new page IDs
function updateOriginalFiles(sourceDir, targetDir) {
    const pageIdMap = new Map();
    const spaceKeyMap = new Map();
    
    try {
        const commandOutput = fs.readFileSync('command_output.txt', 'utf8');
        const urlRegex = /SUCCESS: (.+?) Content: .+?Page URL: https:\/\/coreljira\.atlassian\.net\/wiki\/spaces\/([^\/]+)\/pages\/(\d+)/g;
        let match;
        while ((match = urlRegex.exec(commandOutput)) !== null) {
            const [_, relativePath, spaceKey, pageId] = match;
            const normalizedPath = normalizePath(relativePath.replace(/\.md$/, ''));
            pageIdMap.set(normalizedPath, pageId);
            spaceKeyMap.set(pageId, spaceKey);
            logger.debug(`Found new page ID ${pageId} for ${normalizedPath} in space ${spaceKey}`);
        }
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        logger.debug('No command output file found, using existing page IDs only.');
    }

    function processDir(currentDir, relativePath = '') {
        const entries = fs.readdirSync(path.join(sourceDir, relativePath), { withFileTypes: true });
        
        for (const entry of entries) {
            const sourcePath = path.join(sourceDir, relativePath, entry.name);
            const relativeFilePath = path.join(relativePath, entry.name);
            
            if (entry.isDirectory()) {
                processDir(currentDir, relativeFilePath);
            } else if (entry.name.endsWith('.md')) {
                const sourceContent = fs.readFileSync(sourcePath, 'utf8');
                const { frontmatter: existingFrontmatter } = parseFrontmatter(sourceContent);

                const normalizedPath = normalizePath(relativeFilePath.replace(/\.md$/, ''));
                const pageId = pageIdMap.get(normalizedPath);
                
                const newFrontmatter = {
                    ...existingFrontmatter,
                    ...(pageId
                        ? {
                            'connie-page-id': pageId,
                            'connie-publish': typeof existingFrontmatter['connie-publish'] !== 'undefined' 
                                ? existingFrontmatter['connie-publish'] 
                                : true,
                            'connie-space-key': spaceKeyMap.get(pageId) || existingFrontmatter['connie-space-key'] || null,
                        }
                        : {}
                    ),
                    'connie-title': existingFrontmatter['connie-title'] || path.basename(entry.name, '.md'),
                    'connie-dont-change-parent-page': existingFrontmatter['connie-dont-change-parent-page'] || false,
                };

                if (existingFrontmatter['connie-blog-post-date']) {
                    newFrontmatter['connie-blog-post-date'] = existingFrontmatter['connie-blog-post-date'];
                    newFrontmatter['connie-content-type'] = 'blogpost';
                } else {
                    newFrontmatter['connie-content-type'] = existingFrontmatter['connie-content-type'] || 'page';
                }

                const updatedContent = updateFrontmatter(sourceContent, newFrontmatter);
                fs.writeFileSync(sourcePath, updatedContent);

                logger.debug(`Updated frontmatter for ${sourcePath} with page ID ${newFrontmatter['connie-page-id'] || 'NO_ID'}`);
            }
        }
    }
    
    processDir(sourceDir);
    return { pageIdMap, spaceKeyMap };
}

// Function to fix references in a markdown file
function fixReferences(content, pageMap, filePath, spaceKeyMap, config) {
    const { frontmatter, content: cleanContent } = parseFrontmatter(content);

    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    const baseDir = path.dirname(filePath);
    
    const fixedContent = cleanContent.replace(linkRegex, (match, text, url) => {
        if (url.includes('/wiki/spaces/') || url.startsWith('http')) {
            return match;
        }
        
        // Try various path variations to find the page ID
        const pathVariations = [
            url,
            url.replace(/\.md$/, ''),
            path.join(baseDir, url).replace(/\\/g, '/'),
            path.join(baseDir, url).replace(/\.md$/, '').replace(/\\/g, '/'),
            url.replace('./', ''),
            url.replace('./', '').replace(/\.md$/, ''),
            path.normalize(path.join(baseDir, url)).replace(/\\/g, '/'),
            path.normalize(path.join(baseDir, url)).replace(/\.md$/, '').replace(/\\/g, '/')
        ].map(p => normalizePath(p));
        
        logger.debug(`\nProcessing link: ${url}`);
        logger.debug('Base directory:', baseDir);
        logger.debug('Path variations:', pathVariations);
        
        let pageId = null;
        let fullPath = null;
        
        for (const p of pathVariations) {
            if (pageMap.has(p)) {
                pageId = pageMap.get(p);
                fullPath = p;
                logger.debug(`Found page ID ${pageId} for path: ${p}`);
                break;
            }
        }
        
        if (pageId) {
            const spaceKey = spaceKeyMap.get(pageId) || config.confluenceSpaceKey;
            const confluenceUrl = `${config.confluenceBaseUrl}/wiki/spaces/${spaceKey}/pages/${pageId}`;
            return `[${text}](${confluenceUrl})`;
        } else {
            logger.debug(`No page ID found for any variation of: ${url}`);
            return match;
        }
    });

    return updateFrontmatter(fixedContent, frontmatter);
}

// Main function that processes everything
async function processReferences(baseFolder = process.cwd()) {
    // Load config from the folder that is being set
    const config = getUserConfig(baseFolder);

    // The folder to publish is determined by config.folderToPublish OR the provided baseFolder
    const folderToPublish = config.folderToPublish ? path.resolve(baseFolder, config.folderToPublish) : baseFolder;

    // Hard-coded fixed references directory
    const FIXED_REFS_DIR = 'docs-fixed-references';

    // For publishing we're going to work on a temporary folder
    const sourceDir = folderToPublish;
    const targetDir = path.resolve(folderToPublish, FIXED_REFS_DIR);

    logger.info(`Copying source directory from: ${sourceDir}`);
    logger.info(`Target fixed references directory (temporary folder): ${targetDir}`);
    copyDir(sourceDir, targetDir, targetDir);

    logger.info('Building page ID map...');
    const pageMap = buildPageIdMap(targetDir);
    logger.debug('\nPage ID mappings:');
    for (const [p, id] of pageMap.entries()) {
        logger.debug(`${p} -> ${id}`);
    }

    // Update the files in the temporary folder with the new page ID frontmatter,
    // so the updated title is also picked up on publish.
    logger.info('\nUpdating page IDs (and frontmatter) in temporary files...');
    // Notice we now use targetDir for both parameters so that the temp files get updated.
    const { pageIdMap, spaceKeyMap } = updateOriginalFiles(targetDir, targetDir);

    // Merge the maps so pageMap reflects any new IDs.
    for (const [p, id] of pageIdMap.entries()) {
        if (!pageMap.has(p)) {
            pageMap.set(p, id);
        }
    }

    logger.info('\nFixing references in temporary files...');
    function processMarkdownFiles(dir) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                processMarkdownFiles(fullPath);
            } else if (entry.name.endsWith('.md')) {
                logger.debug(`\nProcessing ${fullPath}...`);
                // Compute the file path relative to targetDir for lookup.
                const relativeFilePath = path.relative(targetDir, fullPath);
                const fixedContent = fixReferences(
                    fs.readFileSync(fullPath, 'utf8'),
                    pageMap,
                    relativeFilePath,
                    spaceKeyMap,
                    config
                );
                fs.writeFileSync(fullPath, fixedContent);
            }
        }
    }

    processMarkdownFiles(targetDir);
    logger.success('\nReference processing complete.');
}

// When running directly, execute processReferences() with process.cwd() as base.
if (require.main === module) {
    processReferences().catch(error => {
        logger.error('Error:', error);
        process.exit(1);
    });
}

module.exports = {
    processReferences,
    parseFrontmatter,
    updateFrontmatter,
    getUserConfig,
    copyDir,
    normalizePath,
    buildPageIdMap,
    updateOriginalFiles,
    fixReferences
}; 