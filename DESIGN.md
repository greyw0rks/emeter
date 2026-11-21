---
name: "emeter"
description: "Electric precision for bounded API payments and inspectable evidence."
colors:
  void: "#080c0d"
  graphite: "#111719"
  raised: "#192225"
  line: "#2c393d"
  line-strong: "#4c6268"
  ink: "#f1f6f3"
  muted: "#afbfbe"
  dim: "#8faaa8"
  mint: "#63efb7"
  lime: "#d5f879"
  red: "#ffaaa0"
  mint-surface: "#142e24"
  lime-surface: "#292e1a"
  red-surface: "#34201f"
  mint-hover: "#8af7cb"
typography:
  display:
    fontFamily: "var(--font-geist-sans), sans-serif"
    fontSize: "clamp(54px, 5.4vw, 86px)"
    fontWeight: 540
    lineHeight: 1.05
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "var(--font-geist-sans), sans-serif"
    fontSize: "36px"
    fontWeight: 560
    lineHeight: 1.15
    letterSpacing: "-0.035em"
  title:
    fontFamily: "var(--font-geist-sans), sans-serif"
    fontSize: "20px"
    fontWeight: 560
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  subtitle:
    fontFamily: "var(--font-geist-sans), sans-serif"
    fontSize: "16px"
    fontWeight: 560
    lineHeight: 1.4
  body:
    fontFamily: "var(--font-geist-sans), sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  hero-body:
    fontFamily: "var(--font-geist-sans), sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "var(--font-geist-sans), sans-serif"
    fontSize: "12px"
    fontWeight: 550
    lineHeight: 1.6
  support:
    fontFamily: "var(--font-geist-sans), sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.6
  button:
    fontFamily: "var(--font-geist-sans), sans-serif"
    fontSize: "13px"
    fontWeight: 560
    lineHeight: 1.4
  navigation:
    fontFamily: "var(--font-geist-sans), sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.6
  badge:
    fontFamily: "var(--font-geist-sans), sans-serif"
    fontSize: "10px"
    fontWeight: 500
    lineHeight: 1.5
  data:
    fontFamily: "var(--font-geist-sans), sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.6
  code:
    fontFamily: "var(--font-geist-mono), monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.75
  metric:
    fontFamily: "var(--font-geist-mono), monospace"
    fontSize: "27px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "-0.025em"
rounded:
  radius: "8px"
  radius-sm: "5px"
  compact: "4px"
spacing:
  space-1: "4px"
  space-2: "8px"
  space-3: "12px"
  space-4: "16px"
  space-5: "24px"
  space-6: "32px"
  space-7: "48px"
  space-8: "64px"
components:
  button-primary:
    backgroundColor: "{colors.mint}"
    textColor: "{colors.void}"
    typography: "{typography.button}"
    rounded: "{rounded.radius-sm}"
    padding: "10px 16px"
    height: "42px"
  button-primary-hover:
    backgroundColor: "{colors.mint-hover}"
    textColor: "{colors.void}"
  button-secondary:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.radius-sm}"
    padding: "10px 16px"
    height: "42px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    typography: "{typography.button}"
    rounded: "{rounded.radius-sm}"
    padding: "7px 9px"
    height: "42px"
  button-danger:
    backgroundColor: "{colors.red-surface}"
    textColor: "{colors.red}"
    typography: "{typography.button}"
    rounded: "{rounded.radius-sm}"
    padding: "10px 16px"
    height: "42px"
  input:
    backgroundColor: "{colors.void}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.radius-sm}"
    padding: "10px 12px"
  navigation:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    typography: "{typography.navigation}"
    rounded: "{rounded.radius-sm}"
    padding: "11px 13px"
  navigation-active:
    backgroundColor: "{colors.mint-surface}"
    textColor: "{colors.mint}"
  badge-neutral:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.muted}"
    typography: "{typography.badge}"
    rounded: "{rounded.compact}"
    padding: "2px 8px"
    height: "24px"
  badge-mint:
    backgroundColor: "{colors.mint-surface}"
    textColor: "{colors.mint}"
    typography: "{typography.badge}"
    rounded: "{rounded.compact}"
    padding: "2px 8px"
    height: "24px"
  badge-lime:
    backgroundColor: "{colors.lime-surface}"
    textColor: "{colors.lime}"
    typography: "{typography.badge}"
    rounded: "{rounded.compact}"
    padding: "2px 8px"
    height: "24px"
  badge-red:
    backgroundColor: "{colors.red-surface}"
    textColor: "{colors.red}"
    typography: "{typography.badge}"
    rounded: "{rounded.compact}"
    padding: "2px 8px"
    height: "24px"
  surface:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.ink}"
    rounded: "{rounded.radius}"
    padding: "24px"
  activity-table:
    backgroundColor: "{colors.void}"
    textColor: "{colors.ink}"
    typography: "{typography.data}"
    rounded: "{rounded.radius}"
    width: "100%"
  circuit:
    backgroundColor: "{colors.void}"
    textColor: "{colors.ink}"
    height: "360px"
    width: "100%"
