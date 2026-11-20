# Shared firmware layout

- pawpower_shared: shunt/CAN bridge, battery profile, battery dashboard and display-specific LCD/SD code.
- pawpower_common: common energy helpers and local browser game/preferences assets used by Tracer.
- tracer_shared: controller decoding, Tracer daily peaks and its dashboard.
- cloud_upload: optional HTTPS uploader shared by both cloud-capable entries, plus battery-only remote profile handling.

The shunt and common energy headers currently contain separate compatible implementations; keep both when updating this snapshot. Cloud YAML includes explicit headers so Tracer does not import shunt-only battery controls. Keep shared folders aligned across devices.
