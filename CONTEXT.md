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

**Service**:
What OVHcloud bills under one identifier, which each of its bill lines names: a dedicated
server, a VPS, a domain, an IP block, a Public Cloud project… Its identifier gives its
resource type.
_Avoid_: resource (what the inventory lists), subscription

**Charge**:
What a service's bill line pays for, as its description names it without the period it
covers: an instance's monthly plan, a flavor's hourly use in a region, a model's input
tokens… The lines that pay for one charge in two months differ only by their period.
_Avoid_: wording, label

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

**Public Cloud product**:
The OVHcloud product that a bill line of a Public Cloud project pays for (instances, object
storage, volumes, databases, load balancers…), read from its description when the server reads
the bills: each line has one, but for the Public Cloud credit that a bill uses, which pays for
none. The Public Cloud tab gives the products with a card of their own a card each, and
gathers the others in its other services: with the credit, the cards add up to the month's
cloud total.
_Avoid_: card (a product's figure), category, cloud resource kind (what a project's current
consumption is split by)

**AI Endpoints model**:
A model that OVHcloud's AI Endpoints product serves, which names the charges of a Public
Cloud project that pay for its use: most often its input tokens and its output tokens,
priced apart; an embedding model's input tokens alone, a speech-to-text model's seconds of
audio.
_Avoid_: LLM, engine

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

**Month in progress**:
The calendar month of today, while it has not billed each recurring service yet: its cost so
far lacks theirs. OVHcloud bills some accounts early in the month, others late.
_Avoid_: current month (the Public Cloud's current consumption is another thing), open month

**Recurring service**:
A service that the bills of each of the three months before the month of today charged.
_Avoid_: regular service, subscription

**Projected cost**:
The cost of the month in progress with each recurring service that it has not billed yet
counted at its cost of the month before, assuming it stays the same.
_Avoid_: forecast (the Public Cloud's end-of-month consumption), estimate (an estimated cost is
a resource's share of a bill line)

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
