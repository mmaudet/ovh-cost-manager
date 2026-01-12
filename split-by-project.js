#!/usr/bin/env node
/**
 * Split OVH bills by Cloud Project
 *
 * Usage: node split-by-project.js [--from YYYY-MM-DD] [--to YYYY-MM-DD]
 *
 * Example: node split-by-project.js --from 2025-12-01 --to 2025-12-31
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
    to: null
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from' && args[i + 1]) {
      params.from = args[++i];
    } else if (args[i] === '--to' && args[i + 1]) {
      params.to = args[++i];
    }
  }

  return params;
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

async function splitBillsByProject(from, to) {
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

  // Output results
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

  console.log(JSON.stringify(result, null, 2));
}

// Main
const params = parseArgs();
if (!params.from || !params.to) {
  console.error('Usage: node split-by-project.js --from YYYY-MM-DD --to YYYY-MM-DD');
  console.error('Example: node split-by-project.js --from 2025-12-01 --to 2025-12-31');
  process.exit(1);
}

splitBillsByProject(params.from, params.to);
