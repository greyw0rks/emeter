---
name: emeter
description: A light, framed workspace for bounded API payments and inspectable evidence.
colors:
  canvas: '#a8baff'
  void: '#f6f6fb'
  graphite: '#ffffff'
  raised: '#f0edfb'
  line: '#e8e5f0'
  line-strong: '#c9c1dd'
  ink: '#292636'
  muted: '#695f77'
  dim: '#6e607b'
  mint: '#6554d9'
  mint-hover: '#5542c8'
  mint-surface: '#eee8ff'
  lavender: '#e8e2ff'
  soft-mint: '#d6f3e4'
  success: '#356d51'
  success-surface: '#def3e5'
  butter: '#fff5bb'
  lime: '#82682d'
  lime-surface: '#fff5c9'
  red: '#9d4765'
  red-surface: '#fbe3eb'
typography:
  display:
    fontFamily: var(--font-geist-sans), sans-serif
    fontSize: clamp(54px, 5.4vw, 86px)
    fontWeight: 540
    lineHeight: 1.05
    letterSpacing: -0.04em
  headline:
    fontFamily: var(--font-geist-sans), sans-serif
    fontSize: 36px
    fontWeight: 560
    lineHeight: 1.15
    letterSpacing: -0.035em
  title:
    fontFamily: var(--font-geist-sans), sans-serif
    fontSize: 20px
    fontWeight: 560
    lineHeight: 1.3
    letterSpacing: -0.02em
  subtitle:
    fontFamily: var(--font-geist-sans), sans-serif
    fontSize: 16px
    fontWeight: 560
    lineHeight: 1.4
  body:
    fontFamily: var(--font-geist-sans), sans-serif
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.6
  hero-body:
    fontFamily: var(--font-geist-sans), sans-serif
    fontSize: 17px
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: var(--font-geist-sans), sans-serif
    fontSize: 12px
    fontWeight: 550
    lineHeight: 1.6
  support:
    fontFamily: var(--font-geist-sans), sans-serif
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.6
  button:
    fontFamily: var(--font-geist-sans), sans-serif
    fontSize: 13px
    fontWeight: 560
    lineHeight: 1.4
  navigation:
    fontFamily: var(--font-geist-sans), sans-serif
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.6
  badge:
    fontFamily: var(--font-geist-sans), sans-serif
    fontSize: 10px
    fontWeight: 500
    lineHeight: 1.5
  data:
    fontFamily: var(--font-geist-sans), sans-serif
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.6
  code:
    fontFamily: var(--font-geist-mono), monospace
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.75
  metric:
    fontFamily: var(--font-geist-mono), monospace
    fontSize: 27px
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: -0.025em
rounded:
  radius: 12px
  radius-sm: 7px
  compact: 4px
  frame: 18px
  frame-phone: 14px
  dialog: 16px
spacing:
  space-1: 4px
  space-2: 8px
  space-3: 12px
  space-4: 16px
  space-5: 24px
  space-6: 32px
  space-7: 48px
  space-8: 64px
