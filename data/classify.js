/**
 * Shared classification functions for OVH billing items.
 *
 * Used by both the import script (data/import.js) and
 * consumed indirectly by the server (service_type is stored in DB at import time).
 */

/**
 * Classify a billing line's service type based on its description.
 * Returns one of: AI/ML, Licenses, Backup, Support, Database, Storage, Compute, Network, Other.
 */
function classifyService(description) {
  const desc = (description || '').toLowerCase();

  // AI/ML - check first as GPU instances should be AI/ML not Compute
  if (desc.includes('gpu') || desc.includes('l40s') || desc.includes('l4-') ||
      desc.includes('a100') || desc.includes('v100') || desc.includes('t4') ||
      desc.includes('h100') || desc.includes('ai ') || desc.includes(' ml') ||
      desc.includes('machine learning') || desc.includes('notebook') || desc.includes('training') ||
      desc.includes('ai deploy') || desc.includes('ai training') || desc.includes('ai notebook')) {
    return 'AI/ML';
  }

  // Licenses - check early because "Windows Server" contains "server"
  if (desc.includes('license') || desc.includes('licence')) {
    return 'Licenses';
  }

  // Backup - Veeam and backup services
  if (desc.includes('veeam') || desc.includes('backup')) {
    return 'Backup';
  }

  // Support & Services - check early because "management fee" might conflict
  if (desc.includes('support') || desc.includes('management fee') ||
      desc.includes('professional service')) {
    return 'Support';
  }

  // Database - check before Storage because "Logs - Streams" contains "storage"
  if (desc.includes('database') || desc.includes('postgresql') || desc.includes('mysql') ||
      desc.includes('mongodb') || desc.includes('redis') || desc.includes('kafka') ||
      desc.includes('opensearch') || desc.includes('cassandra') || desc.includes('mariadb') ||
      desc.includes('m3db') || desc.includes('grafana') || desc.includes('logs data platform') ||
      desc.includes('elasticsearch') || desc.includes('timeseries') ||
      desc.includes('logs -') || desc.includes('streams -')) {
    return 'Database';
  }

  // Storage - S3, Object Storage, Swift, volumes, snapshots, datastores
  // Check before Compute because "swift container" should be Storage not Compute
  if (desc.includes('storage') || desc.includes('stockage') || desc.includes('bucket') ||
      desc.includes('swift') || desc.includes('object') || desc.includes('archive') ||
      desc.includes('snapshot') || desc.includes('disque') ||
      desc.includes('volume') || desc.includes('disk') || desc.includes('s3') ||
      desc.includes('cold archive') || desc.includes('high perf') || desc.includes('classic') ||
      desc.includes('block storage') || desc.includes('additional disk') ||
      desc.includes('datastore') || desc.includes('zpool')) {
    return 'Storage';
  }

  // Compute - instances, VMs, Kubernetes, containers, hosts, bare metal
  if (desc.includes('instance') || desc.includes('compute') || desc.includes('vm') ||
      desc.includes('forfait mensuel') || desc.includes('consommation à l\'heure') ||
      desc.includes('kubernetes') || desc.includes('kube') || desc.includes('k8s') ||
      desc.includes('managed kubernetes') || desc.includes('container') ||
      desc.includes('registry') || desc.includes('worker node') || desc.includes('control plane') ||
      desc.includes('serveur') || desc.includes('server') || desc.includes('vcpu') ||
      desc.includes('ram ') || desc.includes('mémoire') ||
      // Private Cloud / vSphere hosts
      desc.includes('host ') || desc.includes('host rental') || desc.includes('esxi') ||
      desc.includes('vsphere') || desc.includes('vmware') || desc.includes('premier 384') ||
      desc.includes('premier 768') || desc.includes('premier rental') ||
      // Bare metal Scale servers
      desc.includes('scale-') || desc.includes('advance-') || desc.includes('infra-') ||
      desc.includes('hg-') || desc.includes('eg-') || desc.includes('mg-') ||
      // General dedicated
      (desc.includes('rental for 1 month') && (desc.includes('scale') || desc.includes('advance')))) {
    return 'Compute';
  }

  // Network - load balancers, IPs, bandwidth, egress
  if (desc.includes('network') || desc.includes('loadbalancer') || desc.includes('load balancer') ||
      desc.includes('floating ip') || desc.includes('gateway') || desc.includes('bandwidth') ||
      desc.includes('octavia') || desc.includes('private network') || desc.includes('vrack') ||
      desc.includes('egress') || desc.includes('ingress') || desc.includes('traffic') ||
      desc.includes('trafic') || desc.includes('ip failover') || desc.includes('additional ip') ||
      desc.includes('public ip') || desc.includes('réseau') || desc.includes('outgoing') ||
      desc.includes('ip v4 block') || desc.includes('ip block') || desc.includes('/27') ||
      desc.includes('/28') || desc.includes('/29') || desc.includes('/30')) {
    return 'Network';
  }

  return 'Other';
}

