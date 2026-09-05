# What the reef should look like

A tank somebody leaves open in another window. Dim, slow, luminous — an
aquarium in a quiet room rather than a diagram of one.

This is a direction and not a spec, but the parts that are load-bearing are
marked as such, because two of them are the difference between a decoration
and a thing a visitor can read.

## The one thing that makes it possible

**The renderer is outside the determinism rule.** The simulation may not call
a trigonometric function, because two machines can disagree in the last bits
and a shared replay link is a bet that they do not. The renderer computes
nothing the state hash sees, so it may use `Math.sin`, a clock, and a random
seed of its own.

Everything that makes water look like water — a frond swaying, a light band
drifting, a mote rising — comes out of that freedom. None of it can change
what happens; all of it changes what it feels like.

## The water

A vertical gradient, brighter at the top because light comes from above:
roughly `#0a2b39` up top falling to `#03101c` at the floor. Never flat.

Over that, three things, all of them very transparent and all of them slow:

- **Light bands.** Two or three wide diagonal shafts, a few percent opacity,
  sliding across over tens of seconds. This is most of the atmosphere and it
  is about fifteen lines.
- **Motes.** Sixty or so particles drifting up and sideways, sub-pixel slow,
  fading in and out. Seeded by the renderer, not the reef.
- **A vignette**, darkening the corners, so the eye goes to the middle.

No grid lines. There is no grid.

## The kelp

Not circles. Each bed is a clump of fronds — quadratic curves rooted along the
bed's lower edge, of varying height, swaying out of phase with each other on a
slow sine. Layered, semi-transparent, in a green that is nearly teal so it sits
in the water rather than on it.

**Load-bearing:** kelp is the only place on the reef where being still beats
being fast, and a hunter visibly declines to follow prey into it. If a visitor
cannot see at a glance where the kelp is, they cannot read the most dramatic
thing that happens here.

## The food

Soft radial blobs, pale green going to gold at the centre, edges fading to
nothing. Amount is radius and brightness together. A very slow pulse, out of
phase per patch, so the reef breathes.

A carcass — a morsel left where something died — should read differently:
warmer, redder, and it should arrive with a brief bloom rather than fade in.

## The creatures

A body and a tail, not a glyph. An ellipse for the body, oriented along
`facing`, and a tail that undulates on a sine whose **frequency and amplitude
follow `speed`**. A creature at rest barely moves; a fleeing one thrashes.

That is the cheapest signal an animal has and the grid version threw it away —
everything moved one cell per tick, so a creature running for its life was
animated exactly like one browsing.

Each species keeps a colour and a silhouette:

| | |
| --- | --- |
| Reef Grazer | a rounded body, soft green `#5fbf8f` |
| Kelp Hunter | a longer, leaner body with a forked tail, coral `#d4553c` |
| Shy Scavenger | small and round, trailing, violet `#8c7ab8` |
| Hermit Crab | squat, with a shell arc over it, amber `#e0b23c` |

Behind each, a soft radial glow in its own colour. That is where the
"luminous" comes from and it is what makes them read against dark water.

A **hidden** creature is inside kelp: draw it dimmer and let the fronds pass
over it, so it is visibly *in* the weed rather than merely marked as hidden.

## The perception, which is the point

Two things, and they are the reason any of this was worth rebuilding as a
continuous reef.

**The sight circle.** A creature's beliefs are its perception: a grazer that
ignores a hunter fifteen units away is not stupid, it cannot see that far, and
on the grid version that was invisible so it read as stupid. Draw the radius —
a very faint ring on everything, clear on whatever is selected. It is a circle,
which is a shape people have an intuition for. On a grid it was a diamond,
which is a shape nobody has an intuition for.

**The line to what it is reacting to.** The observation already says which
hunter a creature is fleeing and which mouthful it is heading for. A thin soft
line, coloured by the reason, turns "it moved left" into "it moved away from
**that**". Always for the selection; for everything else only when the reason
is `fleeing_threat` or `hunting`, because those are the two worth interrupting
somebody for and fourteen lines at once is a cobweb.

**Load-bearing, both.** Everything above this heading is atmosphere and can be
cut. These two are the product.

## Motion

- A short fading **trail** behind each creature, three or four seconds of path.
- Positions **interpolated** between ticks, as they already are. The
  simulation is three fixed ticks a second and the render is sixty frames; the
  visitor should never be able to tell where one tick ends.
- Nothing snaps. A creature turns because the reef makes it turn, and the
  drawing should never do in one frame what the reef did over four.

## What to resist

- Bright saturated backgrounds. The creatures glow because the water is dark.
- Drawing every creature's reaction line at once.
- Anything that pulses at a speed somebody would notice as a loop.
- Grid lines, cell borders, and anything else that says "simulation" rather
  than "aquarium".
