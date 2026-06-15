const { execSync } = require('child_process');
const fs = require('fs');

function getGitDiff() {
  try {
    // Diff against the target branch (main)
    return execSync('git diff origin/main...HEAD --name-status', { encoding: 'utf-8' });
  } catch (error) {
    // Local fallback if origin/main is not fetched
    try {
      return execSync('git diff HEAD~1 --name-status', { encoding: 'utf-8' });
    } catch (err) {
      return '';
    }
  }
}

function analyzePR() {
  const diffOutput = getGitDiff();
  if (!diffOutput) {
    return '### Overview\nNo significant changes parsed or comparison branch not found.';
  }

  const lines = diffOutput.split('\n').filter(Boolean);
  const categories = {
    Frontend: [],
    Backend: [],
    Database: [],
    Documentation: [],
    Configuration: []
  };

  let affectedSystems = new Set();
  let totalChanges = lines.length;
  let hasCriticalFiles = false;

  lines.forEach(line => {
    const [status, filePath] = line.split(/\s+/);
    if (!filePath) return;

    if (filePath.includes('src/frontend') || filePath.includes('public/')) {
      categories.Frontend.push(`- \`${filePath}\` (${status})`);
      affectedSystems.add('User Interface');
    } else if (filePath.includes('src/backend') || filePath.includes('api/')) {
      categories.Backend.push(`- \`${filePath}\` (${status})`);
      affectedSystems.add('Core API Services');
    } else if (filePath.includes('migrations/') || filePath.includes('schema/')) {
      categories.Database.push(`- \`${filePath}\` (${status})`);
      affectedSystems.add('Database Schema');
      hasCriticalFiles = true;
    } else if (filePath.endsWith('.md') || filePath.includes('docs/')) {
      categories.Documentation.push(`- \`${filePath}\` (${status})`);
    } else {
      categories.Configuration.push(`- \`${filePath}\` (${status})`);
      if (filePath.includes('package.json') || filePath.includes('workflow')) {
        affectedSystems.add('Build/CI pipeline');
        hasCriticalFiles = true;
      }
    }
  });

  // Calculate risk profile
  let riskLevel = 'Low';
  let riskReason = 'Changes are confined to self-contained visual elements or documentation.';
  
  if (totalChanges > 30 || hasCriticalFiles) {
    riskLevel = 'High';
    riskReason = 'Contains database migrations, package dependencies modifications, or massive lines of changes.';
  } else if (totalChanges > 10 || affectedSystems.has('Core API Services')) {
    riskLevel = 'Medium';
    riskReason = 'Affects business backend logic or features multiple module updates.';
  }

  // Construct structured markdown output
  let summary = `## Pull Request Automated Summary\n\n`;
  summary += `### Overview\nThis automated summary analyzes the changes introduced in this pull request.\n\n`;
  
  summary += `### Files Modified\n`;
  for (const [cat, files] of Object.entries(categories)) {
    if (files.length > 0) {
      summary += `#### ${cat}\n${files.slice(0, 10).join('\n')}\n`;
      if (files.length > 10) summary += `- ... and ${files.length - 10} more files\n`;
      summary += `\n`;
    }
  }

  summary += `### Features Affected\n`;
  if (affectedSystems.size > 0) {
    summary += Array.from(affectedSystems).map(sys => `- ${sys}`).join('\n') + '\n\n';
  } else {
    summary += `- General maintenance changes\n\n`;
  }

  summary += `### Risk Assessment\n`;
  summary += `**Level:** \`${riskLevel}\`\n`;
  summary += `**Justification:** ${riskReason}\n\n`;

  summary += `### Testing Impact\n`;
  if (riskLevel === 'High') {
    summary += `- ⚠️ Integration and validation suites must be run manually.\n`;
    summary += `- ⚠️ Verify state transitions are covered by unit tests.\n`;
  } else {
    summary += `- Standard CI test suites are sufficient for this change risk profile.\n`;
  }
  summary += `\n`;

  summary += `### Deployment Impact\n`;
  if (categories.Database.length > 0) {
    summary += `- 🚨 **CRITICAL**: This change requires executing database migration operations prior to standard deployment steps.\n`;
  } else if (categories.Configuration.length > 0) {
    summary += `- Notice: Dependency trees or CI actions changed; verify environmental parity.\n`;
  } else {
    summary += `- Zero known deployment risks; standard hot-swap pipeline compatible.\n`;
  }

  return summary;
}

console.log(analyzePR());