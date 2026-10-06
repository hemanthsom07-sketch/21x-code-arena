# Scoring and competition rules (as implemented)

**Where the rules live:** the database records trusted facts when the judge sets a verdict (`question_results`, written only by a trigger);
the ranking rules are applied in `supabase/functions/_shared/scoring.ts` and served by the `leaderboard` Edge Function. The browser never sends or computes a score.

## Points
- Each question has `points` (1-10,000, set by the admin). A student earns them **once**, on their **first accepted** submission. Later accepted submissions change nothing.
- A *round* is a challenge (Day 1-21). The leaderboard can show **Overall** or any single round.

## Penalty (lower is better)
For every solved question: `minutes from the challenge's start to the first accepted submission` (rounded down, never negative) `+ P x (penalised attempts before that acceptance)`, summed over solved questions. `P` = "penalty per wrong attempt" in Event control (default 10).
- Challenge start = when the admin unlocked it, else its scheduled release time, else the event start, else its creation time.
- **Penalised verdicts:** Wrong Answer, Runtime Error, Time Limit Exceeded.
- **Not penalised:** Compilation Error, Judge Error (our fault, e.g. judge down), anything after the first acceptance, anything submitted after the challenge closed.
- Unsolved questions never add penalty (so trying a hard question can't hurt you).

## Ranking
1. More points first. 2. Then lower total penalty. 3. Then the earlier *last* acceptance.
Entries equal on all three share a rank (1, 2, 2, 4). Display order among exact ties is by name then id, so it never flickers.
Only active students with at least one scoring solve are ranked. Disabled accounts disappear from the board.

Worked example (P = 10): Asha solves Q1 (100 pts) 12 min after the round opened with 1 earlier Wrong Answer -> penalty 22. Ben solves Q1 in 5 min with no mistakes -> penalty 5. Both have 100 points; Ben ranks above Asha.

## Deadlines and pauses (enforced in the database for Run and Submit)
In order: account disabled -> challenge not released -> challenge closed (`closes_at`) -> event not started / ended -> submissions paused. Admins are exempt (they can test any time). Students can still *read* a closed challenge.

## Things to know
- **Changing a question's points after students have solved it:** existing results keep the points they earned. Run **Monitoring -> Recompute scores** to rebuild everything from the submissions table.
- **Changing the penalty minutes** takes effect immediately (the leaderboard is cached for ~10 s).
- **Re-judging** submissions is not supported.
- Time uses the server timestamp recorded when the submission was accepted into the queue, never the browser clock.
- Duplicate protection: 10 s cooldown per student; a judge fault does not consume the cooldown, so a student can retry immediately.
- The leaderboard shows names and departments to all active students. Hide it from students with "Students can see the leaderboard" in Event control.
