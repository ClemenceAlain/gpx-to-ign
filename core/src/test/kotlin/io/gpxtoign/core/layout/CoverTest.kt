package io.gpxtoign.core.layout

import kotlin.random.Random
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class CoverTest {

    private val w = 100.0
    private val h = 100.0

    private fun cover(points: List<Pair<Double, Double>>) = Cover(
        u = points.map { it.first }.toDoubleArray(),
        v = points.map { it.second }.toDoubleArray(),
        segmentStart = intArrayOf(0, points.size),
        w = w,
        h = h,
    )

    /**
     * Any minimal cover can slide each rectangle up and left until its lower-left corner
     * touches a point's u and a point's v, so those pairs form a complete candidate set.
     */
    private fun bruteForceMinimum(points: List<Pair<Double, Double>>): Int {
        val candidates = points.flatMap { a ->
            points.map { b -> Rect(a.first, b.second, a.first + w, b.second + h) }
        }.distinct()
        fun covers(chosen: List<Rect>) =
            points.all { p -> chosen.any { it.contains(p.first, p.second) } }

        for (k in 1..points.size) {
            val idx = IntArray(k) { it }
            while (true) {
                if (covers(idx.map { candidates[it] })) return k
                var i = k - 1
                while (i >= 0 && idx[i] == candidates.size - k + i) i--
                if (i < 0) break
                idx[i]++
                for (j in i + 1 until k) idx[j] = idx[j - 1] + 1
            }
        }
        return points.size
    }

    @Test
    fun `greedy matches the brute-force optimum on small random point sets`() {
        val rng = Random(20260917)
        repeat(60) { seed ->
            val points = List(5 + seed % 4) {
                rng.nextDouble(0.0, 260.0) to rng.nextDouble(0.0, 260.0)
            }
            val c = cover(points)
            val got = c.solve(thorough = true, restarts = 24)
            assertTrue(c.coversAll(got), "case $seed leaves a point uncovered")
            val optimum = bruteForceMinimum(points)
            assertEquals(optimum, got.size, "case $seed: greedy used ${got.size}, optimum $optimum")
        }
    }

    @Test
    fun `a single point needs a single page`() {
        val c = cover(listOf(10.0 to 10.0))
        assertEquals(1, c.solve(thorough = true, restarts = 24).size)
    }

    @Test
    fun `points further apart than a page need separate pages`() {
        val c = cover(listOf(0.0 to 0.0, 1_000.0 to 0.0, 2_000.0 to 0.0))
        val r = c.solve(thorough = true, restarts = 24)
        assertEquals(3, r.size)
        assertTrue(c.coversAll(r))
    }

    @Test
    fun `revisiting the same ground does not add pages`() {
        val onePass = (0..50).map { 0.0 to it * 4.0 }
        val there = cover(onePass).solve(thorough = true).size
        val andBack = cover(onePass + onePass.reversed().map { it.first + 3.0 to it.second })
            .solve(thorough = true).size
        assertEquals(there, andBack)
    }
}
