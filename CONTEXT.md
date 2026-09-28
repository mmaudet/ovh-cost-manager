# OVH Cost Manager

Analysis of OVHcloud bills: every bill line is imported, classified and shown by
resource, project and period, to see what the infrastructure costs.

## Language

**Account**:
An OVHcloud customer account, identified by its NIC handle. Every bill, project and
resource that OCM imports belongs to one account.
_Avoid_: NIC (the account's identifier), customer, tenant, organisation

**Unknown account**:
Where the data imported before OCM told accounts apart goes when no account claims it,
and nothing tells that the database was one account's (ADR 0002).
_Avoid_: unassigned, orphan

**Bill line**:
One line of an OVH bill: a description, the identifier of the billed service and an
amount.
_Avoid_: bill detail

**Resource type**:
The kind of service a bill line pays for, derived from its service identifier:
Public Cloud project, dedicated server, VPS, domain, Web Cloud, IP, storage, licence…
_Avoid_: category

**Service type**:
What a bill line's money goes to (compute, storage, network, database, AI/ML…),
derived from its description. Distinct from the resource type: an instance and a
bucket of the same Public Cloud project share a resource type, not a service type.
_Avoid_: service category

**Inventory**:
The resources that exist now according to the OVH API (instances, buckets, volumes,
servers…), as opposed to what the bill lines say was paid for.

**Cloud resource kind**:
What a resource of a Public Cloud project is (instance, volume…), the dimension its
consumption is split by.
_Avoid_: resource type (that is the classification of a bill line)

**Web Cloud family**:
A subgroup of the Web Cloud services: domain, DNS zone, hosting, email or option.
_Avoid_: category

**Exact cost**:
The cost of a bill line that names a single resource.

**Estimated cost**:
A resource's share of an aggregated bill line that covers several resources, split pro
rata or evenly between them.
_Avoid_: allocated cost

**Unallocated cost**:
The cost of a Public Cloud project's instance bill lines whose instances are no longer
in the inventory, typically deleted since they were billed.
_Avoid_: unattributed cost

**Carbon footprint**:
The greenhouse gas emissions that OVHcloud's carbon calculator attributes to an account's
services for a month, in kilograms of CO2 equivalent, counting the local electricity mix
of each datacenter (location-based).
_Avoid_: CO2, emissions, energy, consumption (the Public Cloud's, in euros)

**Market-based footprint**:
The carbon footprint as OVHcloud also reports it, counting its low-carbon energy
contracts instead of the local electricity mix.

**Emission source**:
One of the three parts that OVHcloud splits a carbon footprint into: manufacturing (of
the servers), electricity (that they draw) and operations (freight, buildings, staff…).
_Avoid_: category, scope (OVHcloud's scopes 1 to 3 are all its customer's scope 3), usage
(which names the Public Cloud's consumption)

**Month of use**:
The month a bill line pays for: the month before its bill's for the lines of a Public
Cloud project, which OVHcloud bills after use, and the month of its bill for the others.
_Avoid_: usage month, billing month

**Carbon intensity**:
The carbon footprint of a line of OVHcloud's file per unit of the currency that the bill
lines that it ties to cost in its month of use.
_Avoid_: efficiency, emission factor

**Covered cost**:
The part of a month of use's cost whose bill lines the carbon footprint of that month
covers, before their credits and discounts: those of the services that it names, and every
dedicated server's when it names none of them.
_Avoid_: covered spend

**Covered share**:
The share of a month of use's cost, before its credits and discounts, that is covered
cost, which shows what the carbon footprint leaves out.
_Avoid_: coverage rate
