package io.gpxtoign.core.layout

import kotlin.math.max
import kotlin.math.min
import kotlin.random.Random

/**
 * Covers a set of ordered points with as few equal-sized rectangles as possible.
 *
 * Callers pass the *effective* page size: the printable map rectangle already shrunk by
 * the requested margin. A point inside an effective rectangle is therefore guaranteed to
 * sit at least one margin away from the printed page edge.
 *
 * Minimum rectangle cover is NP-hard, so this runs two complementary greedy strategies
 * and keeps the better one:
 *
 *  - [sequential] walks the track and takes the longest run of still-uncovered points that
 *    fits on one page. Optimal for a plain out-and-back-free linear walk, and cheap enough
 *    to run once per candidate rotation angle.
 *  - [maxCoverage] repeatedly places the page that covers the most uncovered points. It is
 *    slower but recovers the pages a loop or an out-and-back would otherwise duplicate.
 *
 * Both results then go through [refine], which drops redundant pages, re-centres what is
 * left to maximise slack, and merges neighbours that happen to fit together.
 */
internal class Cover(
    private val u: DoubleArray,
    private val v: DoubleArray,
    /** Index of the first point of each segment, plus a trailing entry equal to `u.size`. */
    private val segmentStart: IntArray,
    private val w: Double,
    private val h: Double,
) {
    private val n = u.size

    /** Point indices sorted by u, so a rectangle query only scans a narrow slice. */
    private val byU = (0 until n).sortedBy { u[it] }.toIntArray()
    private val sortedU = DoubleArray(n) { u[byU[it]] }

    init {
        require(n > 0) { "nothing to cover" }
        require(w > 0 && h > 0) { "margin leaves no usable page area" }
    }

    /**
     * @param thorough also run the max-coverage strategy, roughly an order of magnitude
     *   slower than the sequential sweep.
     * @param restarts extra max-coverage attempts with randomised anchors and tie-breaks.
     *   The generator is seeded, so the same job always yields the same page plan.
     */
    fun solve(thorough: Boolean, restarts: Int = 0): List<Rect> {
        var best = refine(sequential(reverse = false))
        if (!thorough) return best

        fun consider(candidate: List<Rect>) {
            if (candidate.size < best.size) best = candidate
        }
        consider(refine(sequential(reverse = true)))
        consider(refine(maxCoverage()))
        if (restarts > 0) {
            val rng = Random(RESTART_SEED)
            repeat(restarts) {
                if (best.size <= 1) return best
                consider(refine(maxCoverage(rng)))
            }
        }
        return best
    }

    // --- strategy 1: longest fitting run along the track -----------------------------

    fun sequential(reverse: Boolean = false): List<Rect> {
        val covered = BooleanArray(n)
        val out = ArrayList<Rect>()
        val order = (0 until segmentStart.size - 1).let { if (reverse) it.reversed() else it }
        for (s in order) {
            val lo = segmentStart[s]
            val hi = segmentStart[s + 1]
            // Walking a leg backwards shifts where the page breaks fall, which sometimes
            // saves the page a forward pass wastes on a short tail.
            val step = if (reverse) -1 else 1
            val first = if (reverse) hi - 1 else lo
            val stop = if (reverse) lo - 1 else hi
            var i = first
            while (i != stop) {
                if (covered[i]) { i += step; continue }
                var lo0 = u[i]; var hi0 = u[i]; var lo1 = v[i]; var hi1 = v[i]
                var last = i
                var k = i + step
                var skipped = 0
                while (k != stop) {
                    if (covered[k]) {
                        // Bounded so an already-covered return leg cannot make this quadratic.
                        if (++skipped > SKIP_LIMIT) break
                        k += step
                        continue
                    }
                    val nlo0 = min(lo0, u[k]); val nhi0 = max(hi0, u[k])
                    val nlo1 = min(lo1, v[k]); val nhi1 = max(hi1, v[k])
                    if (nhi0 - nlo0 > w || nhi1 - nlo1 > h) break
                    lo0 = nlo0; hi0 = nhi0; lo1 = nlo1; hi1 = nhi1
                    last = k
                    k += step
                }
                val r = Rect.centeredOn(lo0, lo1, hi0, hi1, w, h)
                out.add(r)
                markCovered(r, covered)
                i = last + step
            }
        }
        return out
    }

    // --- strategy 2: greedy maximum coverage -----------------------------------------

    fun maxCoverage(rng: Random? = null): List<Rect> {
        val covered = BooleanArray(n)
        var remaining = n
        val out = ArrayList<Rect>()
        val scratch = ArrayList<Int>()
        while (remaining > 0 && out.size <= n) {
            val uncovered = (0 until n).filter { !covered[it] }
            val anchors = if (rng == null) {
                val stride = max(1, uncovered.size / ANCHOR_BUDGET)
                uncovered.indices.step(stride).map { uncovered[it] }
            } else {
                List(min(ANCHOR_BUDGET, uncovered.size)) { uncovered[rng.nextInt(uncovered.size)] }
            }
            var best: Rect? = null
            var bestCount = 0
            for (p in anchors) {
                for (c in candidatesAround(u[p], v[p])) {
                    val count = countUncovered(c, covered, null)
                    val better = count > bestCount ||
                        (count == bestCount && count > 0 && rng != null && rng.nextBoolean())
                    if (better) { bestCount = count; best = c }
                }
            }
            val chosen = best ?: Rect.centeredOn(
                u[uncovered[0]], v[uncovered[0]], u[uncovered[0]], v[uncovered[0]], w, h,
            )
            // Shrink-wrap onto what it actually covers, which buys slack for free.
            scratch.clear()
            countUncovered(chosen, covered, scratch)
            val tight = if (scratch.isEmpty()) chosen else {
                var lo0 = Double.MAX_VALUE; var hi0 = -Double.MAX_VALUE
                var lo1 = Double.MAX_VALUE; var hi1 = -Double.MAX_VALUE
                for (i in scratch) {
                    lo0 = min(lo0, u[i]); hi0 = max(hi0, u[i])
                    lo1 = min(lo1, v[i]); hi1 = max(hi1, v[i])
                }
                Rect.centeredOn(lo0, lo1, hi0, hi1, w, h)
            }
            remaining -= markCovered(tight, covered)
            out.add(tight)
        }
        return out
    }

    private fun candidatesAround(pu: Double, pv: Double): List<Rect> = listOf(
        Rect(pu, pv, pu + w, pv + h),
        Rect(pu - w, pv, pu, pv + h),
        Rect(pu, pv - h, pu + w, pv),
        Rect(pu - w, pv - h, pu, pv),
        Rect(pu - w / 2, pv - h / 2, pu + w / 2, pv + h / 2),
    )

    // --- shared refinement ------------------------------------------------------------

    fun refine(rects: List<Rect>): List<Rect> {
        var current = rects.toMutableList()
        current = prune(current)
        current = recentre(current)
        current = merge(current)
        return prune(current)
    }

    private fun prune(rects: MutableList<Rect>): MutableList<Rect> {
        val kept = rects.toMutableList()
        var i = kept.size - 1
        while (i >= 0) {
            val without = kept.filterIndexed { j, _ -> j != i }
            if (without.isNotEmpty() && coversAll(without)) kept.removeAt(i)
            i--
        }
        return kept
    }

    private fun recentre(rects: MutableList<Rect>): MutableList<Rect> {
        val owners = assign(rects)
        for (i in rects.indices) {
            val mine = owners[i]
            if (mine.isEmpty()) continue
            var lo0 = Double.MAX_VALUE; var hi0 = -Double.MAX_VALUE
            var lo1 = Double.MAX_VALUE; var hi1 = -Double.MAX_VALUE
            for (p in mine) {
                lo0 = min(lo0, u[p]); hi0 = max(hi0, u[p])
                lo1 = min(lo1, v[p]); hi1 = max(hi1, v[p])
            }
            if (hi0 - lo0 > w || hi1 - lo1 > h) continue
            val candidate = Rect.centeredOn(lo0, lo1, hi0, hi1, w, h)
            val previous = rects[i]
            rects[i] = candidate
            if (!coversAll(rects)) rects[i] = previous
        }
        return rects
    }

    private fun merge(rects: MutableList<Rect>): MutableList<Rect> {
        var changed = true
        while (changed && rects.size > 1) {
            changed = false
            val owners = assign(rects)
            outer@ for (i in rects.indices) {
                for (j in i + 1 until rects.size) {
                    val pts = owners[i] + owners[j]
                    if (pts.isEmpty()) continue
                    var lo0 = Double.MAX_VALUE; var hi0 = -Double.MAX_VALUE
                    var lo1 = Double.MAX_VALUE; var hi1 = -Double.MAX_VALUE
                    for (p in pts) {
                        lo0 = min(lo0, u[p]); hi0 = max(hi0, u[p])
                        lo1 = min(lo1, v[p]); hi1 = max(hi1, v[p])
                    }
                    if (hi0 - lo0 > w || hi1 - lo1 > h) continue
                    val merged = Rect.centeredOn(lo0, lo1, hi0, hi1, w, h)
                    val next = rects.filterIndexed { k, _ -> k != i && k != j }.toMutableList()
                    next.add(merged)
                    if (coversAll(next)) {
                        rects.clear(); rects.addAll(next)
                        changed = true
                        break@outer
                    }
                }
            }
        }
        return rects
    }

    /** Points owned by each rectangle: every point goes to the first rectangle holding it. */
    private fun assign(rects: List<Rect>): List<MutableList<Int>> {
        val owners = List(rects.size) { mutableListOf<Int>() }
        for (p in 0 until n) {
            for (i in rects.indices) {
                if (rects[i].contains(u[p], v[p])) { owners[i].add(p); break }
            }
        }
        return owners
    }

    fun coversAll(rects: List<Rect>): Boolean {
        for (p in 0 until n) {
            var ok = false
            for (r in rects) if (r.contains(u[p], v[p])) { ok = true; break }
            if (!ok) return false
        }
        return true
    }

    private fun markCovered(r: Rect, covered: BooleanArray): Int {
        var added = 0
        forEachInU(r) { p ->
            if (!covered[p] && v[p] >= r.vMin && v[p] <= r.vMax) { covered[p] = true; added++ }
        }
        return added
    }

    private fun countUncovered(r: Rect, covered: BooleanArray, sink: MutableList<Int>?): Int {
        var count = 0
        forEachInU(r) { p ->
            if (!covered[p] && v[p] >= r.vMin && v[p] <= r.vMax) { count++; sink?.add(p) }
        }
        return count
    }

    private inline fun forEachInU(r: Rect, body: (Int) -> Unit) {
        var lo = lowerBound(r.uMin)
        while (lo < n && sortedU[lo] <= r.uMax) {
            body(byU[lo])
            lo++
        }
    }

    private fun lowerBound(target: Double): Int {
        var lo = 0
        var hi = n
        while (lo < hi) {
            val mid = (lo + hi) ushr 1
            if (sortedU[mid] < target) lo = mid + 1 else hi = mid
        }
        return lo
    }

    private companion object {
        const val SKIP_LIMIT = 512
        const val ANCHOR_BUDGET = 300
        const val RESTART_SEED = 0x6A7E_1E15L
    }
}
