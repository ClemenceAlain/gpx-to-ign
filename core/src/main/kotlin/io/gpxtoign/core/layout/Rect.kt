package io.gpxtoign.core.layout

import kotlin.math.max
import kotlin.math.min

/**
 * An axis-aligned rectangle in the *page frame*: the map rotated so that page-up is the
 * job's chosen bearing. Units are metres on the ground.
 */
data class Rect(val uMin: Double, val vMin: Double, val uMax: Double, val vMax: Double) {
    val width get() = uMax - uMin
    val height get() = vMax - vMin
    val centerU get() = (uMin + uMax) / 2.0
    val centerV get() = (vMin + vMax) / 2.0

    fun contains(u: Double, v: Double) = u >= uMin && u <= uMax && v >= vMin && v <= vMax

    fun expand(by: Double) = Rect(uMin - by, vMin - by, uMax + by, vMax + by)

    fun union(o: Rect) = Rect(
        min(uMin, o.uMin), min(vMin, o.vMin), max(uMax, o.uMax), max(vMax, o.vMax),
    )

    fun intersects(o: Rect) =
        uMin <= o.uMax && o.uMin <= uMax && vMin <= o.vMax && o.vMin <= vMax

    companion object {
        /** A [w] x [h] rectangle centred on the given box. */
        fun centeredOn(
            uMin: Double, vMin: Double, uMax: Double, vMax: Double, w: Double, h: Double,
        ): Rect {
            val cu = (uMin + uMax) / 2.0
            val cv = (vMin + vMax) / 2.0
            return Rect(cu - w / 2.0, cv - h / 2.0, cu + w / 2.0, cv + h / 2.0)
        }
    }
}
