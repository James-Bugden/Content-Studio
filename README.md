# Content Studio

Internal content-operations dashboard for James's existing Google Drive, Google Sheet and Typefully workflow.

The product contract, architecture, field mappings, state model, testing tiers and delivery order are in [docs/MASTER-SPEC.md](docs/MASTER-SPEC.md).

The canonical flow is fixed:

```text
Content / Editing Markdown/master
  -> Content Library
  -> Ready Queue
  -> Content Schedule
  -> Typefully
```

Content Studio is a control surface over that system. It is not a replacement content database.

