package io.gpxtoign.core.pdf

import io.gpxtoign.core.pdf.PdfDocument.Companion.fmt
import java.io.ByteArrayOutputStream

internal class PdfImage(val jpeg: ByteArray, val widthPx: Int, val heightPx: Int)

/**
 * Drawing surface for one page, in PostScript points with the origin at the bottom left.
 */
class PdfPage internal constructor(val widthPt: Double, val heightPt: Double) {

    internal val images = mutableListOf<PdfImage>()
    private val content = ByteArrayOutputStream()

    internal fun contentBytes(): ByteArray = content.toByteArray()

    private fun op(text: String) {
        content.write(text.toByteArray(Charsets.ISO_8859_1))
        content.write('\n'.code)
    }

    /** Places an already-encoded JPEG so it exactly fills the given rectangle. */
    fun drawJpeg(jpeg: ByteArray, widthPx: Int, heightPx: Int, x: Double, y: Double, w: Double, h: Double) {
        val index = images.size
        images.add(PdfImage(jpeg, widthPx, heightPx))
        op("q ${fmt(w)} 0 0 ${fmt(h)} ${fmt(x)} ${fmt(y)} cm /Im$index Do Q")
    }

    fun setFill(r: Double, g: Double, b: Double) = op("${fmt(r)} ${fmt(g)} ${fmt(b)} rg")

    fun setStroke(r: Double, g: Double, b: Double) = op("${fmt(r)} ${fmt(g)} ${fmt(b)} RG")

    fun setLineWidth(w: Double) = op("${fmt(w)} w")

    fun fillRect(x: Double, y: Double, w: Double, h: Double) =
        op("${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)} re f")

    fun strokeRect(x: Double, y: Double, w: Double, h: Double) =
        op("${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)} re S")

    fun line(x1: Double, y1: Double, x2: Double, y2: Double) =
        op("${fmt(x1)} ${fmt(y1)} m ${fmt(x2)} ${fmt(y2)} l S")

    fun fillPolygon(points: List<Pair<Double, Double>>) {
        if (points.size < 3) return
        val head = points.first()
        op("${fmt(head.first)} ${fmt(head.second)} m")
        points.drop(1).forEach { op("${fmt(it.first)} ${fmt(it.second)} l") }
        op("h f")
    }

    fun text(x: Double, y: Double, size: Double, value: String, bold: Boolean = false) {
        val font = if (bold) "F2" else "F1"
        content.write("BT /$font ${fmt(size)} Tf ${fmt(x)} ${fmt(y)} Td (".toByteArray(Charsets.ISO_8859_1))
        content.write(escape(winAnsi(value)))
        op(") Tj ET")
    }

    fun textCentered(cx: Double, y: Double, size: Double, value: String, bold: Boolean = false) =
        text(cx - textWidth(value, size, bold) / 2.0, y, size, value, bold)

    fun textRight(right: Double, y: Double, size: Double, value: String, bold: Boolean = false) =
        text(right - textWidth(value, size, bold), y, size, value, bold)

    /** Advance width of [value] in points, from the base-14 Helvetica metrics. */
    fun textWidth(value: String, size: Double, bold: Boolean = false): Double {
        val widths = if (bold) HELVETICA_BOLD else HELVETICA
        var total = 0
        for (code in winAnsi(value)) {
            total += when {
                code in 32..126 -> widths[code - 32]
                else -> HIGH_WIDTHS[code] ?: DEFAULT_WIDTH
            }
        }
        return total * size / 1000.0
    }

    /**
     * Transcodes to WinAnsi, the encoding declared on the fonts. It is Latin-1 except for
     * 0x80..0x9F, where Windows put the typographic punctuation this app actually uses —
     * the em dash in the IGN attribution line among them.
     */
    private fun winAnsi(value: String): IntArray = IntArray(value.length) { index ->
        val ch = value[index]
        WIN_ANSI_HIGH[ch] ?: if (ch.code in 32..255) ch.code else '?'.code
    }

    private fun escape(codes: IntArray): ByteArray {
        val out = ByteArrayOutputStream()
        for (code in codes) {
            when (code) {
                '('.code, ')'.code, '\\'.code -> { out.write('\\'.code); out.write(code) }
                else -> out.write(code)
            }
        }
        return out.toByteArray()
    }

    private companion object {
        const val DEFAULT_WIDTH = 556

        /** Characters WinAnsi places in 0x80..0x9F, where Latin-1 has control codes. */
        val WIN_ANSI_HIGH = mapOf(
            '\u20AC' to 0x80, '\u201A' to 0x82, '\u0192' to 0x83, '\u201E' to 0x84,
            '\u2026' to 0x85, '\u2020' to 0x86, '\u2021' to 0x87, '\u02C6' to 0x88,
            '\u2030' to 0x89, '\u0160' to 0x8A, '\u2039' to 0x8B, '\u0152' to 0x8C,
            '\u017D' to 0x8E, '\u2018' to 0x91, '\u2019' to 0x92, '\u201C' to 0x93,
            '\u201D' to 0x94, '\u2022' to 0x95, '\u2013' to 0x96, '\u2014' to 0x97,
            '\u02DC' to 0x98, '\u2122' to 0x99, '\u0161' to 0x9A, '\u203A' to 0x9B,
            '\u0153' to 0x9C, '\u017E' to 0x9E, '\u0178' to 0x9F,
        )

        /** Helvetica widths for the few non-ASCII codes this app prints. */
        val HIGH_WIDTHS = mapOf(
            0x85 to 1000, 0x91 to 222, 0x92 to 222, 0x93 to 333, 0x94 to 333,
            0x95 to 350, 0x96 to 556, 0x97 to 1000,
            0xA9 to 737, 0xAE to 737, 0xB0 to 400, 0xB7 to 278, 0xA0 to 278,
        )

        /** Adobe base-14 Helvetica advance widths for ASCII 32..126, in 1/1000 em. */
        val HELVETICA = intArrayOf(
            278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
            556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
            1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
            667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
            333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
            556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
        )
        val HELVETICA_BOLD = intArrayOf(
            278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
            556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
            975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
            667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
            333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
            611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
        )
    }
}