/**
 * Classify a billing line's resource_type based on its domain field.
 * Returns one of: private_cloud, private_cloud_host, private_cloud_datastore,
 * telecom, web_cloud, ip_service, storage, support, dedicated_server, domain,
 * license, backup, load_balancer, vps, cloud_project, other.
 */
function classifyResourceTypeFromDomain(domain) {
  if (!domain) return 'other';

  // Private Cloud Management Fee: pcc-.../managementfee
  if (/^pcc-[^/]+\/managementfee$/.test(domain)) return 'private_cloud';
  // Private Cloud Host: pcc-.../host/NNN
  if (/^pcc-[^/]+\/host\/\d+$/.test(domain)) return 'private_cloud_host';
  // Private Cloud Host: pcc-.../IP (e.g. pcc-xxx/172.16.0.1)
  if (/^pcc-[^/]+\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(domain)) return 'private_cloud_host';
  // Private Cloud Datastore: pcc-.../zpool/NNN
  if (/^pcc-[^/]+\/zpool\/\d+$/.test(domain)) return 'private_cloud_datastore';
  // Private Cloud Datastore: pcc-.../ssd-NNN
  if (/^pcc-[^/]+\/ssd-\d+$/.test(domain)) return 'private_cloud_datastore';
  // Private Cloud Datastore: pcc-.../pcc-NNN
  if (/^pcc-[^/]+\/pcc-\d+$/.test(domain)) return 'private_cloud_datastore';
  // Private Cloud (general catch-all for remaining pcc- entries)
  if (/^pcc-/.test(domain)) return 'private_cloud';
  // Private Cloud: domain starts with * or contains @pcc.pcc-
  if (/^\*\d{3,}/.test(domain) || /@pcc\.pcc-/.test(domain)) return 'private_cloud';

  // Telecom/SMS: sms-...
  if (/^sms-/.test(domain)) return 'telecom';
  // Backup VM: vm-NNNNNN
  if (/^vm-\d+$/.test(domain)) return 'backup';
  // Logs Data Platform: ldp-...
  if (/^ldp-/.test(domain)) return 'storage';
  // Premium support: premium.support....
  if (/^premium\.support\./.test(domain)) return 'support';

  // Windows License: UUID (8-4-4-4-12) used for licenses
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(domain)) return 'license';

  // IP block: ip-X.X.X.X/XX
  if (/^ip-\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/.test(domain)) return 'ip_service';
  // IP Service: bare IPv4
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(domain)) return 'ip_service';

  // Dedicated server: nsXXXX.ip-....eu (with optional suffix like -disk1)
  if (/^ns\d+\.ip-[\d-]+\.eu/.test(domain)) return 'dedicated_server';
  // Dedicated server: ns*.ovh.net
  if (/^ns\d+\.ovh\.net/.test(domain)) return 'dedicated_server';
  // Dedicated server: ks/rt/sd/hg/eg/mg prefixed
  if (/^(ks|rt|sd|hg|eg|mg)\d+/.test(domain)) return 'dedicated_server';
  // Dedicated server: ns followed by digits (catch-all for ns-prefixed servers)
  if (/^ns\d+/.test(domain)) return 'dedicated_server';

  // VPS: vps-xxxx or vpsNNN
  if (/^vps(-|\d)/.test(domain)) return 'vps';
  // Load Balancer: lb-xxxx or loadbalancer-
  if (/^lb-/.test(domain) || /^loadbalancer-/.test(domain)) return 'load_balancer';
  // Storage: storage-xxxx or zpool-
  if (/^storage-/.test(domain) || /^zpool-/.test(domain)) return 'storage';

  // Web Cloud: *.ovh domains (excluding patterns already handled above)
  if (/\.ovh$/.test(domain)) return 'web_cloud';

  // Domain names: *.fr, *.com, *.net, etc.
  if (/\.(fr|com|org|net|io|eu|cloud|tech|dev|info|pro)$/.test(domain) && !/^ns\d+/.test(domain)) return 'domain';

  // Telephony (phone numbers)
  if (/^\d{10,}$/.test(domain)) return 'telephony';

  // Cloud project: 32-char hex ID
  if (/^[0-9a-f]{32}$/i.test(domain)) return 'cloud_project';

  // Fallback
  return 'other';
}

module.exports = { classifyService, classifyResourceTypeFromDomain };
