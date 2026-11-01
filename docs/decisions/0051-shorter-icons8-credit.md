# 0051: The footer credit shrinks to one "Icon: Icons8" link

- Status: Accepted
- Date: 2026-10-27
- Task: v2 manual debug
- Supersedes: the credit wording of 0045

## Context
- The user wanted the Icons8 reference out of the footer, keeping only a code comment for credit.
- ADR 0045: the free Icons8 licence needs a visible link credit while the Clawd Sparkles icon is the logo and favicon. A comment alone does not meet it.

## Options
1. **Remove it, keep the comment**: a clean footer, but breaks the free licence unless a paid licence covers it.
2. **Smaller credit**: one muted link, "Icon: Icons8" (zh-TW "圖示：Icons8"), to the icon's page on icons8.com.
3. **Keep the footer as it is**: "Clawd Sparkles icon by Icons8", two links.

## Decision
Option 2, chosen by the user on 2026-10-27. The link goes to the icon page, which names both the icon and Icons8. The comment in `Footer.tsx` keeps the full credit. The prototypes show the same text.

## Consequences
- The credit is still visible, so the licence note in 0045 still holds: removing it needs the icon to go, or a paid licence.
