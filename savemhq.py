#!/usr/bin/env python3
"""
SaveMHQ - Save My Headquarters!

A terminal-based strategy game where you must defend your headquarters
against waves of invaders by solving challenges.
"""

import random
import time
import sys


def clear_line():
    sys.stdout.write("\r" + " " * 60 + "\r")
    sys.stdout.flush()


def slow_print(text, delay=0.03):
    for char in text:
        sys.stdout.write(char)
        sys.stdout.flush()
        time.sleep(delay)
    print()


def print_banner():
    banner = r"""
  ____                  __  __ _    _  ____
 / ___|  __ ___   _____|  \/  | |  | |/ __ \
 \___ \ / _` \ \ / / _ \ |\/| | |__| | |  | |
  ___) | (_| |\ V /  __/ |  | |  __  | |__| |
 |____/ \__,_| \_/ \___|_|  |_|_|  |_|\___\_\

         *** SAVE MY HEADQUARTERS ***
    """
    print(banner)


def ask(question, valid_answers=None):
    while True:
        try:
            answer = input(question).strip().lower()
        except EOFError:
            return valid_answers[0] if valid_answers else ""
        if valid_answers is None or answer in valid_answers:
            return answer
        print(f"  Please enter one of: {', '.join(valid_answers)}")


# ---------------------------------------------------------------------------
# Challenges
# ---------------------------------------------------------------------------

def challenge_math(difficulty):
    """Return a math question and the correct answer string."""
    if difficulty == 1:
        a, b = random.randint(1, 10), random.randint(1, 10)
        return f"Quick! What is {a} + {b}? ", str(a + b)
    elif difficulty == 2:
        a, b = random.randint(5, 20), random.randint(5, 20)
        return f"Solve: {a} x {b} = ? ", str(a * b)
    else:
        a = random.randint(10, 30)
        b = random.randint(2, a)
        return f"Fast! {a} squared minus {b} squared = ? ", str(a * a - b * b)


def challenge_riddle():
    riddles = [
        ("I have cities, but no houses live there. I have mountains, but no trees. "
         "I have water, but no fish. I have roads, but no cars. What am I?",
         "map"),
        ("The more you take, the more you leave behind. What am I?",
         "footsteps"),
        ("I speak without a mouth and hear without ears. "
         "I have no body, but I come alive with the wind. What am I?",
         "echo"),
        ("What has hands but can't clap?",
         "clock"),
        ("What gets wetter the more it dries?",
         "towel"),
    ]
    riddle, answer = random.choice(riddles)
    return riddle, answer


def challenge_word_scramble():
    words = [
        ("defend", "efddne"),
        ("fortress", "srferots"),
        ("tactical", "lacttaci"),
        ("mission", "snimois"),
        ("victory", "yrtoicv"),
        ("strategy", "tegyrats"),
    ]
    word, scrambled = random.choice(words)
    return f"Unscramble this word: '{scrambled}' ", word


def challenge_number_guess():
    secret = random.randint(1, 20)
    attempts = 4
    print("  A spy hid a number between 1 and 20. You have 4 guesses!")
    for attempt in range(1, attempts + 1):
        try:
            guess_str = input(f"  Guess #{attempt}: ").strip()
        except EOFError:
            print(f"  No input! The number was {secret}.")
            return False
        try:
            guess = int(guess_str)
        except ValueError:
            print("  That's not a number!")
            continue
        if guess == secret:
            print("  Correct! You found the spy's number!")
            return True
        elif guess < secret:
            print("  Too low!")
        else:
            print("  Too high!")
    print(f"  Out of guesses! The number was {secret}.")
    return False


# ---------------------------------------------------------------------------
# Wave system
# ---------------------------------------------------------------------------

WAVE_MESSAGES = [
    "A squad of enemy scouts is approaching!",
    "The enemy is sending in heavy infantry!",
    "Elite commandos have breached the perimeter!",
    "The final assault begins — all enemies attack!",
]


