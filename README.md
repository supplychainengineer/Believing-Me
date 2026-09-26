# Believing Me

A small phone app for the three daily commitments:

1. **Launch Picoq**: log what you did each day, tick off launch milestones, and see whether you're ahead of or behind pace for your launch date.
2. **Fixed sleep and wake times**: log bedtime and wake-up, and see how close each day lands to your targets.
3. **1 hour of movement**: log minutes and activity, and record personal records (PRs). New PRs are detected automatically.

Each goal fills a ring. When you close all three you get confetti. The app also shows streaks, levels/XP, a 16-week consistency map, and charts for every goal.

## Use it on your phone

It's a Progressive Web App (plain HTML/CSS/JS, no build step, works offline).

1. Host it (one time): on GitHub go to **Settings → Pages**, set **Source: Deploy from a branch**, pick branch `claude/friendly-fermi-2ukv88` and folder `/ (root)`, then **Save**. After about a minute it's live at https://supplychainengineer.github.io/Believing-Me/ and every push updates it.
2. Open that URL on your phone:
   - **iPhone**: Safari → Share → *Add to Home Screen*
   - **Android**: Chrome → ⋮ → *Install app*

Data stays in your phone's browser storage and never leaves the device. Use **Goals → Export backup** now and then.

## Run locally

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```
