"""Domain-specific planning helpers for infrastructure manifest drafting.

Public API
----------
Each submodule exposes one ``build_*_fragment`` function that accepts a
validated spec and returns a ``CanonicalResource``.  The ``combiner`` module
assembles a list of fragments into a complete ``CanonicalManifest``.

Usage example::

    from app.domain.helpers import (
        compute, containers, database, load_balancing,
        monitoring, networking, storage,
    )
    from app.domain.helpers.combiner import combine_fragments
    from app.domain.helpers.specs import ComputeSpec, DatabaseSpec

    ec2 = compute.build_compute_fragment(
        ComputeSpec(logical_name="api", instance_type="t3.medium", image="ubuntu-24.04"),
        tags={"env": "production"},
    )
    rds = database.build_database_fragment(
        DatabaseSpec(logical_name="db", engine="postgres", instance_class="db.t3.micro"),
        tags={"env": "production"},
    )
    manifest = combine_fragments(
        fragments=[ec2, rds],
        provider="aws",
        region="ap-southeast-1",
        environment="production",
        metadata=...,
    )
"""