components:
  button-primary:
    backgroundColor: '{colors.mint}'
    textColor: '{colors.void}'
    typography: '{typography.button}'
    rounded: '{rounded.radius-sm}'
    padding: 10px 16px
    height: 42px
  button-primary-hover:
    backgroundColor: '{colors.mint-hover}'
    textColor: '{colors.void}'
  button-secondary:
    backgroundColor: '{colors.graphite}'
    textColor: '{colors.ink}'
    typography: '{typography.button}'
    rounded: '{rounded.radius-sm}'
    padding: 10px 16px
    height: 42px
  button-quiet:
    backgroundColor: transparent
    textColor: '{colors.muted}'
    typography: '{typography.button}'
    rounded: '{rounded.radius-sm}'
    padding: 7px 9px
    height: 42px
  button-danger:
    backgroundColor: '{colors.red-surface}'
    textColor: '{colors.red}'
    typography: '{typography.button}'
    rounded: '{rounded.radius-sm}'
    padding: 10px 16px
    height: 42px
  input:
    backgroundColor: '{colors.void}'
    textColor: '{colors.ink}'
    typography: '{typography.body}'
    rounded: '{rounded.radius-sm}'
    padding: 10px 12px
  navigation:
    backgroundColor: '{colors.graphite}'
    textColor: '{colors.muted}'
    typography: '{typography.navigation}'
    rounded: '{rounded.radius-sm}'
    padding: 11px 12px
    height: 44px
  navigation-active:
    backgroundColor: '{colors.mint-surface}'
    textColor: '{colors.mint}'
  badge-neutral:
    backgroundColor: '{colors.graphite}'
    textColor: '{colors.muted}'
    typography: '{typography.badge}'
    rounded: '{rounded.compact}'
    padding: 2px 8px
    height: 24px
  badge-mint:
    backgroundColor: '{colors.success-surface}'
    textColor: '{colors.success}'
    typography: '{typography.badge}'
    rounded: '{rounded.compact}'
    padding: 2px 8px
    height: 24px
  badge-lime:
    backgroundColor: '{colors.lime-surface}'
    textColor: '{colors.lime}'
    typography: '{typography.badge}'
    rounded: '{rounded.compact}'
    padding: 2px 8px
    height: 24px
  badge-red:
    backgroundColor: '{colors.red-surface}'
    textColor: '{colors.red}'
    typography: '{typography.badge}'
    rounded: '{rounded.compact}'
    padding: 2px 8px
    height: 24px
  surface:
    backgroundColor: '{colors.graphite}'
    textColor: '{colors.ink}'
    rounded: '{rounded.radius}'
    padding: 24px
  activity-table:
    backgroundColor: '{colors.graphite}'
    textColor: '{colors.ink}'
    typography: '{typography.data}'
    rounded: '{rounded.radius}'
    width: 100%
  circuit:
    backgroundColor: '{colors.void}'
    textColor: '{colors.ink}'
    height: 360px
    width: 100%
  session:
    backgroundColor: '{colors.lavender}'
    textColor: '{colors.ink}'
    rounded: '{rounded.radius}'
    padding: 24px
  service:
    backgroundColor: '{colors.butter}'
    textColor: '{colors.ink}'
    rounded: '{rounded.radius}'
    padding: 24px
  service-json:
    backgroundColor: '{colors.soft-mint}'
    textColor: '{colors.ink}'
    rounded: '{rounded.radius}'
    padding: 24px
---

# Design System: emeter

## Overview

**Creative North Star: "The bounded workspace"**

A light, framed instrument for a bounded decision. Periwinkle surrounds a rounded white application frame; the cool working ground gives lavender sessions and mint/yellow service surfaces room to read. Violet identifies actions and active signals. Green confirms successful states, yellow carries exceptional context, and rose makes denials visible. Dark Geist text keeps permissions, limits, and evidence readable.

The workspace combines persistent navigation with adjacent task context: credit totals, bounded sessions, editors, and receipts form a measured reading order. The landing gives the same palette a broader headline and policy stage. The authored circuit mark, orthogonal wires, and actual eleven-NAND graph connect the identity to the mechanism. Motion follows state; phones, reduced-motion preferences, and graphics failures retain the usable SVG circuit.

This refresh records the implemented light sidebar direction selected by the user on 22 November 2026, replacing the earlier dark Electric precision/no-sidebar direction. Source values come from `apps/web/app/globals.css`, `apps/web/app/styles/landing.css`, `apps/web/app/layout.tsx`, and shared components. The fresh finish review inspected all 19 sidebar captures and found only the documentation drift repaired here; its application findings require no visual change. The matching fork evidence reports 18 passing browser checks. These are supplied application checks, not isolated rendering validation for the sidecar snippets. No approved image comp, QUALITY BAR card, catalog seed, or successful context/detector launcher is claimed. SVG and geometry supply the mark and circuit; no browser-shipping raster artwork was added.

**Key Characteristics:**

