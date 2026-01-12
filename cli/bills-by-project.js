#!/usr/bin/env node
/**
 * Extract bills from local database
 *
 * Usage:
 *   node cli/bills-by-project.js --project "AI"
 *   node cli/bills-by-project.js --project "AI" --from 2025-01-01 --to 2025-12-31
 *   node cli/bills-by-project.js --project "AI" --format md
 *   node cli/bills-by-project.js --month 2025-12
 *   node cli/bills-by-project.js --list
 */

const db = require('../data/db');

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const params = {
    project: null,
    month: null,
    from: null,
    to: null,
    format: 'json',
    list: false
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--project' && args[i + 1]) {
      params.project = args[++i];
    } else if (args[i] === '--month' && args[i + 1]) {
      params.month = args[++i];
    } else if (args[i] === '--from' && args[i + 1]) {
      params.from = args[++i];
    } else if (args[i] === '--to' && args[i + 1]) {
      params.to = args[++i];
    } else if (args[i] === '--format' && args[i + 1]) {
      params.format = args[++i].toLowerCase();
    } else if (args[i] === '--list') {
      params.list = true;
    }
  }

  return params;
}

// Format number as currency (European format)
function formatCurrency(value) {
  return value.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Format month label (YYYY-MM -> Mois YYYY)
function formatMonthLabel(yearMonth) {
  const [year, month] = yearMonth.split('-');
  const months = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
                  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  return `${months[parseInt(month, 10) - 1]} ${year}`;
}

// List all available projects
function listProjects() {
  const projects = db.projects.getAll();

  if (projects.length === 0) {
    console.error('No projects found in database. Run import first.');
    process.exit(1);
  }

  console.log('\nAvailable projects:\n');
  console.log('Name                                    | ID');
  console.log('----------------------------------------|------------------------------------');
  for (const p of projects) {
    const name = (p.name || 'N/A').padEnd(40).substring(0, 40);
    console.log(`${name}| ${p.id}`);
  }
  console.log(`\nTotal: ${projects.length} projects`);
}

// Generate markdown output for project
function outputMarkdownProject(result) {
  const lines = [];

  lines.push(`# Factures pour le projet ${result.project}`);
  lines.push('');

  if (result.period.from && result.period.to) {
    lines.push(`**Période :** ${result.period.from} au ${result.period.to}`);
  } else {
    lines.push(`**Période :** Toutes les factures`);
  }
  lines.push('');

  lines.push(`| Facture | Date | Montant HT (€) |`);
  lines.push(`|---------|------|---------------:|`);

  for (const bill of result.bills) {
    lines.push(`| ${bill.id} | ${bill.date} | ${formatCurrency(bill.amount)} |`);
  }

  lines.push(`| **TOTAL** | | **${formatCurrency(result.total)}** |`);
  lines.push('');
  lines.push(`*${result.billsCount} facture${result.billsCount > 1 ? 's' : ''}*`);
  lines.push('');
  lines.push(`---`);
  lines.push(`*Généré le ${new Date().toISOString().split('T')[0]} par ovh-cost-manager*`);

  return lines.join('\n');
}

// Generate markdown output for month
function outputMarkdownMonth(result) {
  const lines = [];

  lines.push(`# Factures de ${result.monthLabel}`);
  lines.push('');

  lines.push(`| Facture | Date | Montant HT (€) |`);
  lines.push(`|---------|------|---------------:|`);

  for (const bill of result.bills) {
    lines.push(`| ${bill.id} | ${bill.date} | ${formatCurrency(bill.amount)} |`);
  }

  lines.push(`| **TOTAL** | | **${formatCurrency(result.total)}** |`);
  lines.push('');
  lines.push(`*${result.billsCount} facture${result.billsCount > 1 ? 's' : ''}*`);
  lines.push('');
  lines.push(`---`);
  lines.push(`*Généré le ${new Date().toISOString().split('T')[0]} par ovh-cost-manager*`);

  return lines.join('\n');
}

// Show usage help
function showHelp() {
  console.error('Usage: node cli/bills-by-project.js [options]');
  console.error('');
  console.error('Options:');
  console.error('  --project <name|id>   Extract bills for a specific project');
  console.error('  --month YYYY-MM       Extract all bills for a specific month');
  console.error('  --from YYYY-MM-DD     Start date (with --project)');
  console.error('  --to YYYY-MM-DD       End date (with --project)');
  console.error('  --format json|md      Output format (default: json)');
  console.error('  --list                List all available projects');
  console.error('');
  console.error('Examples:');
  console.error('  node cli/bills-by-project.js --list');
  console.error('  node cli/bills-by-project.js --project "AI"');
  console.error('  node cli/bills-by-project.js --project "AI" --from 2025-01-01 --to 2025-12-31');
  console.error('  node cli/bills-by-project.js --project "AI" --format md');
  console.error('  node cli/bills-by-project.js --month 2025-12');
  console.error('  node cli/bills-by-project.js --month 2025-12 --format md');
}

// Handle --month mode
function handleMonth(params) {
  // Validate month format
  if (!/^\d{4}-\d{2}$/.test(params.month)) {
    console.error(`Invalid month format: ${params.month}. Use YYYY-MM (e.g., 2025-12)`);
    process.exit(1);
  }

  const bills = db.analysis.billsByMonth(params.month);

  if (bills.length === 0) {
    console.error(`No bills found for month ${params.month}`);
    db.closeDb();
    process.exit(1);
  }

  // Calculate total
  const total = bills.reduce((sum, b) => sum + (b.amount || 0), 0);

  // Build result
  const result = {
    month: params.month,
    monthLabel: formatMonthLabel(params.month),
    bills: bills.map(b => ({
      id: b.bill_id,
      date: b.date,
      amount: Math.round(b.amount * 100) / 100
    })),
    total: Math.round(total * 100) / 100,
    billsCount: bills.length
  };

  // Output
  if (params.format === 'md' || params.format === 'markdown') {
    console.log(outputMarkdownMonth(result));
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

// Handle --project mode
function handleProject(params) {
  const bills = db.analysis.billsByProject(params.project, params.from, params.to);

  if (bills.length === 0) {
    console.error(`No bills found for project "${params.project}"`);
    console.error('Use --list to see available projects');
    db.closeDb();
    process.exit(1);
  }

  // Calculate total
  const total = bills.reduce((sum, b) => sum + (b.amount || 0), 0);

  // Build result
  const result = {
    project: params.project,
    period: {
      from: params.from || null,
      to: params.to || null
    },
    bills: bills.map(b => ({
      id: b.bill_id,
      date: b.date,
      amount: Math.round(b.amount * 100) / 100
    })),
    total: Math.round(total * 100) / 100,
    billsCount: bills.length
  };

  // Output
  if (params.format === 'md' || params.format === 'markdown') {
    console.log(outputMarkdownProject(result));
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

// Main function
function main() {
  const params = parseArgs();

  // Handle --list
  if (params.list) {
    listProjects();
    db.closeDb();
    return;
  }

  // Handle --month
  if (params.month) {
    handleMonth(params);
    db.closeDb();
    return;
  }

  // Handle --project
  if (params.project) {
    handleProject(params);
    db.closeDb();
    return;
  }

  // No valid option provided
  showHelp();
  process.exit(1);
}

main();
