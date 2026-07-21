# Classic Pachisi

The traditional cross-and-circle game: each player races **4 counters** of their colour from
home to the goal, around a **68-square** circuit and up their own **7-square final
corridor**. First to bring every counter home wins.

## Help during play

- **F1** opens this Classic Pachisi guide.
- **Ctrl+F1** opens the complete list of shortcuts available in this game.
- **Ctrl+Shift+F1** shows the active rules, including the die, barriers, captures and team play.

## Rules

- **Leaving home**: only with a **5**, and it is mandatory when legal.
- **A 6 rolls again**: with all 4 counters out of home, a 6 is **worth 7**.
- **Three 6s in a row**: the last counter you moved goes home (spared if it already
  left the circuit).
- **Capturing**: land on a lone rival counter on a normal square and it goes home —
  you **count 20** with any counter. No captures on **safe squares**, with one
  exception: **leaving home** captures whoever sits on your start.
- **Goal**: entered by **exact count**; bringing a counter home **counts 10**.
- **Barriers**: two of your counters together block everyone's passage (yours too).
  Rolling a 6 with a barrier **forces you to open it** when legal.
- A square holds **at most two counters**; different colours only share a safe square.
- When a player brings every counter home, the game **continues** for the remaining
  places until a single player is left.

Your exploration cursor starts on **your start square**, and **S** cycles the starts
and corridor entries of every colour in play.

## Exploring the board with the keyboard

- **← / →** walk the current lane: the circuit (wrapping), or your
  home → corridor → goal strip.
- **↑ / ↓** switch zones: circuit ↔ each colour's zone. Returning to the circuit
  remembers where you were.
- **M / Shift+M** cycle through your counters, forward and backward, wherever they
  stand. **N / Shift+N** do the same over every square holding counters.
- **S / Shift+S** cycle forward and backward through every active colour's start and
  corridor entrance.
- **Home** goes to the beginning of the current lane. Typing a **number** jumps to
  that circuit square.
- Every square announces what it holds: safe, starts, corridor entrances, and the
  counters or barriers present.

## Playing with a screen reader

### Exploring and playing

- **Escape** returns focus to the board. Use the arrows, **M**, **N**, **S**, **Home** and number keys as described above; every cursor move announces the full square.
- **Space** rolls the die. If several counters can move, a non-modal dialog opens with one option per counter; **Enter** activates the focused option.
- From that dialog, **Escape** returns to the board without cancelling the choice. **Ctrl+D** returns focus to the pending dialog.

### Checking the game

- **C** announces your colour and **T** says whose turn it is. **Ctrl+P** moves to the players list.
- Rolls, moves, captures, counts of 10 or 20, barriers and turn changes are announced automatically.

### Moving between areas and using chat

- **F6** cycles through the board, actions, players and connection; non-modal dialogs and chat join while open. **Shift+F6** moves through the areas in reverse.
- **Ctrl+Shift+R** opens chat and focuses the message box. **Ctrl+Shift+H** opens or closes chat.
- This guide, the shortcuts and the active rules are reading documents. Use your screen reader's heading and list commands, then close them with **Escape** to return to play.