- A periwinkle surround, rounded white frame, and cool working ground.
- Violet controls and active signals; green success, yellow exceptions, and rose denials.
- Lavender sessions and mint/yellow service surfaces that group real task records.
- Self-hosted Geist Sans for instructions and Geist Mono for measurable evidence.
- Persistent desktop sidebar and an accessible phone icon rail.
- An actual circuit graph with explicit source, mask, decision, and SVG fallback.

## Colors

The palette pairs cool, pale surfaces with dark readable text and a focused violet action color. Frontmatter preserves the current CSS custom-property names and canonical source values. Several names are historical aliases: `mint` now denotes violet controls, `mint-hover` denotes deeper violet, and `mint-surface` denotes the pale violet active-navigation surface. `void` is the cool working ground and `graphite` is white. Do not infer hue or luminance from those legacy names. Sidecar tonal ramps are synthesized panel metadata, not shipped CSS scales.

### Primary

- **Action Violet** (`mint`): primary buttons, links, focus, selection, caret, selected controls, wordmark detail, and active circuit signals.
- **Deeper Violet** (`mint-hover`): enabled primary-action hover fill and border.
- **Selected Violet Surface** (`mint-surface`): selected navigation and pressed circuit controls; not successful feedback.
- **Session Lavender** (`lavender`): session panels, wallet gates, the first summary tile, and inactive SVG/3D circuit nodes.

### Secondary

- **Service Mint** (`soft-mint`): JSON service cards and the second summary tile.
- **Success Green** (`success`): ready network dot, allowed policy output, successful feedback, and confirmed or verified badges.
- **Success Mint Surface** (`success-surface`): successful feedback and the shared `badge-mint` variant. The badge variant name is also a legacy alias; its green colors come from the success tokens.
- **Service Yellow** (`butter`): AI service cards and the third summary tile.
- **Exception Ochre** (`lime`): customer override labels and exceptional context, including unresolved work and local-fork evidence.
- **Exception Yellow Surface** (`lime-surface`): pending recovery, one-time credential notices, and exceptional-context badges.

### Tertiary

- **Denial Rose** (`red`): denied policy output, errors, and destructive controls.
- **Rose Surface** (`red-surface`): destructive buttons, error feedback, denial badges, and the fourth summary tile.

### Neutral

- **Periwinkle Surround** (`canvas`): the page outside the application and landing frames.
- **Cool Working Ground** (`void`): main workspace, landing, fields, and circuit stage; light text on violet buttons.
- **Frame White** (`graphite`): header, sidebar, secondary buttons, ordinary containers, table surface, and active SVG gate lettering.
- **Pale Raised Lavender** (`raised`): secondary/quiet control hover.
- **Quiet Lavender Line** (`line`): tables, sections, and container boundaries.
- **Strong Lavender Line** (`line-strong`): fields, secondary controls, neutral badges, scrollbars, and inactive SVG wires.
- **Charcoal Ink** (`ink`): headings, labels, values, and primary reading text.
- **Muted Plum** (`muted`): descriptions, ordinary navigation, and secondary actions.
- **Support Plum** (`dim`): hints, metadata, captions, and table headings.

Contextual secondary copy on mint, yellow, and rose task surfaces uses the observed literals (`#426e56`, `#75633b`, and `#80546b`). The 3D circuit additionally uses drawing-specific wire, port, and lettering colors (`#b4a7ca`, `#a595ba`, and `#45335f`); these are figure materials, not an expanded general UI palette.

**The Decision Color Rule.** Pair every semantic color with its text label. Violet identifies an action or active signal; green identifies successful state; yellow marks exceptional context; rose states a denial, error, or destructive action. A pastel task surface groups a record and does not certify its payment.

**The Readable Neutral Rule.** Keep task titles and values in Ink, explanations in Muted, and auxiliary labels in Dim. Use the observed contextual dark copy on pastel task surfaces rather than dimming labels through opacity.

## Typography

**Display Font:** self-hosted Geist Sans, loaded through `geist/font/sans`, with a sans-serif fallback.
**Body Font:** the same Geist Sans variable family.
**Label/Mono Font:** self-hosted Geist Mono, loaded through `geist/font/mono`, with a monospace fallback.

