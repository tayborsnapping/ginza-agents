# Ginza Marketplace — Brand Reference

> This file lives at `brand/BRAND.md` and is the single source of truth for all
> agents that produce branded output (dashboard UI, notifications, reports,
> and future CMO content agents).

---

## 1. Colors

### Primary Palette (60% of any composition)

| Name   | HEX       | RGB             | Role                                    |
|--------|-----------|-----------------|-----------------------------------------|
| White  | `#F8F8F8` | 248 / 248 / 248 | Light backgrounds, clean space          |
| Black  | `#111111` | 17 / 17 / 17    | Primary text, dark backgrounds          |
| Orange | `#FF9A28` | 255 / 154 / 40  | Brand signature, primary accent, CTAs   |
| Silver | `#D4D4D4` | 212 / 212 / 212 | Secondary backgrounds, subtle dividers  |

### Secondary Palette (40% of any composition)

| Name  | HEX       | RGB             | Role                                       |
|-------|-----------|-----------------|--------------------------------------------|
| Gold  | `#F2B705` | 242 / 183 / 5   | Premium indicators, highlights             |
| Sky   | `#0378A6` | 3 / 120 / 166   | Links, info states, cool accents           |
| Grass | `#2C4001` | 44 / 64 / 1     | Nature/organic accents, subtle depth       |
| Tori  | `#AB2121` | 171 / 33 / 33   | Urgency, alerts, errors, danger states     |

### Dashboard Status Colors

Map brand colors to the CEO Dashboard color-coding system:

| Status         | Color  | HEX       | Use                              |
|----------------|--------|-----------|----------------------------------|
| On Target      | Green  | `#2C4001` | Grass — metrics within goal      |
| Watch          | Yellow | `#F2B705` | Gold — metrics drifting          |
| Action Required| Red    | `#AB2121` | Tori — metrics need intervention |
| Neutral / Info | Blue   | `#0378A6` | Sky — informational highlights   |

### Approved Pairings

When combining colors, use only these tested combinations:

- **Black + White + Orange** — the core trio, default choice
- **Black background:** White text, Orange accents, Gold highlights
- **White background:** Black text, Orange accents, Sky links
- **Tori (red):** pair with Grass, Gold, Orange, or Black
- **Sky (blue):** pair with Grass, Gold, Orange, or Black
- **Silver:** pair with Gold or Orange only

**Do not use:** Daruma avatar orange (`#F87800`) — that color is specific to the
ops avatar asset, not the brand palette. Always use `#FF9A28`.

---

## 2. Typography

### Font Stack

| Purpose       | Font      | Weight    | Fallback Stack                          |
|---------------|-----------|-----------|-----------------------------------------|
| Headlines     | New Order | Bold      | `'New Order', system-ui, sans-serif`    |
| Body / UI     | Inter     | Regular   | `'Inter', system-ui, sans-serif`        |
| Subheads      | Inter     | Bold      | `'Inter', system-ui, sans-serif`        |
| Monospace/Data| —         | —         | `'JetBrains Mono', 'Fira Code', monospace` |

### Sizing Scale (Dashboard Context)

| Element              | Font       | Size   | Weight   |
|----------------------|------------|--------|----------|
| Page title           | New Order  | 28–32px| Bold     |
| Section header       | New Order  | 20–24px| Bold     |
| Card title / label   | Inter      | 14–16px| SemiBold |
| Body text            | Inter      | 14px   | Regular  |
| Small / caption      | Inter      | 12px   | Regular  |
| Data / numbers       | Monospace  | 14px   | Regular  |

### Rules

- New Order is **headlines only** — never use it for body text or subheads.
- All text is sentence case (not ALLCAPS, not Title Case for body).
- Dashboard metrics and monetary values use monospace for alignment.

### Font Files

Located in `brand/fonts/`:
- `New Order *.otf` (Light, Regular, Medium, SemiBold, Bold)
- `Inter-*.otf` (full weight range, Thin through Black + italics)

For the dashboard web build, convert to WOFF2 or load Inter from Google Fonts
and self-host New Order.

---

## 3. Logo

### Files

Located in `brand/logos/`:
- `Black.svg` — black on transparent (light backgrounds)
- `White.svg` — white on transparent (dark backgrounds)
- `Vertical.svg` — stacked layout
- `Vertical White_1.svg` — stacked layout, white

### Usage

- **Dashboard header:** Use `White.svg` on the dark sidebar/navbar.
- **Reports / exports:** Use `Black.svg` on white backgrounds.
- **Minimum size:** 20px height on screen.
- **Clear space:** At least 1× the height of the kanji 銀 element around all sides.