def run_wave(wave_number, hp):
    difficulty = min(wave_number, 3)
    print(f"\n{'='*55}")
    slow_print(f"  ⚠  WAVE {wave_number}: {WAVE_MESSAGES[min(wave_number-1, 3)]}")
    print(f"{'='*55}")
    time.sleep(0.5)

    challenges_in_wave = wave_number + 1
    successes = 0

    for i in range(challenges_in_wave):
        print(f"\n  Challenge {i+1}/{challenges_in_wave}")
        pick = random.randint(1, 4)

        if pick == 1:
            question, answer = challenge_math(difficulty)
            try:
                user = input(f"  {question}").strip()
            except EOFError:
                user = ""
            if user == answer:
                print("  ✓ Correct! Enemy repelled!")
                successes += 1
            else:
                print(f"  ✗ Wrong! The answer was {answer}. Enemy breaks through!")
                hp -= 10

        elif pick == 2:
            riddle, answer = challenge_riddle()
            slow_print(f"  Riddle: {riddle}", delay=0.02)
            try:
                user = input("  Your answer: ").strip().lower()
            except EOFError:
                user = ""
            if user == answer:
                print("  ✓ Correct! Enemy confused and retreating!")
                successes += 1
            else:
                print(f"  ✗ Wrong! The answer was '{answer}'. Enemy advances!")
                hp -= 10

        elif pick == 3:
            question, answer = challenge_word_scramble()
            try:
                user = input(f"  {question}").strip().lower()
            except EOFError:
                user = ""
            if user == answer:
                print("  ✓ Correct! Intelligence decoded!")
                successes += 1
            else:
                print(f"  ✗ Wrong! The word was '{answer}'. Comms disrupted!")
                hp -= 10

        else:
            result = challenge_number_guess()
            if result:
                successes += 1
            else:
                hp -= 10

        print(f"  🏠 HQ Health: {hp}/100")
        if hp <= 0:
            break

    return hp, successes, challenges_in_wave


# ---------------------------------------------------------------------------
# Main game
# ---------------------------------------------------------------------------

def play():
    print_banner()
    slow_print("  Welcome, Commander. Your HQ is under siege.")
    slow_print("  Solve the challenges to defend your base!")
    print()

    try:
        name = input("  Enter your codename: ").strip() or "Commander"
    except EOFError:
        name = "Commander"
    print(f"\n  Good luck, {name}. The HQ is counting on you!\n")
    time.sleep(1)

    while True:
        hp = 100
        total_waves = 4
        score = 0

        for wave in range(1, total_waves + 1):
            hp, successes, total = run_wave(wave, hp)
            score += successes * wave * 10

            if hp <= 0:
                print("\n" + "!"*55)
                slow_print("  💥  HQ DESTROYED. MISSION FAILED.")
                print("!"*55)
                print(f"\n  Final score: {score}")
                print(f"  You survived {wave - 1} full wave(s).")
                break

            print(f"\n  Wave {wave} complete! Successes: {successes}/{total}")
            if wave < total_waves:
                cont = ask("\n  Ready for the next wave? (y/n) ", ["y", "n"])
                if cont == "n":
                    print(f"\n  Retreating... Final score: {score}")
                    break
        else:
            print("\n" + "*"*55)
            slow_print("  🏆  ALL WAVES REPELLED. HQ SAVED! MISSION SUCCESS!")
            print("*"*55)
            print(f"\n  Well done, {name}!")
            print(f"  Final HQ Health: {hp}/100")
            print(f"  Final Score: {score}")

        print()
        again = ask("  Play again? (y/n) ", ["y", "n"])
        if again != "y":
            break

    slow_print("\n  Thanks for playing SaveMHQ. Stay vigilant, Commander!")


if __name__ == "__main__":
    try:
        play()
    except KeyboardInterrupt:
        print("\n\n  Game interrupted. Goodbye, Commander!")
