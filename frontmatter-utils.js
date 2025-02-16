import matter from 'gray-matter';

/**
 * Parses a markdown file content to separate frontmatter data and body.
 * @param {string} content - Markdown file content
 * @returns {Object} - An object containing 
 *   frontmatter: an object with the frontmatter data, and 
 *   content: the markdown content without the frontmatter.
 */
function parseFrontmatter(content) {
  const result = matter(content);
  return {
    frontmatter: result.data,
    content: result.content.trim()
  };
}

/**
 * Updates the markdown content by merging existing frontmatter with new data.
 * @param {string} content - Original markdown content
 * @param {Object} newData - New frontmatter data to merge with existing data
 * @returns {string} Updated markdown content with merged frontmatter.
 */
function updateFrontmatter(content, newData) {
  const { data, content: body } = matter(content);
  const mergedData = { ...data, ...newData };
  // Optionally, filter or process mergedData here if needed
  return matter.stringify(body, mergedData);
}

export {
  parseFrontmatter,
  updateFrontmatter
}; 