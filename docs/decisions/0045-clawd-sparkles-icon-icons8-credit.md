# 0045: Clawd Sparkles from Icons8 is the logo and favicon; the credit link lives in the footer

- Status: Accepted; credit wording superseded by 0051
- Date: 2026-10-27
- Task: —

## Context
- The user picked the Icons8 "Clawd Sparkles" icon for the header logo, the favicon and the macOS app icon (ADR 0046).
- Icons8's free licence requires a visible link credit: "Clawd Sparkles icon by Icons8", linking to the icon page and icons8.com.
- The old logo was a white terminal glyph on a dark gradient box. The new icon has black outlines, which vanish on that box.

## Options
Credit:
1. **Footer, after "Made with passion by …"**: on every page, both languages, no new UI.
2. **An about dialog or page**: less clutter, but new UI the spec doesn't have.

Logo:
1. **The icon alone at 36 px**: reads on the light header.
2. **Keep the gradient box**: the outline disappears.

## Decision
Footer credit (option 1) and the icon alone (option 1), chosen by the user on 2026-10-27. The SVG is served from `src/web/public/clawd-sparkles.svg`; the prototypes show the same logo and credit.

## Consequences
- Removing the credit breaks the Icons8 licence unless the icon goes too.
- `--logo-gradient` in tokens.css is no longer used.