---

# Design System: emeter

## Overview

**Creative North Star: "Electric precision"**

A dark instrument for a bounded decision. Void grounds the interface, Graphite gives controls a quiet working surface, and bright Geist text keeps permissions and evidence readable. Electric Mint identifies the next action and the active signal; Signal Lime makes exceptions visible. The authored circuit mark, orthogonal wires, and actual eleven-NAND graph connect the identity to the mechanism the product exposes.

The landing brief gives the policy a broad stage and a large, tightly tracked headline. The workspace brief gives tasks more room than decoration: credit totals, bounded sessions, editors, and evidence form a measured reading order. These are two expressions of the same world; their compositions remain in the surface briefs. Motion is brief and driven by state, while phones, reduced-motion preferences, and graphics failures retain the authored SVG circuit.

This system records the current frontend source and sampled desktop/phone captures. Electric precision is the accepted visual-world pin; both layouts are builder-authored within the accepted frontend scope. The finish review reports SHIP after opening all nineteen required captures, using a generic fresh agent with the packaged review contract. No approved comp, QUALITY BAR card, catalog seed, or successful detector/context/seed launcher is claimed. The shipped mark and circuit use SVG and geometry; there are no browser-shipping raster plates. Implementation values below come from `apps/web/app/globals.css`, `apps/web/app/styles/landing.css`, `apps/web/app/layout.tsx`, and the shared components.

**Key Characteristics:**

- Dark neutral layers with readable, slightly cool text.
- Mint actions and active signals; Lime exceptions; Red denials and destructive intent.
- Self-hosted Geist Sans for instructions and Geist Mono for measurable evidence.
- Compact controls, fine borders, and shallow corners.
- An actual circuit graph with explicit source, mask, and payment output.
- Responsive task layouts and a usable SVG fallback.

## Colors

The palette combines cool, near-black neutrals with bright semantic signals. The frontmatter preserves the CSS custom-property names and canonical hex values; `mint-hover` captures the reused primary hover color. The sidecar’s tonal strips are synthesized panel metadata, not additional shipped color scales.

### Primary

- **Electric Mint** (`mint`): primary buttons, actionable links, focus, selection, caret, active circuit signals, and verified or successful state text.
- **Mint Hover** (`mint-hover`): the brighter fill and border of an enabled primary action on hover.
- **Mint Signal Surface** (`mint-surface`): a quiet background for selected navigation, successful feedback, and Mint status badges.

### Secondary

- **Signal Lime** (`lime`): customer override labels and exceptional context, including unresolved work and local-fork evidence.
- **Lime Exception Surface** (`lime-surface`): pending recovery, one-time credential notices, and Lime badges.

### Tertiary

- **Soft Red** (`red`): denial, error messages, and destructive controls. It is a status color, not an additional decorative accent.
- **Red Error Surface** (`red-surface`): destructive buttons, error feedback, and Red badges.

### Neutral

- **Void** (`void`): page ground, input fields, and the circuit stage; also the dark text on Mint fills.
- **Graphite** (`graphite`): secondary controls, resting containers, table headings, and code output.
- **Raised Graphite** (`raised`): wallet popovers and hovered controls.
- **Quiet Line** (`line`): table rows, section boundaries, and container edges.
- **Strong Line** (`line-strong`): input strokes, secondary buttons, neutral badges, and scrollbar thumbs.
- **Bright Ink** (`ink`): headings, task labels, values, and primary reading text.
- **Muted Ink** (`muted`): descriptions, ordinary navigation, secondary actions, and evidence labels.
- **Auxiliary Ink** (`dim`): hints, metadata, captions, and table headings.

**The Decision Color Rule.** Use the signal color with its text label. Mint can mean an active signal or a checked result; the label must say which. Lime marks an exception or special context, and Red states a denial, error, or destructive action.

**The Readable Neutral Rule.** Keep task titles and values in Ink, explanations in Muted, and auxiliary labels in Dim. The reviewed secondary-text samples reached at least (7.31:1); this is sampled evidence, not a claim about every possible color pairing.

## Typography

**Display Font:** self-hosted Geist Sans, loaded through `geist/font/sans`, with a sans-serif fallback.
**Body Font:** the same Geist Sans variable family.
**Label/Mono Font:** self-hosted Geist Mono, loaded through `geist/font/mono`, with a monospace fallback.

