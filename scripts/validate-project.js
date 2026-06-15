const fs = require('fs');
const path = require('path');

const CONFIG = {
  srcDir: path.join(__dirname, '../src'),
  allowedFilePattern: /^[a-z0-9.-]+$/, // kebab-case and simple structures
  excludeDirs: ['node_modules', 'dist', 'build', '.git'],
  duplicateLineThreshold: 10, // match duplicate blocks of this size
};

const results = {
  naming: [],
  imports: [],
  cycles: [],
  duplicates: []
};

function getAllFiles(dirPath, arrayOfFiles = []) {
  if (!fs.existsSync(dirPath)) return arrayOfFiles;
  const files = fs.readdirSync(dirPath);

  files.forEach(file => {
    if (CONFIG.excludeDirs.includes(file)) return;
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      getAllFiles(fullPath, arrayOfFiles);
    } else {
      arrayOfFiles.push(fullPath);
    }
  });

  return arrayOfFiles;
}

// 1. Validate Naming Conventions
function checkFileNaming(files) {
  files.forEach(file => {
    const filename = path.basename(file);
    const ext = path.extname(filename);
    const base = path.basename(filename, ext);
    if (!CONFIG.allowedFilePattern.test(base)) {
      results.naming.push(`File "${filename}" in "${path.relative(process.cwd(), file)}" must be kebab-case.`);
    }
  });
}

// 2. Parse Imports and Detect Cycles
function checkImportsAndCycles(files) {
  const dependencyGraph = {};

  files.forEach(file => {
    if (!['.ts', '.tsx', '.js', '.jsx'].includes(path.extname(file))) return;
    const content = fs.readFileSync(file, 'utf-8');
    const relativeFilePath = path.relative(process.cwd(), file);
    dependencyGraph[relativeFilePath] = [];

    // Simple import extraction regex
    const importRegex = /(?:import|from|require)\s*['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const importPath = match[1];
      if (importPath.startsWith('.')) {
        const absoluteImportDir = path.dirname(file);
        const resolvedPath = path.resolve(absoluteImportDir, importPath);
        
        // Match standard extensions
        let finalPath = '';
        for (const ext of ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.js']) {
          const testPath = resolvedPath + (ext.startsWith('/') ? ext : ext);
          if (fs.existsSync(testPath) && fs.statSync(testPath).isFile()) {
            finalPath = testPath;
            break;
          }
          if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
            finalPath = resolvedPath;
            break;
          }
        }
        
        if (finalPath) {
          const relativeTarget = path.relative(process.cwd(), finalPath);
          dependencyGraph[relativeFilePath].push(relativeTarget);
        } else {
          // Warning for broken imports
          results.imports.push(`Broken import path: "${importPath}" in ${relativeFilePath}`);
        }
      }
    }
  });

  // Cycle detection using DFS (Three-color coloring algorithm)
  const visited = {}; // 0 = unvisited, 1 = visiting, 2 = visited
  const pathStack = [];

  function detectCycle(node) {
    visited[node] = 1;
    pathStack.push(node);

    const neighbors = dependencyGraph[node] || [];
    for (const neighbor of neighbors) {
      if (!visited[neighbor]) {
        if (detectCycle(neighbor)) return true;
      } else if (visited[neighbor] === 1) {
        const cycleStartIndex = pathStack.indexOf(neighbor);
        const cyclePath = pathStack.slice(cycleStartIndex);
        results.cycles.push(`Circular dependency: ${cyclePath.join(' -> ')} -> ${neighbor}`);
        return true;
      }
    }

    pathStack.pop();
    visited[node] = 2;
    return false;
  }

  Object.keys(dependencyGraph).forEach(node => {
    if (!visited[node]) {
      detectCycle(node);
    }
  });
}

// 3. Detect Duplications
function checkCodeDuplication(files) {
  const lineBlocks = {};

  files.forEach(file => {
    if (!['.ts', '.tsx', '.js', '.jsx', '.css'].includes(path.extname(file))) return;
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 5);
    const relPath = path.relative(process.cwd(), file);

    for (let i = 0; i <= lines.length - CONFIG.duplicateLineThreshold; i++) {
      const block = lines.slice(i, i + CONFIG.duplicateLineThreshold).join('\n');
      if (lineBlocks[block]) {
        if (lineBlocks[block].file !== relPath) {
          results.duplicates.push(
            `Duplicate code detected between:\n  - ${lineBlocks[block].file} (around line ${lineBlocks[block].line})\n  - ${relPath} (around line ${i + 1})`
          );
          // Break early per file to prevent excessive reporting
          break;
        }
      } else {
        lineBlocks[block] = { file: relPath, line: i + 1 };
      }
    }
  });
}

// Main execution orchestrator
function run() {
  console.log('Running structural and architectural validations...');
  const files = getAllFiles(CONFIG.srcDir);

  checkFileNaming(files);
  checkImportsAndCycles(files);
  checkCodeDuplication(files);

  let clean = true;
  
  if (results.naming.length > 0) {
    console.error('\n❌ Naming Violations:');
    results.naming.forEach(err => console.error(err));
    clean = false;
  }
  if (results.imports.length > 0) {
    console.error('\n❌ Import Violations:');
    results.imports.forEach(err => console.error(err));
    clean = false;
  }
  if (results.cycles.length > 0) {
    console.error('\n❌ Circular Dependencies Found:');
    results.cycles.forEach(err => console.error(err));
    clean = false;
  }
  if (results.duplicates.length > 0) {
    console.error('\n❌ Duplication Violations:');
    results.duplicates.forEach(err => console.error(err));
    clean = false;
  }

  if (clean) {
    console.log('\n✓ Architectural validation checks passed.');
    process.exit(0);
  } else {
    process.exit(1);
  }
}

run();