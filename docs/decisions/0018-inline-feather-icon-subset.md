# 0018: Inline the Feather icons the prototype uses in one Icon component

- Status: Accepted
- Date: 2026-10-24
- Task: T5

## Context
- The spec names Feather for icons; the prototype inlines 27 Feather SVGs.
- Every icon button needs `aria-label` and `title`, so the icon itself is always decorative.

## Options
1. **Inline subset**: `<Icon name>` in `src/web/Icon.tsx` holding only the paths we use (MIT, credited in the file). No dependency; markup matches the prototype.
2. **feather-icons**: every icon available, but it renders SVG strings, so we would need `dangerouslySetInnerHTML` or a wrapper. One dependency.
3. **react-feather**: React components, but a dependency that has seen little maintenance.

## Decision
Option 1, chosen by the user on 2026-10-24. The icon is `aria-hidden` and not focusable; the control around it carries the name.

## Consequences
- A new icon means copying its paths from feathericons.com into `PATHS`; `IconName` stays type-checked.