**Character:** one clean Sans voice handles instruction and hierarchy. Mono gives identifiers, JSON, masks, and exact amounts a stable measured texture. Both families are local font assets supplied by the installed Geist package.

### Hierarchy

- **Display** (`display`): the landing headline, tightly tracked and balanced. Its desktop clamp is overridden at the existing responsive widths: (62px) below (1100px), (72px) below (800px), and (54px) below (520px).
- **Headline** (`headline`): workspace page titles, reduced to (30px) below (520px).
- **Title / Subtitle** (`title`, `subtitle`): section headings and the next level of task detail. The landing proof heading has its own observed larger treatment (39px, then 32px below 800px); it is not the default workspace title.
- **Body / Hero Body** (`body`, `hero-body`): ordinary instructions and the landing introduction. Paragraphs are capped at (72ch), page descriptions at (65ch), and the landing introduction at (42ch) on desktop. The phone introduction becomes (15px).
- **Label / Support** (`label`, `support`): form labels and subordinate hints. Labels remain sentence case.
- **Button / Navigation / Badge** (`button`, `navigation`, `badge`): separate compact roles with their actual weight and leading, rather than one generic label style.
- **Data / Code / Metric** (`data`, `code`, `metric`): compact tables, wrapped code blocks, and prominent exact amounts. Metric text becomes (24px) below (520px). Code and Mono elements use tabular numerals.

**The Measured Data Rule.** Use Geist Mono with tabular numerals for code, masks, identifiers, and token amounts. Keep prose and control labels in Geist Sans. Preserve exact displayed amounts rather than converting them to approximate floating-point summaries.

## Layout

The declared spacing rhythm runs from `space-1` through `space-8` in the frontmatter. The implementation also uses repeated contextual insets (20px) and workspace section spacing (40px); these belong to the observed layouts rather than a second invented spacing scale.

The landing container is centered with a maximum width (1520px) and side insets (56px). A two-column headline/circuit composition becomes one column below (800px); the three-step sequence and proof columns stack below (520px). Side insets reduce through (36px), (24px), and (20px). These dimensions describe the current landing expression, not every future page.

The workspace has a sticky navigation rail (224px), an account header with a minimum height (84px), and a content area capped at (1500px) with insets (40px). Below (1100px) the rail narrows to (190px) and content insets become (32px 24px). Below (800px) navigation becomes a wrapping horizontal menu, content insets become (30px 20px), and split editors and policy evidence stack. Below (520px), summary totals use two columns, fields stack, and evidence labels sit above their values. Wide viewports above (1600px) increase workspace content insets to (48px 56px).

Activity tables retain their columns inside a keyboard-focusable horizontal scroll region. Long hashes wrap or have a copy affordance; the independent receipt inspector keeps full identifiers available. Dialogs are capped at (600px) wide and (90dvh) high, with internal scrolling.

**The Task Adjacency Rule.** Keep actions next to the record or limit they change: session controls beside session balances, run controls after budget context, and receipt links beside the request. Reflow that relationship when columns stack.

## Elevation & Depth

The system gets resting depth from Void, Graphite, Raised Graphite, and fine borders. Ordinary cards, tables, badges, and buttons have no drop shadow. Wallet popovers and modal content use soft black shadows to distinguish temporary layers; the native dialog backdrop dims the page (black at 67% opacity).

### Shadow Vocabulary

- **Wallet overlay** (`0 12px 32px #0006`): the account popover over the current workspace.
- **Modal overlay** (`0 20px 64px #0008`): the native dialog's Graphite content surface.

**The Tonal Surface Rule.** Use a tonal layer and a fine boundary for resting content. Reserve the observed soft shadows for temporary overlays.

## Shapes

The corner scale is shallow: the default surface corner, the smaller control corner, and the compact badge corner are recorded in `rounded`. Controls keep a one-pixel border and do not need a pill silhouette. Status dots are small circles, while the wordmark's square-ended SVG path and the circuit's rectangular gates use connected, orthogonal geometry. The circuit's dot grid is drawing material inside that figure.

**The Diagram Form Rule.** Gate shapes and wires must come from the actual netlist. They explain a decision; their geometry is not a generic card decoration.

## Components

### Buttons

Compact and deliberate. Primary buttons pair Mint with Void; secondary buttons pair Graphite with Ink and a Strong Line border. Quiet buttons use Muted text and a transparent fill. Danger buttons pair Red with the Red Error Surface and its darker border.

The frontmatter records default padding and single-line height. Enabled primary hover uses Mint Hover; secondary hover uses Raised Graphite with a Muted stroke; quiet hover uses Ink on Raised Graphite; danger hover deepens its error fill. Shared fill and border transitions last (160ms) with the recorded ease-out curve. Focus uses a Mint outline (2px) offset by (4px). Disabled buttons reduce opacity to (0.55) and show a not-allowed cursor. Landing actions and compact session actions deliberately use their own larger or smaller dimensions.