**Character:** one clean Sans voice handles instruction and hierarchy. Mono gives identifiers, JSON, masks, and exact amounts a stable measured texture. Both families are local assets supplied by the installed Geist package. The light redesign retains the existing type roles.

### Hierarchy

- **Display** (`display`): the landing headline, tightly tracked and balanced. Its desktop clamp becomes (62px) at or below (1100px), (72px) at or below (800px), and (54px) at or below (520px).
- **Headline** (`headline`): workspace page titles, reduced to (30px) at or below (520px).
- **Title / Subtitle** (`title`, `subtitle`): section headings and task detail. Quick-service headings use (21px); the landing proof heading uses (39px), then (32px) at or below (800px). These contextual values are not the default workspace title.
- **Body / Hero Body** (`body`, `hero-body`): instructions and landing introduction. Paragraphs are capped at (72ch), page descriptions at (65ch), and the landing introduction at (42ch) on desktop. The phone introduction becomes (15px).
- **Label / Support** (`label`, `support`): sentence-case form labels and subordinate hints.
- **Button / Navigation / Badge** (`button`, `navigation`, `badge`): distinct compact roles with their actual weights and leading. Active navigation uses (550) weight.
- **Data / Code / Metric** (`data`, `code`, `metric`): tables, wrapped code, and prominent exact amounts. Metrics become (24px) at or below (520px); Mono elements use tabular numerals.

**The Measured Data Rule.** Use Geist Mono with tabular numerals for code, masks, identifiers, and token amounts. Keep prose and control labels in Geist Sans. Preserve exact displayed amounts rather than converting them to approximate floating-point summaries.

## Layout

The declared spacing rhythm runs from `space-1` through `space-8` in frontmatter. Contextual insets (18px, 20px, 30px, 34px) and section spacing (40px) come from their actual components; they are not a second fabricated scale.

The desktop workspace is a centered frame capped at (1300px), with width `calc(100% - 48px)`, margin (24px auto), and minimum height `calc(100dvh - 48px)`. A header spans the frame above a (208px) sidebar and flexible main region. The header has a minimum height (88px), insets (22px 30px), and wraps the wordmark, workspace identity, network, and wallet controls. The main region uses insets (34px 30px); its footer uses (20px 30px). The sidebar has insets (26px 18px), stays sticky at (24px), and uses `min(650px, calc(100dvh - 145px))` as its minimum height.

At or below (1100px), the sidebar becomes (180px), main insets become (32px 24px), and header/footer side insets become (24px). Summary tiles become two columns, service cards become one column, and the dashboard's adjacent session/service columns stack. At or below (800px), the frame width becomes `calc(100% - 32px)` with (16px auto) margin; navigation becomes a (62px) icon rail, sticky at (16px). The sidebar heading, footer message, and workspace identity hide, while destination names remain accessible. The header uses a minimum height (72px) and insets (14px 20px); main insets become (30px 20px). Editors and policy evidence stack; policy inputs use two columns.

At or below (520px), the frame width becomes `calc(100% - 20px)` with (10px auto) margin and a (56px) rail. Rail insets become (18px 5px), main insets become (24px 15px), and footer insets become (18px 15px). Account controls occupy a full-width wrapped row. Summaries retain two columns, while form fields, policy inputs, service content, and evidence labels stack. Session insets become (18px), and service actions fill their available row. At widths of (1600px) or more, main insets become (40px); the frame remains capped at its established width.

The landing uses a centered framed surface capped at (1400px), initially matching the outer margin and width formula. Side insets reduce from (56px) through (36px), (24px), and (20px). Its headline/circuit columns stack at or below (800px); the three-step sequence and proof columns stack at or below (520px). These dimensions describe the landing expression, not every future page.

Activity tables retain their columns inside a keyboard-focusable horizontal scroll region. Long hashes wrap or have copy controls; the receipt inspector keeps full identifiers available. Dialogs are capped at (600px) wide and (90dvh) high with internal scrolling.

**The Task Adjacency Rule.** Keep actions next to the record or limit they change: session controls beside session balances, run controls after budget context, and receipt links beside the request. Reflow that relationship when columns stack.

