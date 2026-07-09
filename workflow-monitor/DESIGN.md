# Workflow Monitor Design System

This app is a dense workflow inspection surface, not a landing page. The default layout should feel closer to a code editor: persistent navigation, a stable graph workspace, and a compact inspector.

## Foundations

- Fonts: Space Grotesk for UI labels and headings, JetBrains Mono for paths, commands, code, and compact metadata.
- Density: use compact control sizing and tight vertical rhythm. Prefer 4px/8px increments.
- Radius: use small editor radii for monitor panels (`8px`-`14px`), reserving larger radii only for run-library cards.
- Motion: keep hover transitions subtle and limited to `transform`, `opacity`, `filter`, `background`, and border color.

## Color Tokens

- Paper background: warm off-white base with a quiet grid texture.
- Ink: dark blue-gray text for primary labels.
- Muted: lower-contrast blue-gray for labels, timestamps, and secondary metadata.
- Surface: translucent paper panels for the graph and inspector.
- Editor: dark blue-black preview surface with light code text.
- Accent: blue-gray for selected nodes, active paths, and focus outlines.
- Status: existing workflow status colors are the only semantic status palette.

## Layout

- Selected run view uses three persistent desktop columns: left run/node rail, center React Flow graph, right inspector/preview.
- Left rail is for orientation only: compact run context and quick node navigation from the current snapshot.
- Center graph remains the primary workspace and should keep the largest flexible column.
- Right inspector owns node details, commands, artifacts, previews, and activity.

## Components

- Buttons use existing native buttons with class-based styling. Do not add icon packages or Tailwind.
- Code and path surfaces use JetBrains Mono, darker or muted backgrounds, and copy affordances where text is meant to be reused.
- Artifact preview should look like an editor tab: compact top bar, path hierarchy, metadata chips, and a dark scrollable code body.

## Constraints

- Keep API access through existing hooks and `lib/api` only.
- Keep React Flow as the graph renderer.
- New visual values should be added as CSS variables before use.
