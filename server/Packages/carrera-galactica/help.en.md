# Galactic Race

Welcome to the **Galactic Race**, a squadron space race built on the classic
race-game mechanics. Each player commands a squadron of **4 ships** that must take
off, complete the full lap around the **68-sector circuit** and land them all in
their **goal hangar**. The first full squadron home wins.

## Objective

Bring your 4 ships from your **base** to the **goal**: launch onto the circuit,
complete the lap, enter your **final corridor** (7 private sectors) and land with an
exact count.

## Your turn

Roll **one die**:

- **5** — if you have ships at base, **one must take off** onto your start sector. If
  a rival sits on your start, their ship is shot down and returns to its base (the one
  exception to safe sectors).
- **6** — move and **roll again**. With no ships left at base, a 6 **moves 7**.
  Careful: on your **third 6 in a row**, your last moved ship returns to base (unless
  it already reached your final corridor) and you lose the turn.
- **Any other value** — advance one ship exactly that many sectors. If several ships
  can move you choose which; if only one can, it moves automatically; if none can,
  you pass.

## Shoot-downs and bonuses

- Landing on a **lone rival ship** (outside a safe sector) **shoots it down**: it
  returns to its base and you count a **20-sector bonus** with any ship you like.
- Bringing a ship to the **goal** awards a **10-sector bonus**.
- Bonuses chain (a shoot-down during a bonus earns another bonus). If no bonus move is
  legal, it is lost.

## Safe sectors and shields

- On **safe sectors** (marked ◆, including every start) there are no shoot-downs:
  ships of different squadrons may share them.
- Two ships of the **same squadron** on one sector form a **shield (barrier)**: no
  squadron may pass it — not even yours. If you roll a **6** while you have a shield,
  you are **obliged to open it** when possible.
- A sector never holds more than **two ships**.

## The final corridor

After completing the lap, your ships turn into your private corridor. Landing on the
goal requires an **exact count** — overshooting makes the move illegal.

## How the track is numbered

There is **one** track, its squares numbered **1 to 68** (after 68 comes 1 again). The
numbers do **not** repeat per player: square 22 is the same square for everyone. What
changes per squadron is **where it boards** and **where it turns off**:

| Squadron | Launches at | Turns into its corridor at |
|---|---|---|
| Red | 5 | 68 |
| Blue | 22 | 17 |
| Yellow | 39 | 34 |
| Green | 56 | 51 |

Each ship walks 63 track squares (from its start to its turn-off); the 4 squares left
"behind its back" are never stepped on by it — for every other squadron they are
ordinary squares. A turn-off only works for its owner: passing a rival's turn-off, you
sail straight on. Your exploration cursor starts on **your start square**, and
**S** always returns you to it.

## Exploring the board with the keyboard

- **← / →** walk the current lane: the circuit (wrapping), or your
  base → corridor → goal strip.
- **↑ / ↓** switch zones: circuit ↔ each squadron's zone. Returning to the circuit
  remembers where you were.
- **M / Shift+M** cycle through your ships, forward and backward, wherever they stand.
  **N / Shift+N** do the same over every square holding ships, whoever they belong to.
- **S / Shift+S** walk your two landmarks: your launch sector and your final-corridor
  entrance.
- **Home** goes to the beginning of the current lane: square 1 on the circuit, or the
  base of the zone you are exploring.
- Every sector announces what it holds: safe, starts, corridor entrances, and the
  ships or shields present.
