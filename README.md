# savemhq

A collection of just-for-fun Python projects.

## SaveMHQ — Save My Headquarters!

A terminal-based strategy game where you must defend your headquarters against waves of invaders by solving puzzles and challenges.

### How to Play

```bash
python3 savemhq.py
```

No external dependencies — uses only the Python standard library.

### Gameplay

- You face **4 waves** of increasingly difficult enemies.
- Each wave presents a series of challenges:
  - 🔢 **Math problems** — quick arithmetic under pressure
  - 🧩 **Riddles** — classic brainteasers
  - 🔤 **Word scrambles** — unscramble tactical vocabulary
  - 🔍 **Number guessing** — hunt down the spy's secret number
- Solving a challenge repels an enemy attack.
- Failing costs your HQ **10 HP** (starting at 100).
- Survive all 4 waves with HP > 0 to win!

### Scoring

- Each successful challenge earns `10 × wave_number` points.
- Higher waves = higher rewards!

### Requirements

- Python 3.6+