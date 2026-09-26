# OVH Cost Manager

Analysis of OVHcloud bills: every bill line is imported, classified and shown by
resource, project and period, to see what the infrastructure costs.

## Language

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
