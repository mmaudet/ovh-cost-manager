#!/usr/bin/env node
/**
 * Split OVH bills by Cloud Project
 *
 * Usage: node split-by-project.js --from YYYY-MM-DD --to YYYY-MM-DD [--format json|md]
 *
 * Examples:
 *   node split-by-project.js --from 2025-12-01 --to 2025-12-31
 *   node split-by-project.js --from 2025-12-01 --to 2025-12-31 --format md
 */

const Jsonfile = require('jsonfile');
const Path = require('path');
const APP_DATA = Path.resolve(process.env.HOME, "my-ovh-bills");

const cred = Jsonfile.readFileSync(Path.resolve(APP_DATA, 'credentials.json'));
const ovh = require('ovh')(cred);

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const params = {
    from: null,
    to: null,
    format: 'json'
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from' && args[i + 1]) {
      params.from = args[++i];
    } else if (args[i] === '--to' && args[i + 1]) {
      params.to = args[++i];
    } else if (args[i] === '--format' && args[i + 1]) {
      params.format = args[++i].toLowerCase();
    }
  }

  return params;
}

// Format number as currency (European format)
function formatCurrency(value) {
  return value.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Generate markdown output
function outputMarkdown(result) {
  const lines = [];

  lines.push(`# Facturation OVH par Projet`);
  lines.push(``);
  lines.push(`**Période :** ${result.period.from} au ${result.period.to}`);
  lines.push(``);
  lines.push(`## Résumé`);
  lines.push(``);
  lines.push(`| Catégorie | Total HT (€) |`);
  lines.push(`|-----------|-------------:|`);
  lines.push(`| Public Cloud | ${formatCurrency(result.summary.cloudTotal)} |`);
  lines.push(`| Autres services | ${formatCurrency(result.summary.nonCloudTotal)} |`);
  lines.push(`| **TOTAL** | **${formatCurrency(result.summary.grandTotal)}** |`);
  lines.push(``);
  lines.push(`## Détail par Projet Cloud`);
  lines.push(``);
  lines.push(`| Projet | Total HT (€) | Lignes |`);
  lines.push(`|--------|-------------:|-------:|`);

  for (const project of result.cloudProjects) {
    lines.push(`| ${project.name} | ${formatCurrency(project.total)} | ${project.detailsCount} |`);
  }

  lines.push(`| **Sous-total Cloud** | **${formatCurrency(result.summary.cloudTotal)}** | |`);
  lines.push(``);
  lines.push(`## Autres Services (non Cloud)`);
  lines.push(``);
  lines.push(`| Catégorie | Total HT (€) | Lignes |`);
  lines.push(`|-----------|-------------:|-------:|`);
  lines.push(`| Serveurs dédiés, domaines, etc. | ${formatCurrency(result.summary.nonCloudTotal)} | ${result.nonCloudServices.itemsCount} |`);
  lines.push(``);
  lines.push(`---`);
  lines.push(`*Généré le ${new Date().toISOString().split('T')[0]} par ovh-bill*`);

  return lines.join('\n');
}

async function getCloudProjects() {
  const projectIds = await ovh.requestPromised('GET', '/cloud/project');
  const projects = {};

  for (const projectId of projectIds) {
    try {
      const info = await ovh.requestPromised('GET', `/cloud/project/${projectId}`);
      projects[projectId] = info.description || projectId;
    } catch (err) {
      projects[projectId] = projectId;
    }
  }

  return projects;
}

async function getBillsInRange(from, to) {
  const params = {};
  if (from) params['date.from'] = from;
  if (to) params['date.to'] = to;

  return await ovh.requestPromised('GET', '/me/bill', params);
}

async function splitBillsByProject(from, to, format) {
  console.error('Fetching cloud projects...');
  const projectNames = await getCloudProjects();
  console.error(`Found ${Object.keys(projectNames).length} cloud projects\n`);

  console.error('Fetching bills...');
  const billIds = await getBillsInRange(from, to);
  console.error(`Found ${billIds.length} bills\n`);

  const projectTotals = {};
  const nonCloudTotal = { total: 0, items: [] };

  for (const billId of billIds) {
    try {
      const detailIds = await ovh.requestPromised('GET', `/me/bill/${billId}/details`);

      for (const detailId of detailIds) {
        const detail = await ovh.requestPromised('GET', `/me/bill/${billId}/details/${detailId}`);
        const domain = detail.domain || '';
        const price = detail.totalPrice?.value || 0;
        const desc = detail.description || '';

        if (price === 0) continue;

        const projectName = projectNames[domain];

        if (projectName) {
          if (!projectTotals[projectName]) {
            projectTotals[projectName] = { total: 0, details: [] };
          }
          projectTotals[projectName].total += price;
          projectTotals[projectName].details.push({ billId, desc, price, domain });
        } else {
          nonCloudTotal.total += price;
          nonCloudTotal.items.push({ billId, domain, desc, price });
        }
      }
    } catch (err) {
      console.error(`Error processing bill ${billId}: ${err.message}`);
    }
  }

  // Sort projects by total descending
  const sorted = Object.entries(projectTotals)
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.total - a.total);

  // Calculate grand total
  const cloudTotal = sorted.reduce((sum, p) => sum + p.total, 0);
  const grandTotal = cloudTotal + nonCloudTotal.total;

  // Build result object
  const result = {
    period: { from, to },
    summary: {
      cloudTotal: Math.round(cloudTotal * 100) / 100,
      nonCloudTotal: Math.round(nonCloudTotal.total * 100) / 100,
      grandTotal: Math.round(grandTotal * 100) / 100
    },
    cloudProjects: sorted.map(p => ({
      name: p.name,
      total: Math.round(p.total * 100) / 100,
      detailsCount: p.details.length
    })),
    nonCloudServices: {
      total: Math.round(nonCloudTotal.total * 100) / 100,
      itemsCount: nonCloudTotal.items.length
    }
  };

  // Output in requested format
  if (format === 'md' || format === 'markdown') {
    console.log(outputMarkdown(result));
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

// Main
const params = parseArgs();
if (!params.from || !params.to) {
  console.error('Usage: node split-by-project.js --from YYYY-MM-DD --to YYYY-MM-DD [--format json|md]');
  console.error('');
  console.error('Options:');
  console.error('  --from YYYY-MM-DD    Start date of billing period (required)');
  console.error('  --to YYYY-MM-DD      End date of billing period (required)');
  console.error('  --format json|md     Output format: json (default) or md (markdown)');
  console.error('');
  console.error('Examples:');
  console.error('  node split-by-project.js --from 2025-12-01 --to 2025-12-31');
  console.error('  node split-by-project.js --from 2025-12-01 --to 2025-12-31 --format md');
  console.error('  node split-by-project.js --from 2025-12-01 --to 2025-12-31 --format md > report.md');
  process.exit(1);
}

if (params.format !== 'json' && params.format !== 'md' && params.format !== 'markdown') {
  console.error(`Invalid format: ${params.format}. Use 'json' or 'md'.`);
  process.exit(1);
}

splitBillsByProject(params.from, params.to, params.format);