### Chips

Status badges are compact rectangles with explicit words, not unlabeled colored dots. Neutral, Mint, Lime, and Red each use the corresponding background and border treatment. The frontmatter records their compact radius, padding, type, and height. Execution status and payment status are separate badges; the same tone does not merge their meanings.

### Cards / Containers

Quiet Graphite surfaces use the default radius, a Quiet Line border, and the standard padded inset. Tables and editors share that edge language; sections, service rows, and summaries often use separators instead of enclosing every item in a card. Resting containers have no shadow.

### Inputs / Fields

Void fields with Bright Ink text, Strong Line strokes, and the smaller control radius. Pointer hover lightens the stroke to Muted. Focus replaces the visible stroke with a Mint outline (2px), offset by (2px). Placeholders use Auxiliary Ink, and the caret uses Mint. Errors have a separate Red message; they are not inferred only from a changed border. Disabled controls retain their labels and use the not-allowed cursor. Field hints are programmatically associated with their control.

JSON editors use the same container edge, a Graphite toolbar, and a Mono textarea with a larger inset (20px), a minimum height (250px), and wrapped content. Their focus outline sits inside the editor edge.

### Navigation

The workspace uses labeled SVG icons and compact links. Default text is Muted; hover uses Ink on Graphite. The active page at rest uses Mint on the Mint Signal Surface with a tinted border and `aria-current`. The existing hover treatment also applies to active links. On smaller screens the rail becomes a wrapping menu. Service and policy view switches use transparent text buttons with a Mint underline for the pressed state.

### Dialogs and Feedback

Native dialogs retain focus handling, Escape/backdrop dismissal when an operation is idle, an explicitly labeled close action, and internal scroll. An active wallet operation disables dismissal. Errors use Red feedback with an alert role; notices use Mint; work in progress has text and a spinner; pending transaction recovery uses the Lime Exception Surface and a check action. One-time credential display uses the same exceptional-context treatment.

### Activity and Receipt Evidence

Compact tables align amounts with tabular Mono numerals and keep execution, payment, amount, and time in distinct columns. Row hover adds Graphite; the request/service link changes to Mint. Full receipt details use label/value rows, copy controls, wrapped signed JSON, and a download action. Phone evidence rows stack their labels above their values.

**The Evidence Label Rule.** A ready result, a checked provider signature, and a canonical payment remain separate visible statements. Gateway-recorded circuit inputs stay labeled unconfirmed until their settlement is independently verified. Local-fork transactions and controlled offline AI output keep their explicit context labels.

### Payment Circuit

The signature figure renders the six inputs and eleven NAND gates from the shared circuit graph. The flat SVG and React Three Fiber view share node positions, wire topology, and computed signals. A source caption, hexadecimal/binary mask, readable condition descriptions on the policy page, and explicit Payment allowed/Payment denied text preserve comprehension.

Desktop graphics require a width of at least (801px), no reduced-motion preference, and a working WebGL2 context. The scene renders on demand and makes a short damped tilt after a decision change; it does not run an idle orbit. The payment output color transition lasts (220ms). Phones, reduced motion, errors, and lost graphics contexts show the SVG. CSS transitions and animations reduce to (0.01ms) under the preference. The stage is (360px) on desktop, with smaller observed stages (300px), (235px), and a landing tablet stage (330px).

**The State Motion Rule.** Motion follows the policy state. Keep the diagram, captions, condition labels, and explicit output usable when the graphics layer is absent.

## Do's and Don'ts

### Do:

- **Do** preserve the shared palette, font roles, shallow corners, and exact control states when extending a surface.
- **Do** keep amounts and identifiers measurable with Mono, tabular numerals, full-value access, and explicit units.
- **Do** pair semantic colors with readable state labels and keep result, signature, and payment evidence separate.
- **Do** preserve the actual circuit topology, source caption, input mask, explicit decision text, and SVG fallback.
- **Do** follow the existing responsive reflow and let activity tables scroll within their own focusable region.
- **Do** preserve labels, visible Mint focus, associated hints, native dialog behavior, and recoverable empty or offline states.

### Don't:

- **Don't** reuse a confirmed-payment label for a result, a provider claim, a pending transaction, or preview inputs.
- **Don't** turn the landing composition into a required workspace layout or the workspace rail into a global page template.
- **Don't** replace the authored circuit with an unrelated decorative graph or use tiny internal gate labels as the general UI type size.
- **Don't** make an unlabeled color or a WebGL layer the only way to understand the payment decision.
- **Don't** add resting card shadows to the recorded tonal surface system.
