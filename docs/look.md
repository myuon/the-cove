# What the reef should look like

A drawing somebody leaves open in another window. Dim, slow, precise — line
work over near-black, and beautiful enough to watch without being told what it
is for.

This is a direction and not a spec, but the parts that are load-bearing are
marked as such, because they are the difference between a decoration and a
thing a visitor can read.

The first version of this document asked for a soft, luminous aquarium and got
one: blurred radial gradients over blurred radial gradients, everything in one
hue, and thirty patches of food winning the picture from ten animals. Soft over
soft is mush. What replaced it is below, and it is not a retreat from beauty —
it is where the beauty and the meaning turned out to be the same drawing.

## The one thing that makes it possible

**The renderer is outside the determinism rule.** The simulation may not call
a trigonometric function, because two machines can disagree in the last bits
and a shared replay link is a bet that they do not. The renderer computes
nothing the state hash sees, so it may use `Math.sin`, a clock, and a random
seed of its own.

Everything that makes water look like water — a frond swaying, a light band
drifting, a mote rising — comes out of that freedom. None of it can change
what happens; all of it changes what it feels like.

## The register

Line work over near-black. Nothing is a soft blob, because soft over soft is
mush and mush is what the first pass was: a blurred green picture in which the
food read as the animals and the animals read as punctuation.

The world *is* a field of forces and beliefs, so the honest way to draw it is
to draw the field rather than to illustrate the animals standing in it. What
that buys is that the most beautiful thing on the screen and the most
informative thing on the screen are the same thing.

## The field, which is the picture and also the product

A triangular lattice of short strokes. Quiet water is a faint, even weave
whose angle varies smoothly across the reef on a couple of sines and drifts
over half a minute — a slow current with eddies in it, never a ruling.

Wherever a creature can see, the strokes swing to lie **around** it —
perpendicular to the direction away, so they close into a whorl rather than
bursting out of one — and brighten, lengthen, and take **that creature's own
colour**. Two creatures watching the same water make a two-coloured
interference where their whorls meet.

That is a sight radius rendered as something rather than annotated. A circle
is a boundary somebody has to be told the meaning of; this is the water
visibly behaving differently inside one. Delete everything else in the
renderer and the reef would still say what it is about.

A triangular lattice and not a square one: a square grid of dots reads as
graph paper, because the eye finds the rows and columns immediately and then
stops looking.

### What it costs, and what cannot be measured from here

The field is the most expensive thing drawn — around nine hundred segments
over the whole canvas — so it is painted to its own canvas at twenty hertz and
blitted, because the weave drifts over tens of seconds and the whorls follow
creatures that move three times a second. Nothing in it changes at sixty.

Strokes are batched by a quantised colour and alpha rather than issued one per
point: six alpha levels is more than an eye resolves in a stroke this thin, and
it took the draw calls from six hundred and thirty a frame to a hundred and
sixty-eight.

**None of that was validated by a frame-rate measurement, and it could not
be.** Every number taken while building this came from a headless browser
whose `requestAnimationFrame` runs at about nine hertz on a *blank page* — so
the measurements were of the harness and not of the drawing, which is exactly
why one of them got worse when the draw calls got four times cheaper. The
optimisations above stand on being obviously less work rather than on
evidence, and the sixty-frame claim in the acceptance criteria is still
untested.

## The water

Near-black, with a faint vertical gradient. Light is a **hatch** — thin
parallel lines at a fixed angle, drifting, with a slow swell across the family
— and not a soft shaft. A soft shaft was tried and it is what made the picture
look blurred: there was nothing crisp anywhere for the eye to hold on to.

A vignette, and nothing else. No motes, no bloom.

## The kelp

A family of exactly-spaced blades inside a dashed circle, each swaying on its
own phase. Two readings of one drawing: it is a bed of weed, and it is a line
field.

**Load-bearing:** kelp is the only place on the reef where being still beats
being fast, and a hunter visibly declines to follow prey into it.

## The food

An asterisk, and the number of spokes rises with the amount. **Not** a ring:
rings are what creatures are, and thirty concentric circles scattered over a
reef of circular creatures is a picture nobody can read. Spokes have no
silhouette to confuse with a body.

A carcass arrives warm and red with one expanding ring, then settles.

## The creatures

One geometric mark each, outlined bright and filled faint, oriented along
`facing`, with a line out of the front whose length follows speed.

| | |
| --- | --- |
| Reef Grazer | a circle, mint `#4de0a8` |
| Kelp Hunter | a dart — the only mark with a point, for the only role that has one — coral `#ff5a48` |
| Shy Scavenger | a diamond, violet `#a98bff` |
| Hermit Crab | a hexagon, amber `#ffc44d` |

A drawn fish was tried first and it was the wrong register: an illustration of
an animal sitting on top of a diagram of a world. And it did not survive
contact with the reef — every species except the hunter read as a lollipop,
because a tail drawn as a stroked curve is a line and a tail is a shape.

A mark is honest about what this is, stays crisp at any zoom, and tells four
species apart by **shape** before any colour is read, which is what the
accessibility criterion wanted anyway.

## The perception, which is the point

The lattice does most of it. Two things say it precisely for whatever is
selected:

**The sight ring** — dashed, with ticks at the quarters, like an instrument.

**The line to what it is reacting to** — dashed, coloured by the reason, with a
small square on the far end. The square matters as much as the line: a line
alone reads as a connection between equals, and this is a creature attending to
a thing.

**Load-bearing, both.** Everything above is atmosphere and could be cut. These
are the product.

## Motion

- A short **trail** behind each creature: a row of shrinking marks, not a
  smear. A path made of marks can be counted; a smear can only be seen.
- The world runs at **one and a half fixed ticks a second**, which is slow on
  purpose and has been slowed twice. This is a thing to watch, not a thing to
  keep up with.
- Positions are **interpolated** between ticks and then **eased**. The
  interpolation is smooth inside a tick and corners at every boundary, because
  the drawn velocity changes the instant a new snapshot lands; slowing the
  world down does not fix that, it gives the same corner longer to be looked
  at. A low-pass on the drawn position, facing and speed rounds it off, with a
  half-life rather than a per-frame fraction so a slow machine and a fast one
  ease at the same rate in real time.
- It costs a little lag, and lag is free here. Nobody is steering anything.
- Nothing snaps. A creature turns because the reef makes it turn, and the
  drawing should never do in one frame what the reef did over four.

## What to resist

- **Softness.** A radial gradient is the easiest thing on a canvas to reach
  for and it is what made the first version dowdy. If something needs to be
  quiet, make it thinner or dimmer, not blurrier.
- **One hue.** The water is nearly monochrome so that the creatures can own
  every bit of colour on the reef. Four saturated accents against near-black,
  and nothing else coloured.
- Two things that share a silhouette. Food was concentric rings while a grazer
  was a circle, and neither could be read.
- Drawing every creature's reaction line at once.
- Anything that pulses at a speed somebody would notice as a loop.
- Cell borders, and anything else that says "there used to be a grid here".