## Elevation & Depth

Resting content uses white and pastel tonal layers with fine borders. Ordinary cards, tables, badges, and buttons have no drop shadow. The outer application/landing frame uses one diffuse periwinkle shadow; wallet popovers and modal content use soft plum shadows for temporary layers. The native dialog backdrop uses the observed translucent plum (`#4e466459`). The actual 3D circuit supplies the authored dimensional moment.

### Shadow Vocabulary

- **Application frame** (`0 12px 36px #596fbd20`): the workspace and landing against the periwinkle surround.
- **Wallet overlay** (`0 12px 32px #51456d26`): the temporary account popover.
- **Modal overlay** (`0 20px 64px #51456d26`): native dialog content above the dimmed page.

**The Tonal Surface Rule.** Group resting task content with the observed white or pastel layer and a fine boundary where present. Keep diffuse shadows on the outer frame and temporary overlays.

## Shapes

The default surface corner is softly rounded (12px); compact controls and navigation use (7px), badges and SVG gates use (4px), dialogs use (16px), and the outer frame uses (18px), reduced to (14px) on phones. The main working area retains its bottom-right (18px) corner. Service icon plates use (9px) corners. Controls retain fine strokes rather than adopting a pill silhouette. Status dots are small circles. The square-ended SVG mark and the circuit's rectangular gates use connected, orthogonal geometry; the dot grid is drawing material within the figure.

**The Diagram Form Rule.** Gate shapes and wires must come from the actual netlist. They explain a decision; their geometry is not a generic card decoration.

## Components

### Buttons

Compact and deliberate. Primary buttons pair Action Violet with Cool Working Ground text; secondary buttons pair Frame White with Ink and a Strong Line border. Quiet buttons use Muted text and a transparent fill. Danger buttons pair Denial Rose with Rose Surface and the observed rose border (`#dbb5c5`).

Frontmatter records default padding and minimum single-line height (42px). Enabled primary hover uses Deeper Violet; secondary hover uses Pale Raised Lavender with a Muted stroke; quiet hover uses Ink on Pale Raised Lavender; danger hover deepens its fill (`#f5d3e0`). Fill/border transitions last (160ms) with the recorded ease-out curve. Visible focus uses a Violet outline (2px), offset by (4px). Disabled buttons reduce opacity to (0.55) and show a not-allowed cursor. Landing actions and compact session controls retain their own observed dimensions.

### Chips

Status badges are compact rectangles with explicit words. Neutral, successful, exceptional, and denied states use separate text/background pairs; green success borders use (`#b5d8c2`), yellow exception borders use (`#ded19f`), and rose denial borders use (`#dbb5c5`). The legacy `badge-mint` variant is green success, not Action Violet. Execution status and payment status remain separate labels.

### Cards / Containers

White surfaces use the default radius and Quiet Line border with standard insets (24px). Sessions and wallet gates use Session Lavender. JSON service cards use Service Mint; AI service cards use Service Yellow. Summary tiles repeat lavender, mint, yellow, and rose in their existing order, with contextual dark secondary copy. These panels group actual records; no sample balances or requests replace account data. The dashboard keeps sessions beside the live service catalog when space permits. Tables and editors share the fine edge language. Ordinary cards have no resting shadow.

### Inputs / Fields

Cool Working Ground fields with Ink text, Strong Line strokes, and the smaller control radius. Hover lightens the stroke to Muted. Focus replaces the visible stroke with a Violet outline (2px), offset by (2px). Placeholders use Support Plum and the caret uses Violet. Errors have a separate Rose message rather than only a changed border. Disabled controls retain their labels and not-allowed cursor. Hints are programmatically associated with their fields.

JSON editors keep a white toolbar, Mono textarea, larger inset (20px), minimum height (250px), and wrapped content. Their focus outline sits inside the editor edge.

### Navigation