### Don'ts

Do not stretch, rotate, outline, shadow, pattern-fill, or recolor the logo.
Only use Black or White versions on their approved background colors.

---

## 4. Dashboard Design Direction

The Mission Control Dashboard (CTO-03) blends two aesthetics:

**Clean / Premium** — matching Ginza's upscale 3rd-space retail positioning.
Think: generous whitespace, crisp type hierarchy, deliberate use of Orange as
the signature accent against dark surfaces. The dashboard should feel like it
belongs to the same brand as the physical store.

**Dark Mode / Command Center** — a monitoring tool that feels alive. Dark
`#111111` base with `#F8F8F8` text. Status colors (Grass/Gold/Tori) for
at-a-glance health. Orange pulsing gently on active elements. Data-dense but
never cluttered.

### Component Framework

shadcn/ui with Tailwind CSS. Override shadcn defaults with brand tokens:

```
--background:     #111111   (Black)
--foreground:     #F8F8F8   (White)
--primary:        #FF9A28   (Orange)
--primary-foreground: #111111
--secondary:      #D4D4D4   (Silver)
--accent:         #F2B705   (Gold)
--destructive:    #AB2121   (Tori)
--muted:          #1a1a1a   (slightly lighter than Black)
--muted-foreground: #a0a0a0
--border:         #2a2a2a
--ring:           #FF9A28   (Orange focus rings)
```

### Layout Principles

- Sidebar navigation (dark, logo at top)
- Main content area with card-based layout
- Cards have subtle borders (`--border`) not heavy shadows
- Status indicators use the 3-color system (Green/Yellow/Red → Grass/Gold/Tori)
- Agent health shown as colored dots or badges, not traffic lights
- Monospace font for all numeric data (revenue, margins, token counts)
- Orange reserved for: primary actions, the brand logo, active nav items

---

## 5. Brand Voice (Condensed)

For Phase 3 CMO agents that produce customer-facing content.

### Persona

The smart, witty professor at a dinner party. Deep knowledge of TCGs and
Japanese culture. Captivates through stories and insights, not info-dumps.
Meets people where they're at — never talks down to beginners, never bores
experts.

### Tone Scale

| Dimension   | Level | Guideline                                         |
|-------------|-------|----------------------------------------------------|
| Humor       | 6/10  | Witty, clever. Puns and analogies. Never sarcastic. |
| Formality   | 7/10  | Polished, not corporate. Active voice. Concise.     |
| Respect     | 8/10  | Always dignified and welcoming.                     |
| Enthusiasm  | 6/10  | Warm, genuine. Strategic excitement, not noise.     |

### Do

- Use clean, efficient language
- Project reliability and deep expertise
- Write so beginners and experts both feel spoken to
- Be concise — say more with less

### Don't

- Use generic filler ("Check it out!", "You won't want to miss this!")
- Sound like every other card shop on the internet
- Use excessive emojis or all-caps
- Make claims you can't back up
- Use slang

### SEO (Shopify Descriptions)

All product descriptions must naturally incorporate: product name, TCG/game
name, set name, language, product type, and terms collectors search for.
Front-load important keywords in titles. Never stuff keywords at the expense
of readability.

---

## 6. Audience Segments

When any agent produces customer-facing content, consider which segment it
targets and adjust depth/tone:

| Segment             | Profile                                      | Tone Adjustment         |
|---------------------|----------------------------------------------|--------------------------|
| Casual Collectors   | Parents, gift buyers, new to hobby           | Approachable, educational|
| Serious Collectors  | High-disposable-income completionists        | Expert, reliable         |
| Competitive Players | Gameplay-focused, tournament regulars        | Technical, community     |
| Goal-Oriented       | Investors, content creators, resellers       | Peer-level, data-driven  |

---

## 7. Quick Reference for Agents

```
LOGO:       brand/logos/White.svg (dark bg) | brand/logos/Black.svg (light bg)
HEADLINE:   New Order Bold
BODY:       Inter Regular
ACCENT:     #FF9A28 (Orange)
TEXT DARK:   #111111 (Black)
TEXT LIGHT:  #F8F8F8 (White)
BG DARK:    #111111
BG LIGHT:   #F8F8F8
SUCCESS:    #2C4001 (Grass)
WARNING:    #F2B705 (Gold)
DANGER:     #AB2121 (Tori)
INFO:       #0378A6 (Sky)
DIVIDER:    #D4D4D4 (Silver)
```
