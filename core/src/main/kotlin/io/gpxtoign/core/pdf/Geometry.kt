package io.gpxtoign.core.pdf

/** Liang-Barsky clipping of a segment against an axis-aligned box. */
internal object Segments {
    fun clip(
        x1: Double, y1: Double, x2: Double, y2: Double,
        xMin: Double, yMin: Double, xMax: Double, yMax: Double,
    ): DoubleArray? {
        val dx = x2 - x1
        val dy = y2 - y1
        var t0 = 0.0
        var t1 = 1.0
        val p = doubleArrayOf(-dx, dx, -dy, dy)
        val q = doubleArrayOf(x1 - xMin, xMax - x1, y1 - yMin, yMax - y1)
        for (i in 0 until 4) {
            if (p[i] == 0.0) {
                if (q[i] < 0) return null
            } else {
                val r = q[i] / p[i]
                if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r }
                else { if (r < t0) return null; if (r < t1) t1 = r }
            }
        }
        return doubleArrayOf(x1 + t0 * dx, y1 + t0 * dy, x1 + t1 * dx, y1 + t1 * dy)
    }
}