A persistent white desktop sidebar carries Overview, Services, Playground, Receipts, and Policy explorer, using consistent inline SVG icons and text. Vertical links have a minimum height (44px), inset (11px 12px), gap (11px), and (7px) corners. Default text is Muted; hover uses Ink on white. The active destination uses Violet on Selected Violet Surface, a transparent border, (550) weight, and `aria-current="page"`; its hover preserves that treatment.

At or below (800px), the sidebar becomes an icon rail. Each link keeps at least a (44px) target and an (18px) icon; its visible label becomes visually hidden, while `aria-label`, title, and the label text preserve the destination name. Link insets become (12px), then (11px) at or below (520px). The rail remains vertical; it is not a horizontal navigation band. Service/policy view switches retain transparent text buttons with a Violet underline for the pressed state.

### Dialogs and Feedback

Native dialogs preserve focus handling, Escape/backdrop dismissal when idle, an explicitly labeled close action, and internal scroll. Active wallet operations disable dismissal. Errors use Rose feedback with an alert role; notices use Success Green/Mint; progress includes status text and a spinner. Pending recovery and one-time credential display use Exception Yellow with explicit context and actions.

### Activity and Receipt Evidence

Compact tables align exact amounts with tabular Mono numerals and keep execution, payment, amount, and time in separate columns. Their white surface and fine boundaries carry the reading order; links change to Violet on hover. Receipt details retain label/value rows, copy controls, wrapped signed JSON, price versions, and independently checked settlement evidence.

**The Evidence Label Rule.** A ready result, a checked provider signature, and a canonical payment remain separate visible statements. Gateway-recorded circuit inputs stay labeled unconfirmed until their settlement is independently verified. Local-fork transactions and controlled offline AI output keep their explicit context labels.

### Payment Circuit

The SVG and React Three Fiber views share the real six-input, eleven-NAND topology for `A ∧ B ∧ C ∧ D ∧ (E ∨ F)`. Active nodes/wires are Violet; inactive nodes are Lavender. The SVG uses Strong Line inactive wires and white active lettering; the 3D view uses its drawing-specific materials. The default stage is (360px), reduced to (300px) at or below (800px) and (235px) at or below (520px); the landing's intermediate stage is (330px). Source captions, hexadecimal/binary masks, named inputs, formula, and explicit allowed/denied output remain the reading surface.

The scene is loaded only above (800px) when motion preference and WebGL2 availability permit. It fits an orthographic camera to the available stage, renders on demand, and uses damping (9) for a small state-driven tilt. SVG stays available until graphics readiness and on context loss/failure. Policy output transitions between Success Green and Denial Rose over (220ms). CSS motion reduces to (0.01ms) under reduced-motion preference, and that preference selects SVG.

**The State Motion Rule.** Motion follows the policy state. Keep the diagram, captions, condition labels, and explicit output usable when the graphics layer is absent.

## Do's and Don'ts

### Do:

- **Do** preserve the light palette, rounded frame, pastel task surfaces, font roles, and exact control states when extending a surface.
- **Do** keep amounts and identifiers measurable with Mono, tabular numerals, full-value access, and explicit units.
- **Do** pair semantic colors with readable state labels and keep result, signature, and payment evidence separate.
- **Do** preserve the actual circuit topology, source caption, input mask, explicit decision text, and SVG fallback.
- **Do** follow the sidebar-to-icon-rail reflow, preserve accessible destination names and navigation targets of at least (44px), and keep tables inside their focusable scroll region.
- **Do** preserve labels, visible Violet focus, associated hints, native dialog behavior, and recoverable empty or offline states.

### Don't:

- **Don't** reuse a confirmed-payment label for a result, provider claim, pending transaction, or preview inputs.
- **Don't** replace real account or service records with the concept preview's example balances or activity.
- **Don't** infer green success from the legacy `mint` control token or use its Violet value for successful badges.
- **Don't** turn the landing composition into a required workspace layout.
- **Don't** replace the authored circuit with an unrelated decorative graph or apply internal gate-label dimensions to general UI text.
- **Don't** make an unlabeled color or WebGL layer the only way to understand a payment decision.
- **Don't** add resting card shadows to the recorded tonal task surfaces.
