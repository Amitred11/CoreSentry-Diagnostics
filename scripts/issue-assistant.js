const fs = require('fs');

async function run() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    console.error('No GitHub event payload found.');
    process.exit(1);
  }

  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  const issue = event.issue;
  const body = issue.body || '';
  const title = issue.title || '';

  console.log(`Analyzing issue #${issue.number}: "${title}"`);

  // Detect missing information or placeholder evasion attempts
  const validations = [
    { pattern: /TBD/i, message: '"TBD" (To Be Determined)' },
    { pattern: /N\/A/i, message: '"N/A" (Not Applicable)' },
    { pattern: /todo/i, message: '"TODO" placeholders' },
    { pattern: /^asdf$/i, message: 'meaningless character inputs' }
  ];

  let missingInfoDetected = false;
  const triggers = [];

  validations.forEach(val => {
    if (val.pattern.test(body)) {
      missingInfoDetected = true;
      triggers.push(val.message);
    }
  });

  // Check description length
  if (body.trim().length < 50) {
    missingInfoDetected = true;
    triggers.push('overall context explanation being too short (less than 50 characters)');
  }

  const octokitModule = require('@actions/github');
  const core = require('@actions/core');
  const token = process.env.GITHUB_TOKEN;
  const octokit = octokitModule.getOctokit(token);
  const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');

  if (missingInfoDetected) {
    const responseComment = `### ⚠️ Missing / Incomplete Details Detected
Hello @${issue.user.login}, it looks like your submission contains placeholder inputs or lacks sufficient details. 
Specifically, we flagged: **${triggers.join(', ')}**.

Please edit the issue body with complete diagnostic context, actual execution paths, or environment specifications. This issue has been labeled \`needs-more-info\`.`;

    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issue.number,
      body: responseComment
    });

    await octokit.rest.issues.addLabels({
      owner,
      repo,
      issue_number: issue.number,
      labels: ['needs-more-info']
    });

    console.log('Flagged issue for missing information.');
  }

  // Duplicate Check Strategy
  try {
    const { data: issues } = await octokit.rest.issues.listForRepo({
      owner,
      repo,
      state: 'open',
      per_page: 100
    });

    const duplicates = issues.filter(i => {
      if (i.number === issue.number) return false;
      
      // Calculate Jaccard similarity between words of titles
      const words = text => new Set(text.toLowerCase().split(/\s+/).filter(w => w.length > 3));
      const currentWords = words(title);
      const comparisonWords = words(i.title);
      
      const intersection = new Set([...currentWords].filter(w => comparisonWords.has(w)));
      const union = new Set([...currentWords, ...comparisonWords]);
      const similarity = intersection.size / union.size;
      
      return similarity > 0.55; // 55% word match threshold
    });

    if (duplicates.length > 0) {
      const duplicateLinks = duplicates.map(d => `- #${d.number} ("${d.title}")`).join('\n');
      const duplicateComment = `### 🔍 Potential Duplicates Detected
Hello @${issue.user.login}, our automated duplicate engine found existing open issues that may address this concern:

${duplicateLinks}

Please check if these issues already capture your scenario. If they do, consider closing this and appending feedback to the older thread.`;

      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: issue.number,
        body: duplicateComment
      });
      console.log('Posted duplicate warnings.');
    }
  } catch (error) {
    console.error('Error conducting duplicate checking logic:', error);
  }
}

run();